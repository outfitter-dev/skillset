import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";

import { compareStrings, resolveInside } from "./path";
import { renderBuildGraph } from "./render";
import { emitGraphWarnings, loadBuildGraph } from "./resolver";
import type { CheckResult, RenderedFile, SkillsetOptions } from "./types";
import { isJsonRecord, parseMarkdown } from "./yaml";

const WORKSPACE_LOCK_FILE = ".skillset.lock";
const textDecoder = new TextDecoder();

/**
 * Codex truncates AGENTS.md content beyond `project_doc_max_bytes` (32 KiB by
 * default) silently. Warn before a generated AGENTS.md crosses that line.
 * Verified against developers.openai.com/codex/guides/agents-md (2026-06-03).
 */
const CODEX_AGENTS_MAX_BYTES = 32 * 1024;

function warnLargeInstructionFiles(rendered: readonly RenderedFile[]): void {
  for (const file of rendered) {
    if (file.path !== "AGENTS.md" && !file.path.endsWith("/AGENTS.md")) continue;
    if (file.content.byteLength <= CODEX_AGENTS_MAX_BYTES) continue;
    console.warn(
      `skillset: generated ${file.path} is ${file.content.byteLength} bytes, over Codex's default ` +
        `project_doc_max_bytes (${CODEX_AGENTS_MAX_BYTES}); Codex silently truncates beyond it. ` +
        "Split instructions across nested directories or raise project_doc_max_bytes."
    );
  }
}

export async function buildSkillset(
  rootPath: string,
  options: SkillsetOptions = {}
): Promise<readonly RenderedFile[]> {
  const graph = await loadBuildGraph(rootPath, options);
  emitGraphWarnings(graph);
  const rendered = await renderBuildGraph(graph);
  warnLargeInstructionFiles(rendered);
  const expectedPaths = new Set(rendered.map((file) => file.path));
  const previousWorkspaceManagedPaths = await readWorkspaceManagedPaths(rootPath);

  await assertNoUnmanagedWorkspaceOverwrites(
    rootPath,
    graph.outputRoots,
    previousWorkspaceManagedPaths,
    rendered
  );

  for (const outputRoot of graph.outputRoots) {
    await rm(resolveInside(rootPath, outputRoot), { force: true, recursive: true });
  }

  await removeStaleWorkspaceManagedFiles(
    rootPath,
    graph.outputRoots,
    previousWorkspaceManagedPaths,
    expectedPaths
  );

  for (const file of rendered) {
    const outputPath = resolveInside(rootPath, file.path);
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, file.content);
  }

  return rendered;
}

export interface SkillsetDiff {
  readonly added: readonly string[];
  readonly changed: readonly string[];
  readonly removed: readonly string[];
}

/**
 * Compute the generated changes a build would make, without writing anything.
 * Backs `skillset diff` and `skillset doctor`.
 */
export async function diffSkillset(
  rootPath: string,
  options: SkillsetOptions = {}
): Promise<SkillsetDiff> {
  const graph = await loadBuildGraph(rootPath, options);
  const rendered = await renderBuildGraph(graph);
  const expected = new Map(rendered.map((file) => [file.path, file.content]));
  const actualPaths = await listGeneratedFiles(rootPath, graph.outputRoots, rendered);
  const actual = new Set(actualPaths);

  const added: string[] = [];
  const changed: string[] = [];
  const removed: string[] = [];

  for (const file of rendered) {
    if (!actual.has(file.path)) {
      added.push(file.path);
      continue;
    }
    const current = await readFile(resolveInside(rootPath, file.path));
    if (!bytesEqual(current, file.content)) changed.push(file.path);
  }
  for (const path of actualPaths) {
    if (!expected.has(path)) removed.push(path);
  }

  return {
    added: [...added].sort(compareStrings),
    changed: [...changed].sort(compareStrings),
    removed: [...removed].sort(compareStrings),
  };
}

export async function checkSkillset(
  rootPath: string,
  options: SkillsetOptions = {}
): Promise<CheckResult> {
  const graph = await loadBuildGraph(rootPath, options);
  emitGraphWarnings(graph);
  const rendered = await renderBuildGraph(graph);
  warnLargeInstructionFiles(rendered);
  const expected = new Map(rendered.map((file) => [file.path, file.content]));
  const actualPaths = await listGeneratedFiles(rootPath, graph.outputRoots, rendered);
  const actual = new Set(actualPaths);
  const failures: string[] = [];

  for (const file of rendered) {
    if (!actual.has(file.path)) {
      failures.push(`missing generated file: ${file.path}`);
      continue;
    }

    const outputPath = resolveInside(rootPath, file.path);
    const current = await readFile(outputPath);
    if (!bytesEqual(current, file.content)) {
      failures.push(versionDriftMessage(file.path, current, file.content) ?? `stale generated file: ${file.path}`);
    }
  }

  for (const path of actualPaths) {
    if (!expected.has(path)) {
      failures.push(`stale generated file: ${path}`);
    }
  }

  if (failures.length > 0) {
    throw new Error(`skillset: generated output is not current\n${failures.join("\n")}`);
  }

  return { checkedFiles: rendered.length };
}

async function listOutputFiles(
  rootPath: string,
  outputRoots: readonly string[]
): Promise<readonly string[]> {
  const paths: string[] = [];
  for (const outputRoot of outputRoots) {
    const absoluteTarget = resolveInside(rootPath, outputRoot);
    if (!(await exists(absoluteTarget))) continue;
    for (const file of await collectFiles(absoluteTarget)) {
      paths.push(relative(rootPath, file));
    }
  }
  return paths.sort();
}

async function listGeneratedFiles(
  rootPath: string,
  outputRoots: readonly string[],
  rendered: readonly RenderedFile[]
): Promise<readonly string[]> {
  const paths = new Set(await listOutputFiles(rootPath, outputRoots));
  const previousWorkspaceManagedPaths = await readWorkspaceManagedPaths(rootPath);

  for (const path of previousWorkspaceManagedPaths) {
    if (isInsideAnyOutputRoot(path, outputRoots)) continue;
    if (await exists(resolveInside(rootPath, path))) paths.add(path);
  }

  for (const file of rendered) {
    if (isInsideAnyOutputRoot(file.path, outputRoots)) continue;
    if (await exists(resolveInside(rootPath, file.path))) paths.add(file.path);
  }

  return [...paths].sort();
}

async function collectFiles(root: string): Promise<readonly string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries.sort((left, right) => compareStrings(left.name, right.name))) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(path)));
    } else if (entry.isFile()) {
      files.push(path);
    }
  }
  return files;
}

async function removeStaleWorkspaceManagedFiles(
  rootPath: string,
  outputRoots: readonly string[],
  previousManagedPaths: ReadonlySet<string>,
  expectedPaths: ReadonlySet<string>
): Promise<void> {
  for (const path of previousManagedPaths) {
    if (isInsideAnyOutputRoot(path, outputRoots)) continue;
    if (expectedPaths.has(path)) continue;
    await rm(resolveInside(rootPath, path), { force: true });
  }
}

async function assertNoUnmanagedWorkspaceOverwrites(
  rootPath: string,
  outputRoots: readonly string[],
  previousManagedPaths: ReadonlySet<string>,
  rendered: readonly RenderedFile[]
): Promise<void> {
  for (const file of rendered) {
    if (isInsideAnyOutputRoot(file.path, outputRoots)) continue;
    if (previousManagedPaths.has(file.path)) continue;
    if (!(await exists(resolveInside(rootPath, file.path)))) continue;
    throw new Error(
      `skillset: refusing to overwrite unmanaged workspace file ${file.path}; ` +
        `move it into .skillset/instructions or remove it before generating instructions`
    );
  }
}

function isInsideAnyOutputRoot(path: string, outputRoots: readonly string[]): boolean {
  return outputRoots.some(
    (outputRoot) => path === outputRoot || path.startsWith(`${outputRoot}/`)
  );
}

async function readWorkspaceManagedPaths(rootPath: string): Promise<ReadonlySet<string>> {
  const lockPath = resolveInside(rootPath, WORKSPACE_LOCK_FILE);
  if (!(await exists(lockPath))) return new Set();

  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(lockPath, "utf8")) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw corruptWorkspaceLock(`it is not valid JSON: ${message}`);
  }

  if (!isRecord(parsed) || typeof parsed.generatedBy !== "string") {
    throw corruptWorkspaceLock("it is missing a string generatedBy field");
  }
  if (!parsed.generatedBy.startsWith("skillset@")) {
    throw corruptWorkspaceLock(`its generatedBy ${JSON.stringify(parsed.generatedBy)} is not a skillset lock`);
  }
  if (parsed.outputRoot !== ".") {
    throw corruptWorkspaceLock(`its outputRoot ${JSON.stringify(parsed.outputRoot)} is not the workspace root`);
  }
  if (!Array.isArray(parsed.items)) {
    throw corruptWorkspaceLock("its items field is not an array");
  }

  const paths = new Set<string>([WORKSPACE_LOCK_FILE]);
  for (const item of parsed.items) {
    if (!isRecord(item) || !Array.isArray(item.files)) {
      throw corruptWorkspaceLock("one of its items is missing a files array");
    }
    for (const file of item.files) {
      if (typeof file !== "string" || file.trim().length === 0) {
        throw corruptWorkspaceLock("one of its tracked file entries is not a non-empty string");
      }
      paths.add(file);
    }
  }

  return paths;
}

function corruptWorkspaceLock(reason: string): Error {
  return new Error(
    `skillset: workspace lock ${WORKSPACE_LOCK_FILE} cannot guard generated state because ${reason}. ` +
      "Restore it from a clean build (skillset build) or remove it deliberately before rebuilding."
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function versionDriftMessage(
  path: string,
  current: Uint8Array,
  expected: Uint8Array
): string | undefined {
  const expectedVersion = generatedVersion(path, expected, "expected");
  if (expectedVersion === undefined) return undefined;

  const currentVersion = generatedVersion(path, current, "current");
  if (currentVersion === expectedVersion) return undefined;

  const field = path.endsWith("/SKILL.md") ? "metadata.version" : "version";
  return `version drift: ${path} ${field} is ${currentVersion ?? "missing"}, expected ${expectedVersion}`;
}

function generatedVersion(
  path: string,
  content: Uint8Array,
  label: string
): string | undefined {
  if (path.endsWith("/SKILL.md")) {
    return generatedSkillVersion(path, content, label);
  }
  if (
    path.endsWith("/.claude-plugin/plugin.json") ||
    path.endsWith("/.codex-plugin/plugin.json")
  ) {
    return generatedPluginVersion(content);
  }
  return undefined;
}

function generatedSkillVersion(
  path: string,
  content: Uint8Array,
  label: string
): string | undefined {
  let frontmatter;
  try {
    frontmatter = parseMarkdown(textDecoder.decode(content), `${label} ${path}`).frontmatter;
  } catch {
    return undefined;
  }
  const metadata = frontmatter.metadata;
  if (!isJsonRecord(metadata)) return undefined;
  const version = metadata.version;
  return typeof version === "string" && version.trim().length > 0 ? version.trim() : undefined;
}

function generatedPluginVersion(content: Uint8Array): string | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(textDecoder.decode(content)) as unknown;
  } catch {
    return undefined;
  }
  if (!isRecord(parsed)) return undefined;
  const version = parsed.version;
  return typeof version === "string" && version.trim().length > 0 ? version.trim() : undefined;
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

async function exists(path: string): Promise<boolean> {
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
