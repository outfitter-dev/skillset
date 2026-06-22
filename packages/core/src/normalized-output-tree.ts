import { createHash } from "node:crypto";
import { lstat, readdir, readFile, readlink, stat } from "node:fs/promises";
import { basename, join, relative } from "node:path";

import { compareStrings } from "./path";
import { assertNoHostLeaks, type HostLeakDetectionOptions } from "./host-leak";
import type { JsonValue } from "./types";
import { isJsonRecord, parseYamlRecord, stringifyYaml, stripUndefinedValue } from "./yaml";

const DEFAULT_STRUCTURED_JSON_BASENAMES = new Set(["skillset.lock"]);
type NormalizedContentKind = "bytes" | "json" | "yaml";

export interface NormalizedOutputTreeOptions {
  readonly excludePathPrefixes?: readonly string[];
  readonly excludePaths?: readonly string[];
  readonly forbiddenSubstrings?: readonly string[];
  readonly hostLeakOptions?: false | HostLeakDetectionOptions;
  readonly structuredJsonPaths?: readonly string[];
  readonly structuredYamlPaths?: readonly string[];
}

export interface NormalizedOutputTreeEntry {
  readonly bytes: Uint8Array;
  readonly kind: "bytes" | "json" | "symlink" | "yaml";
  readonly path: string;
}

export interface NormalizedOutputTree {
  readonly entries: readonly NormalizedOutputTreeEntry[];
}

export type NormalizedTreeDifferenceKind = "different" | "left-only" | "right-only";

export interface NormalizedTreeDifference {
  readonly detail: string;
  readonly kind: NormalizedTreeDifferenceKind;
  readonly path: string;
}

export interface NormalizedTreeComparison {
  readonly different: readonly string[];
  readonly differences: readonly NormalizedTreeDifference[];
  readonly equal: boolean;
  readonly identical: readonly string[];
  readonly leftOnly: readonly string[];
  readonly rightOnly: readonly string[];
}

export async function readNormalizedOutputTree(
  rootPath: string,
  options: NormalizedOutputTreeOptions = {}
): Promise<NormalizedOutputTree> {
  const paths = await collectRelativeFiles(rootPath, options);
  const entries: NormalizedOutputTreeEntry[] = [];
  for (const path of paths) {
    const absolutePath = join(rootPath, path);
    if ((await lstat(absolutePath)).isSymbolicLink()) {
      const bytes = new TextEncoder().encode(normalizePath(await readlink(absolutePath)));
      assertNoForbiddenSubstrings(path, bytes, options);
      entries.push({ bytes, kind: "symlink", path });
      continue;
    }
    const bytes = await readFile(absolutePath);
    entries.push(normalizeOutputTreeEntry(path, bytes, options));
  }
  return {
    entries: entries.sort((left, right) => compareStrings(left.path, right.path)),
  };
}

export async function compareNormalizedOutputTrees(
  leftRootPath: string,
  rightRootPath: string,
  options: NormalizedOutputTreeOptions = {}
): Promise<NormalizedTreeComparison> {
  const [leftTree, rightTree] = await Promise.all([
    readNormalizedOutputTree(leftRootPath, options),
    readNormalizedOutputTree(rightRootPath, options),
  ]);
  return compareNormalizedOutputTreeEntries(leftTree.entries, rightTree.entries);
}

export function compareNormalizedOutputTreeEntries(
  leftEntries: readonly NormalizedOutputTreeEntry[],
  rightEntries: readonly NormalizedOutputTreeEntry[]
): NormalizedTreeComparison {
  const left = new Map(leftEntries.map((entry) => [entry.path, entry]));
  const right = new Map(rightEntries.map((entry) => [entry.path, entry]));
  const paths = new Set([...left.keys(), ...right.keys()]);
  const differences: NormalizedTreeDifference[] = [];
  const identical: string[] = [];

  for (const path of [...paths].sort(compareStrings)) {
    const leftEntry = left.get(path);
    const rightEntry = right.get(path);
    if (leftEntry === undefined) {
      differences.push({ detail: "only in right tree", kind: "right-only", path });
      continue;
    }
    if (rightEntry === undefined) {
      differences.push({ detail: "only in left tree", kind: "left-only", path });
      continue;
    }
    if (leftEntry.kind === rightEntry.kind && bytesEqual(leftEntry.bytes, rightEntry.bytes)) {
      identical.push(path);
      continue;
    }
    differences.push({
      detail: `${leftEntry.kind}/${rightEntry.kind} content differs (${leftEntry.bytes.byteLength} bytes vs ${rightEntry.bytes.byteLength} bytes, sha256 ${shortHash(leftEntry.bytes)} vs ${shortHash(rightEntry.bytes)})`,
      kind: "different",
      path,
    });
  }

  return {
    different: differences.filter((difference) => difference.kind === "different").map((difference) => difference.path),
    differences,
    equal: differences.length === 0,
    identical,
    leftOnly: differences.filter((difference) => difference.kind === "left-only").map((difference) => difference.path),
    rightOnly: differences.filter((difference) => difference.kind === "right-only").map((difference) => difference.path),
  };
}

export function formatNormalizedTreeComparison(
  comparison: NormalizedTreeComparison,
  limit = 20
): string {
  if (comparison.equal) return "normalized output trees match";
  const shown = comparison.differences.slice(0, limit);
  const lines = [
    `normalized output trees differ: ${comparison.different.length} changed, ${comparison.leftOnly.length} left-only, ${comparison.rightOnly.length} right-only`,
    ...shown.map((difference) => `- ${difference.kind}: ${difference.path} (${difference.detail})`),
  ];
  const hidden = comparison.differences.length - shown.length;
  if (hidden > 0) lines.push(`- ... ${hidden} more difference(s)`);
  return lines.join("\n");
}

function normalizeOutputTreeEntry(
  path: string,
  bytes: Uint8Array,
  options: NormalizedOutputTreeOptions
): NormalizedOutputTreeEntry {
  const kind = structuredKindForPath(path, options);
  const normalizedBytes = kind === "bytes" ? bytes : normalizeStructuredBytes(path, bytes, kind);
  assertNoForbiddenSubstrings(path, normalizedBytes, options);
  return { bytes: normalizedBytes, kind, path };
}

function normalizeStructuredBytes(
  path: string,
  bytes: Uint8Array,
  kind: "json" | "yaml"
): Uint8Array {
  const text = new TextDecoder().decode(bytes);
  if (kind === "json") {
    const parsed = JSON.parse(text) as JsonValue;
    return new TextEncoder().encode(`${JSON.stringify(sortJsonValue(parsed), null, 2)}\n`);
  }
  return new TextEncoder().encode(stringifyYaml(parseYamlRecord(text, path)));
}

function structuredKindForPath(
  path: string,
  options: NormalizedOutputTreeOptions
): NormalizedContentKind {
  if ((options.structuredYamlPaths ?? []).includes(path)) return "yaml";
  if ((options.structuredJsonPaths ?? []).includes(path) || DEFAULT_STRUCTURED_JSON_BASENAMES.has(basename(path))) {
    return "json";
  }
  return "bytes";
}

async function collectRelativeFiles(
  rootPath: string,
  options: NormalizedOutputTreeOptions
): Promise<readonly string[]> {
  if (!(await exists(rootPath))) return [];
  const paths: string[] = [];
  const walk = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolutePath = join(directory, entry.name);
      const relativePath = normalizePath(relative(rootPath, absolutePath));
      if (isExcludedPath(relativePath, options)) continue;
      if (entry.isDirectory()) {
        await walk(absolutePath);
      } else if (entry.isFile()) {
        paths.push(relativePath);
      } else if (entry.isSymbolicLink()) {
        paths.push(relativePath);
      }
    }
  };
  await walk(rootPath);
  return paths.sort(compareStrings);
}

function isExcludedPath(path: string, options: NormalizedOutputTreeOptions): boolean {
  if ((options.excludePaths ?? []).includes(path)) return true;
  return (options.excludePathPrefixes ?? []).some((prefix) => isPathInExcludedPrefix(path, prefix));
}

function isPathInExcludedPrefix(path: string, prefix: string): boolean {
  const normalizedPrefix = normalizePath(prefix).replace(/\/+$/u, "");
  return path === normalizedPrefix || path.startsWith(`${normalizedPrefix}/`);
}

function assertNoForbiddenSubstrings(
  path: string,
  bytes: Uint8Array,
  options: NormalizedOutputTreeOptions
): void {
  if (options.hostLeakOptions !== undefined && options.hostLeakOptions !== false) {
    assertNoHostLeaks(path, bytes, {
      ...(options.hostLeakOptions ?? {}),
      forbiddenSubstrings: [
        ...(options.hostLeakOptions?.forbiddenSubstrings ?? []),
        ...(options.forbiddenSubstrings ?? []),
      ],
    });
  }
  const forbidden = options.forbiddenSubstrings ?? [];
  if (forbidden.length === 0) return;
  for (const value of forbidden) {
    if (path.includes(value)) {
      throw new Error(`skillset: normalized output path ${path} contains forbidden value ${value}`);
    }
  }
  const text = new TextDecoder().decode(bytes);
  for (const value of forbidden) {
    if (text.includes(value)) {
      throw new Error(`skillset: normalized output ${path} contains forbidden value ${value}`);
    }
  }
}

function sortJsonValue(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(sortJsonValue);
  if (!isJsonRecord(value)) return value;
  const sorted: Record<string, JsonValue> = {};
  for (const key of Object.keys(value).sort(compareStrings)) {
    const item = value[key];
    if (item === undefined) continue;
    sorted[key] = sortJsonValue(stripUndefinedValue(item));
  }
  return sorted;
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

function normalizePath(path: string): string {
  return path.replaceAll("\\", "/");
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function shortHash(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex").slice(0, 12);
}
