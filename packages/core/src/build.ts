import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";

import { compareStrings, resolveInside } from "./path";
import { renderBuildGraph } from "./render";
import { emitGraphWarnings, loadBuildGraph } from "./resolver";
import { sourceWarningDiagnostic, type SkillsetOperationResult } from "./operation-result";
import type { BuildGraph, BuildScope, CheckResult, RenderedFile, SkillsetOptions } from "./types";
import { isJsonRecord, parseMarkdown } from "./yaml";

const WORKSPACE_LOCK_FILE = ".skillset.lock";

/** Mirror root for isolated builds; the full projection lands under it. */
export const ISOLATED_OUT_ROOT = ".skillset/build/out";

/** Maps a repo-relative generated path to its on-disk location. */
type OutPath = (path: string) => string;

const livePath: OutPath = (path) => path;

function outPathMapper(options: SkillsetOptions): OutPath {
  if (options.isolated !== true) return livePath;
  return (path) => join(ISOLATED_OUT_ROOT, path);
}

function mirroredRenderedFiles(
  rendered: readonly RenderedFile[],
  outPath: OutPath
): readonly RenderedFile[] {
  if (outPath === livePath) return rendered;
  return rendered.map((file) => ({ ...file, path: outPath(file.path) }));
}

function mirroredOutputRoots(outputRoots: readonly string[], outPath: OutPath): readonly string[] {
  if (outPath === livePath) return outputRoots;
  return outputRoots.map((outputRoot) => outPath(outputRoot));
}

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
  const outPath = outPathMapper(options);
  const rendered = mirroredRenderedFiles(
    scopedRenderedFiles(graph, await renderBuildGraph(graph), options.scopes),
    outPath
  );
  const liveOutputRoots = scopedOutputRoots(graph, options.scopes);
  const outputRoots = mirroredOutputRoots(liveOutputRoots, outPath);
  const includeWorkspaceLock = includesProjectScope(options.scopes);
  warnLargeInstructionFiles(rendered);
  const expectedPaths = new Set(rendered.map((file) => file.path));
  const previousWorkspaceManagedPaths = includeWorkspaceLock ? await readWorkspaceManagedPaths(rootPath, outPath) : new Set<string>();
  const previousManagedPaths = await readManagedPaths(rootPath, liveOutputRoots, includeWorkspaceLock, outPath);
  await warnMissingManagedOutputs(rootPath, rendered, previousManagedPaths);

  await assertNoUnmanagedWorkspaceOverwrites(
    rootPath,
    outputRoots,
    previousWorkspaceManagedPaths,
    rendered
  );

  if (graph.root.compile.build === "all") {
    for (const outputRoot of outputRoots) {
      await rm(resolveInside(rootPath, outputRoot), { force: true, recursive: true });
    }

    await removeStaleWorkspaceManagedFiles(
      rootPath,
      outputRoots,
      previousWorkspaceManagedPaths,
      expectedPaths
    );

    await writeRenderedFiles(rootPath, rendered);
    return rendered;
  }

  const actualPaths = new Set(await listGeneratedFiles(rootPath, outputRoots, rendered, includeWorkspaceLock, outPath));
  await removeStaleGeneratedFiles(rootPath, actualPaths, expectedPaths);
  await writeChangedRenderedFiles(rootPath, rendered, actualPaths);

  return rendered;
}

export interface SkillsetDiff {
  readonly added: readonly string[];
  readonly changed: readonly string[];
  readonly missing: readonly string[];
  readonly removed: readonly string[];
}

export type SkillsetDiffResult = SkillsetOperationResult<SkillsetDiff>;

/**
 * Compute the generated changes a build would make, without writing anything.
 * Backs `skillset diff` and `skillset doctor`.
 */
export async function diffSkillset(
  rootPath: string,
  options: SkillsetOptions = {}
): Promise<SkillsetDiff> {
  return (await diffSkillsetResult(rootPath, options)).data;
}

export async function diffSkillsetResult(
  rootPath: string,
  options: SkillsetOptions = {}
): Promise<SkillsetDiffResult> {
  const graph = await loadBuildGraph(rootPath, options);
  const outPath = outPathMapper(options);
  const rendered = mirroredRenderedFiles(
    scopedRenderedFiles(graph, await renderBuildGraph(graph), options.scopes),
    outPath
  );
  const expected = new Map(rendered.map((file) => [file.path, file.content]));
  const liveOutputRoots = scopedOutputRoots(graph, options.scopes);
  const outputRoots = mirroredOutputRoots(liveOutputRoots, outPath);
  const includeWorkspaceLock = includesProjectScope(options.scopes);
  const actualPaths = await listGeneratedFiles(rootPath, outputRoots, rendered, includeWorkspaceLock, outPath);
  const actual = new Set(actualPaths);
  const previousManagedPaths = await readManagedPaths(rootPath, liveOutputRoots, includeWorkspaceLock, outPath);

  const added: string[] = [];
  const changed: string[] = [];
  const missing: string[] = [];
  const removed: string[] = [];

  for (const file of rendered) {
    if (!actual.has(file.path)) {
      if (previousManagedPaths.has(file.path)) {
        missing.push(file.path);
      } else {
        added.push(file.path);
      }
      continue;
    }
    const current = await readFile(resolveInside(rootPath, file.path));
    if (!bytesEqual(current, file.content)) changed.push(file.path);
  }
  for (const path of actualPaths) {
    if (!expected.has(path)) removed.push(path);
  }

  const diff = {
    added: [...added].sort(compareStrings),
    changed: [...changed].sort(compareStrings),
    missing: [...missing].sort(compareStrings),
    removed: [...removed].sort(compareStrings),
  };
  return {
    data: diff,
    diagnostics: graph.warnings.map(sourceWarningDiagnostic),
    loweringOutcomes: [],
    ok: true,
    operation: "diff",
    writes: {
      deletedPaths: [],
      mode: "read",
      paths: [],
      writtenPaths: [],
    },
  };
}

export async function checkSkillset(
  rootPath: string,
  options: SkillsetOptions = {}
): Promise<CheckResult> {
  const graph = await loadBuildGraph(rootPath, options);
  emitGraphWarnings(graph);
  const outPath = outPathMapper(options);
  const rendered = mirroredRenderedFiles(
    scopedRenderedFiles(graph, await renderBuildGraph(graph), options.scopes),
    outPath
  );
  warnLargeInstructionFiles(rendered);
  const expected = new Map(rendered.map((file) => [file.path, file.content]));
  const liveOutputRoots = scopedOutputRoots(graph, options.scopes);
  const outputRoots = mirroredOutputRoots(liveOutputRoots, outPath);
  const includeWorkspaceLock = includesProjectScope(options.scopes);
  const actualPaths = await listGeneratedFiles(rootPath, outputRoots, rendered, includeWorkspaceLock, outPath);
  const actual = new Set(actualPaths);
  const previousManagedPaths = await readManagedPaths(rootPath, liveOutputRoots, includeWorkspaceLock, outPath);
  const failures: string[] = [];

  for (const file of rendered) {
    if (!actual.has(file.path)) {
      failures.push(
        previousManagedPaths.has(file.path)
          ? `missing managed generated file: ${file.path}`
          : `missing generated file: ${file.path}`
      );
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

async function warnMissingManagedOutputs(
  rootPath: string,
  rendered: readonly RenderedFile[],
  previousManagedPaths: ReadonlySet<string>
): Promise<void> {
  for (const file of rendered) {
    if (!previousManagedPaths.has(file.path)) continue;
    if (await exists(resolveInside(rootPath, file.path))) continue;
    console.warn(`skillset: managed output is missing and will be regenerated: ${file.path}`);
  }
}

async function writeRenderedFiles(
  rootPath: string,
  rendered: readonly RenderedFile[]
): Promise<void> {
  for (const file of rendered) {
    const outputPath = resolveInside(rootPath, file.path);
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, file.content);
  }
}

async function writeChangedRenderedFiles(
  rootPath: string,
  rendered: readonly RenderedFile[],
  actualPaths: ReadonlySet<string>
): Promise<void> {
  for (const file of rendered) {
    const outputPath = resolveInside(rootPath, file.path);
    if (actualPaths.has(file.path)) {
      const current = await readFile(outputPath);
      if (bytesEqual(current, file.content)) continue;
    }
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, file.content);
  }
}

async function removeStaleGeneratedFiles(
  rootPath: string,
  actualPaths: ReadonlySet<string>,
  expectedPaths: ReadonlySet<string>
): Promise<void> {
  for (const path of actualPaths) {
    if (expectedPaths.has(path)) continue;
    await rm(resolveInside(rootPath, path), { force: true });
  }
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
  rendered: readonly RenderedFile[],
  includeWorkspaceLock: boolean,
  outPath: OutPath
): Promise<readonly string[]> {
  const paths = new Set(await listOutputFiles(rootPath, outputRoots));
  const previousWorkspaceManagedPaths = includeWorkspaceLock ? await readWorkspaceManagedPaths(rootPath, outPath) : new Set<string>();

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

export function scopedRenderedFiles(
  graph: BuildGraph,
  rendered: readonly RenderedFile[],
  scopes: readonly BuildScope[] | undefined
): readonly RenderedFile[] {
  if (scopes === undefined) return rendered;
  return rendered.filter((file) => isPathInScopes(graph, file.path, scopes));
}

export function scopedOutputRoots(
  graph: BuildGraph,
  scopes: readonly BuildScope[] | undefined
): readonly string[] {
  if (scopes === undefined) return graph.outputRoots;
  return graph.outputRoots.filter((outputRoot) => isPathInScopes(graph, outputRoot, scopes));
}

function isPathInScopes(
  graph: BuildGraph,
  path: string,
  scopes: readonly BuildScope[]
): boolean {
  return scopes.includes(scopeForPath(graph, path));
}

function scopeForPath(graph: BuildGraph, path: string): BuildScope {
  if (
    isInsideOutputRoot(path, graph.root.outputs.plugins.claude) ||
    isInsideOutputRoot(path, graph.root.outputs.plugins.codex)
  ) {
    return "plugins";
  }
  if (
    isInsideOutputRoot(path, graph.root.outputs.skills.claude) ||
    isInsideOutputRoot(path, graph.root.outputs.skills.codex)
  ) {
    return "repo";
  }
  return "project";
}

function isInsideOutputRoot(path: string, outputRoot: string): boolean {
  return path === outputRoot || path.startsWith(`${outputRoot}/`);
}

function includesProjectScope(scopes: readonly BuildScope[] | undefined): boolean {
  return scopes === undefined || scopes.includes("project");
}

async function readWorkspaceManagedPaths(rootPath: string, outPath: OutPath): Promise<ReadonlySet<string>> {
  return readManagedPathsFromLock(rootPath, WORKSPACE_LOCK_FILE, ".", outPath);
}

async function readManagedPaths(
  rootPath: string,
  liveOutputRoots: readonly string[],
  includeWorkspaceLock: boolean,
  outPath: OutPath
): Promise<ReadonlySet<string>> {
  const paths = includeWorkspaceLock ? new Set(await readWorkspaceManagedPaths(rootPath, outPath)) : new Set<string>();
  for (const outputRoot of liveOutputRoots) {
    const lockPath = join(outputRoot, WORKSPACE_LOCK_FILE);
    const managed = await readManagedPathsFromLock(rootPath, lockPath, outputRoot, outPath);
    for (const path of managed) paths.add(path);
  }
  return paths;
}

/**
 * Reads managed paths from a generated lock. `lockPath` and
 * `expectedOutputRoot` stay in live repo-relative form because lock content
 * records live output roots even when written into the isolated mirror;
 * `outPath` maps the read location and the returned paths to the mirror.
 */
async function readManagedPathsFromLock(
  rootPath: string,
  lockPath: string,
  expectedOutputRoot: string,
  outPath: OutPath
): Promise<ReadonlySet<string>> {
  const displayLockPath = outPath(lockPath);
  const absoluteLockPath = resolveInside(rootPath, displayLockPath);
  if (!(await exists(absoluteLockPath))) return new Set();

  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(absoluteLockPath, "utf8")) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw corruptManagedLock(lockPath, displayLockPath, `it is not valid JSON: ${message}`);
  }

  if (!isRecord(parsed) || typeof parsed.generatedBy !== "string") {
    throw corruptManagedLock(lockPath, displayLockPath, "it is missing a string generatedBy field");
  }
  if (!parsed.generatedBy.startsWith("skillset@")) {
    throw corruptManagedLock(lockPath, displayLockPath, `its generatedBy ${JSON.stringify(parsed.generatedBy)} is not a skillset lock`);
  }
  if (
    lockPath !== WORKSPACE_LOCK_FILE &&
    parsed.outputRoot === undefined &&
    parsed.items === undefined
  ) {
    return new Set([displayLockPath]);
  }
  if (parsed.outputRoot !== expectedOutputRoot) {
    const expected = expectedOutputRoot === "." ? "the workspace root" : JSON.stringify(expectedOutputRoot);
    throw corruptManagedLock(lockPath, displayLockPath, `its outputRoot ${JSON.stringify(parsed.outputRoot)} is not ${expected}`);
  }
  if (!Array.isArray(parsed.items)) {
    throw corruptManagedLock(lockPath, displayLockPath, "its items field is not an array");
  }

  const paths = new Set<string>([displayLockPath]);
  for (const item of parsed.items) {
    if (!isRecord(item) || !Array.isArray(item.files)) {
      throw corruptManagedLock(lockPath, displayLockPath, "one of its items is missing a files array");
    }
    for (const file of item.files) {
      if (typeof file !== "string" || file.trim().length === 0) {
        throw corruptManagedLock(lockPath, displayLockPath, "one of its tracked file entries is not a non-empty string");
      }
      paths.add(outPath(joinOutputRoot(expectedOutputRoot, file)));
    }
  }

  return paths;
}

function joinOutputRoot(outputRoot: string, file: string): string {
  if (outputRoot === "." || outputRoot === "") return file;
  return `${outputRoot}/${file}`;
}

function corruptManagedLock(lockPath: string, displayLockPath: string, reason: string): Error {
  if (lockPath === WORKSPACE_LOCK_FILE) return corruptWorkspaceLock(displayLockPath, reason);
  return new Error(
    `skillset: generated lock ${displayLockPath} cannot guard generated state because ${reason}. ` +
      "Fix or remove the lock before running build, check, or diff."
  );
}

function corruptWorkspaceLock(displayLockPath: string, reason: string): Error {
  return new Error(
    `skillset: workspace lock ${displayLockPath} cannot guard generated state because ${reason}. ` +
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
