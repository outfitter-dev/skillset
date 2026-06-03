import { stat } from "node:fs/promises";

import { resolveInside } from "./path";
import type { JsonRecord, JsonValue, SourceResource } from "./types";
import { isJsonRecord } from "./yaml";

const RESOURCE_GROUPS = new Set(["assets", "references", "scripts", "templates"]);

export interface ResourceContext {
  readonly label: string;
  readonly pluginSharedPath?: string;
  readonly sharedPath: string;
}

export async function readSkillResources(
  raw: JsonValue | undefined,
  context: ResourceContext
): Promise<readonly SourceResource[]> {
  if (raw === undefined) return [];

  const pending = readResourceEntries(raw, context.label);
  const resources: SourceResource[] = [];
  const targetPaths = new Set<string>();

  for (const entry of pending) {
    const resource = await resolveResource(entry, context);
    if (targetPaths.has(resource.targetPath)) {
      throw new Error(
        `skillset: ${context.label}.resources maps multiple resources to ${resource.targetPath}`
      );
    }
    targetPaths.add(resource.targetPath);
    resources.push(resource);
  }

  return resources.sort((left, right) => left.targetPath.localeCompare(right.targetPath));
}

interface PendingResource {
  readonly from: string;
  readonly group?: string;
  readonly to?: string;
}

function readResourceEntries(raw: JsonValue, label: string): readonly PendingResource[] {
  if (typeof raw === "string" || Array.isArray(raw)) return readResourceEntryList(raw, label);
  if (!isJsonRecord(raw)) {
    throw new Error(`skillset: expected ${label}.resources to be a string, array, or object`);
  }

  if (raw.from !== undefined) {
    return [readResourceEntry(raw, undefined, label)];
  }

  const entries: PendingResource[] = [];
  for (const [key, value] of Object.entries(raw)) {
    if (!RESOURCE_GROUPS.has(key)) {
      throw new Error(`skillset: unsupported resource group ${key} in ${label}.resources`);
    }
    entries.push(...readResourceEntryList(value, `${label}.resources.${key}`, key));
  }
  return entries;
}

function readResourceEntryList(
  raw: JsonValue | undefined,
  label: string,
  group?: string
): readonly PendingResource[] {
  if (raw === undefined) return [];
  if (Array.isArray(raw)) return raw.map((entry) => readResourceEntry(entry, group, label));
  return [readResourceEntry(raw, group, label)];
}

function readResourceEntry(raw: JsonValue, group: string | undefined, label: string): PendingResource {
  if (typeof raw === "string") return { from: raw, ...(group === undefined ? {} : { group }) };
  if (!isJsonRecord(raw)) {
    throw new Error(`skillset: expected ${label} resource entries to be strings or objects`);
  }

  const keys = new Set(Object.keys(raw));
  keys.delete("from");
  keys.delete("to");
  if (keys.size > 0) {
    throw new Error(`skillset: unsupported resource entry key ${[...keys][0]} in ${label}`);
  }

  const from = readNonEmptyString(raw, "from", label);
  const to = raw.to === undefined ? undefined : readNonEmptyString(raw, "to", label);
  return {
    from,
    ...(group === undefined ? {} : { group }),
    ...(to === undefined ? {} : { to }),
  };
}

function readNonEmptyString(raw: JsonRecord, key: string, label: string): string {
  const value = raw[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`skillset: expected ${label}.${key} to be a non-empty string`);
  }
  return value.trim();
}

async function resolveResource(
  entry: PendingResource,
  context: ResourceContext
): Promise<SourceResource> {
  const parsed = parseResourcePath(entry.from, context);
  const targetPath = validateResourceTargetPath(
    entry.to ?? defaultTargetPath(parsed.relativePath, entry.group),
    context.label
  );
  const sourcePath = resolveInside(parsed.root, parsed.relativePath);

  if (!(await sourceExists(sourcePath))) {
    throw new Error(`skillset: ${context.label}.resources source not found: ${entry.from}`);
  }

  return {
    from: parsed.from,
    sourcePath,
    targetPath,
  };
}

interface ParsedResourcePath {
  readonly from: string;
  readonly relativePath: string;
  readonly root: string;
}

function parseResourcePath(raw: string, context: ResourceContext): ParsedResourcePath {
  const value = raw.trim();
  const separatorIndex = value.indexOf(":");
  if (separatorIndex <= 0) {
    throw new Error(
      `skillset: ${context.label}.resources must use shared:, root:, or plugin: resource paths`
    );
  }

  const scheme = value.slice(0, separatorIndex);
  const relativePath = validateResourceSourcePath(value.slice(separatorIndex + 1), context.label);
  if (scheme === "shared" || scheme === "root") {
    return {
      from: `shared:${relativePath}`,
      relativePath,
      root: context.sharedPath,
    };
  }
  if (scheme === "plugin") {
    if (context.pluginSharedPath === undefined) {
      throw new Error(`skillset: ${context.label}.resources uses plugin: outside a plugin skill`);
    }
    return {
      from: `plugin:${relativePath}`,
      relativePath,
      root: context.pluginSharedPath,
    };
  }

  throw new Error(
    `skillset: ${context.label}.resources must use shared:, root:, or plugin: resource paths`
  );
}

function validateResourceSourcePath(raw: string, label: string): string {
  const value = normalizeResourcePath(raw);
  if (value.length === 0) {
    throw new Error(`skillset: ${label}.resources has an empty source path`);
  }
  if (isUnsafeRelativePath(value)) {
    throw new Error(`skillset: ${label}.resources source paths must stay inside shared roots`);
  }
  return value;
}

function validateResourceTargetPath(raw: string, label: string): string {
  const value = normalizeResourcePath(raw);
  if (value.length === 0) {
    throw new Error(`skillset: ${label}.resources has an empty target path`);
  }
  if (isUnsafeRelativePath(value)) {
    throw new Error(`skillset: ${label}.resources target paths must stay inside the generated skill`);
  }
  if (
    value === "SKILL.md" ||
    value === "agents/openai.yaml" ||
    value === ".skillset.tools.yaml"
  ) {
    throw new Error(`skillset: ${label}.resources cannot write generated skill control file ${value}`);
  }
  return value;
}

function defaultTargetPath(sourcePath: string, group: string | undefined): string {
  if (group === undefined) return sourcePath;
  if (sourcePath === group || sourcePath.startsWith(`${group}/`)) return sourcePath;
  return `${group}/${sourcePath}`;
}

function normalizeResourcePath(raw: string): string {
  return raw
    .trim()
    .replaceAll("\\", "/")
    .replace(/^\.\//, "")
    .replace(/\/+/g, "/")
    .replace(/\/$/, "");
}

function isUnsafeRelativePath(path: string): boolean {
  return path.startsWith("/") || path.split("/").some((segment) => segment === "." || segment === "..");
}

async function sourceExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

export function rewriteResourceLinks(
  body: string,
  resources: readonly SourceResource[],
  label: string
): string {
  const replacements = new Map(resources.map((resource) => [resource.from, resource.targetPath]));
  return body.replaceAll(/(!?\[[^\]\n]*\]\()([^) \t\n]+)(\))/g, (match, open, target, close) => {
    const rewritten = rewriteResourceTarget(String(target), replacements, label);
    return rewritten === undefined ? String(match) : `${open}${rewritten}${close}`;
  });
}

function rewriteResourceTarget(
  target: string,
  replacements: ReadonlyMap<string, string>,
  label: string
): string | undefined {
  const hashIndex = target.indexOf("#");
  const base = hashIndex === -1 ? target : target.slice(0, hashIndex);
  const suffix = hashIndex === -1 ? "" : target.slice(hashIndex);
  const normalizedBase = canonicalResourceReference(base);
  const replacement = replacements.get(normalizedBase);
  if (replacement === undefined && isResourceReference(normalizedBase)) {
    throw new Error(
      `skillset: ${label} links to undeclared shared resource ${base}; add it to resources`
    );
  }
  return replacement === undefined ? undefined : `${replacement}${suffix}`;
}

function canonicalResourceReference(value: string): string {
  const separatorIndex = value.indexOf(":");
  if (separatorIndex <= 0) return value;
  const scheme = value.slice(0, separatorIndex);
  const resourcePath = normalizeResourcePath(value.slice(separatorIndex + 1));
  if (scheme === "root") return `shared:${resourcePath}`;
  if (scheme === "shared" || scheme === "plugin") return `${scheme}:${resourcePath}`;
  return value;
}

function isResourceReference(value: string): boolean {
  return value.startsWith("shared:") || value.startsWith("plugin:");
}
