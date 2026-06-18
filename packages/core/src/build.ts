import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";

import { compareStrings, resolveInside } from "./path";
import { collectRenderResults } from "./render-result-collector";
import { enforceRenderResultPolicy } from "./render-result-policy";
import {
  diagnoseOutputBackupPreflight,
  prepareOutputBackups,
  readManagedOutputState,
  withBackupSummary,
} from "./output-safety";
import { renderBuildGraph } from "./render";
import { loadBuildGraph } from "./resolver";
import { renderValidatedJson } from "./structured-output";
import {
  sourceWarningDiagnostic,
  type SkillsetDiagnostic,
  type SkillsetOperationResult,
  type SkillsetWriteSummary,
} from "./operation-result";
import { defineRenderResult, type SkillsetRenderResult } from "./render-result";
import type { BuildGraph, BuildScope, CheckResult, JsonRecord, JsonValue, RenderedFile, SkillsetOptions } from "./types";
import { isJsonRecord, parseMarkdown } from "./yaml";

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
const textEncoder = new TextEncoder();

/**
 * Codex truncates AGENTS.md content beyond `project_doc_max_bytes` (32 KiB by
 * default) silently. Warn before a generated AGENTS.md crosses that line.
 * Verified against developers.openai.com/codex/guides/agents-md (2026-06-03).
 */
const CODEX_AGENTS_MAX_BYTES = 32 * 1024;

function diagnoseLargeInstructionFiles(rendered: readonly RenderedFile[]): readonly SkillsetDiagnostic[] {
  const diagnostics: SkillsetDiagnostic[] = [];
  for (const file of rendered) {
    if (file.path !== "AGENTS.md" && !file.path.endsWith("/AGENTS.md")) continue;
    if (file.content.byteLength <= CODEX_AGENTS_MAX_BYTES) continue;
    diagnostics.push({
      code: "codex-agents-size",
      featureId: "project-instructions",
      message:
        `generated ${file.path} is ${file.content.byteLength} bytes, over Codex's default ` +
        `project_doc_max_bytes (${CODEX_AGENTS_MAX_BYTES}); Codex silently truncates beyond it. ` +
        "Split instructions across nested directories or raise project_doc_max_bytes.",
      outputPath: file.path,
      severity: "warning",
      target: "codex",
    });
  }
  return diagnostics;
}

export type SkillsetBuildResult = SkillsetOperationResult<readonly RenderedFile[]>;

export async function buildSkillset(
  rootPath: string,
  options: SkillsetOptions = {}
): Promise<readonly RenderedFile[]> {
  return (await buildSkillsetResult(rootPath, options)).data;
}

export async function buildSkillsetResult(
  rootPath: string,
  options: SkillsetOptions = {}
): Promise<SkillsetBuildResult> {
  const graph = await loadBuildGraph(rootPath, options);
  const diagnostics = [...graph.warnings.map(sourceWarningDiagnostic)];
  const outPath = outPathMapper(options);
  const allRendered = await renderBuildGraph(graph);
  const scopedRendered = scopedRenderedFiles(graph, allRendered, options.scopes);
  const renderResults = collectRenderResults(graph, allRendered, {
    includedPaths: new Set(scopedRendered.map((file) => file.path)),
    mapOutputPath: outPath,
    scopes: options.scopes,
  });
  enforceRenderResultPolicy(renderResults, graph.root.compile.unsupportedDestination);
  const renderedWithoutOutcomeMetadata = mirroredRenderedFiles(scopedRendered, outPath);
  const instructionDiagnostics = diagnoseLargeInstructionFiles(renderedWithoutOutcomeMetadata);
  diagnostics.push(...instructionDiagnostics);
  const renderResultsWithDiagnostics = attachDiagnosticsToRenderResults(renderResults, instructionDiagnostics);
  const rendered = withPersistedRenderResults(
    renderedWithoutOutcomeMetadata,
    renderResultsWithDiagnostics
  );
  const liveOutputRoots = scopedOutputRoots(graph, options.scopes);
  const outputRoots = mirroredOutputRoots(liveOutputRoots, outPath);
  const includeWorkspaceLock = includesProjectScope(options.scopes);
  const expectedPaths = new Set(rendered.map((file) => file.path));
  const previousManagedState = await readManagedOutputState(rootPath, liveOutputRoots, includeWorkspaceLock, outPath);
  diagnostics.push(...await diagnoseMissingManagedOutputs(rootPath, rendered, previousManagedState.paths));

  if (graph.root.compile.build === "all") {
    const staleManagedPaths = staleManagedOutputPaths(previousManagedState.paths, expectedPaths);
    const safety = await prepareOutputBackups(rootPath, rendered, staleManagedPaths, previousManagedState);
    diagnostics.push(...safety.diagnostics);

    const deletedPaths = await removeStaleGeneratedFiles(rootPath, new Set(staleManagedPaths), expectedPaths);
    const writtenPaths = await writeRenderedFiles(rootPath, rendered);
    return buildResult(rendered, diagnostics, renderResultsWithDiagnostics, withBackupSummary(writeSummary(writtenPaths, deletedPaths), safety.backup));
  }

  const actualPaths = new Set(await listGeneratedFiles(rootPath, outputRoots, rendered, previousManagedState.paths));
  const staleManagedPaths = staleManagedOutputPaths(previousManagedState.paths, expectedPaths).filter((path) => actualPaths.has(path));
  const safety = await prepareOutputBackups(rootPath, rendered, staleManagedPaths, previousManagedState);
  diagnostics.push(...safety.diagnostics);

  const deletedPaths = await removeStaleGeneratedFiles(rootPath, new Set(staleManagedPaths), expectedPaths);
  const writtenPaths = await writeChangedRenderedFiles(rootPath, rendered, actualPaths);

  return buildResult(rendered, diagnostics, renderResultsWithDiagnostics, withBackupSummary(writeSummary(writtenPaths, deletedPaths), safety.backup));
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
  const diagnostics = [...graph.warnings.map(sourceWarningDiagnostic)];
  const outPath = outPathMapper(options);
  const allRendered = await renderBuildGraph(graph);
  const scopedRendered = scopedRenderedFiles(graph, allRendered, options.scopes);
  const renderResults = collectRenderResults(graph, allRendered, {
    includedPaths: new Set(scopedRendered.map((file) => file.path)),
    mapOutputPath: outPath,
    scopes: options.scopes,
  });
  enforceRenderResultPolicy(renderResults, graph.root.compile.unsupportedDestination);
  const renderedWithoutOutcomeMetadata = mirroredRenderedFiles(scopedRendered, outPath);
  const instructionDiagnostics = diagnoseLargeInstructionFiles(renderedWithoutOutcomeMetadata);
  diagnostics.push(...instructionDiagnostics);
  const renderResultsWithDiagnostics = attachDiagnosticsToRenderResults(renderResults, instructionDiagnostics);
  const rendered = withPersistedRenderResults(
    renderedWithoutOutcomeMetadata,
    renderResultsWithDiagnostics
  );
  const expected = new Map(rendered.map((file) => [file.path, file.content]));
  const liveOutputRoots = scopedOutputRoots(graph, options.scopes);
  const outputRoots = mirroredOutputRoots(liveOutputRoots, outPath);
  const includeWorkspaceLock = includesProjectScope(options.scopes);
  const previousManagedState = await readManagedOutputState(rootPath, liveOutputRoots, includeWorkspaceLock, outPath);
  const actualPaths = await listGeneratedFiles(rootPath, outputRoots, rendered, previousManagedState.paths);
  const actual = new Set(actualPaths);
  const staleManagedPaths = staleManagedOutputPaths(previousManagedState.paths, new Set(expected.keys())).filter((path) => actual.has(path));
  diagnostics.push(...await diagnoseOutputBackupPreflight(rootPath, rendered, staleManagedPaths, previousManagedState));

  const added: string[] = [];
  const changed: string[] = [];
  const missing: string[] = [];
  const removed: string[] = [];

  for (const file of rendered) {
    if (!actual.has(file.path)) {
      if (previousManagedState.paths.has(file.path)) {
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
    if (!previousManagedState.paths.has(path)) continue;
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
    diagnostics,
    renderResults: renderResultsWithDiagnostics,
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
  const result = await checkSkillsetResult(rootPath, options);
  if (!result.ok) {
    throw new Error(`skillset: generated output is not current\n${result.data.failures.join("\n")}`);
  }
  return result.data;
}

export type SkillsetCheckResult = SkillsetOperationResult<CheckResult>;

export async function checkSkillsetResult(
  rootPath: string,
  options: SkillsetOptions = {}
): Promise<SkillsetCheckResult> {
  const graph = await loadBuildGraph(rootPath, options);
  const diagnostics = [...graph.warnings.map(sourceWarningDiagnostic)];
  const outPath = outPathMapper(options);
  const allRendered = await renderBuildGraph(graph);
  const scopedRendered = scopedRenderedFiles(graph, allRendered, options.scopes);
  const renderResults = collectRenderResults(graph, allRendered, {
    includedPaths: new Set(scopedRendered.map((file) => file.path)),
    mapOutputPath: outPath,
    scopes: options.scopes,
  });
  enforceRenderResultPolicy(renderResults, graph.root.compile.unsupportedDestination);
  const renderedWithoutOutcomeMetadata = mirroredRenderedFiles(scopedRendered, outPath);
  const instructionDiagnostics = diagnoseLargeInstructionFiles(renderedWithoutOutcomeMetadata);
  diagnostics.push(...instructionDiagnostics);
  const renderResultsWithDiagnostics = attachDiagnosticsToRenderResults(renderResults, instructionDiagnostics);
  const rendered = withPersistedRenderResults(
    renderedWithoutOutcomeMetadata,
    renderResultsWithDiagnostics
  );
  const expected = new Map(rendered.map((file) => [file.path, file.content]));
  const liveOutputRoots = scopedOutputRoots(graph, options.scopes);
  const outputRoots = mirroredOutputRoots(liveOutputRoots, outPath);
  const includeWorkspaceLock = includesProjectScope(options.scopes);
  const previousManagedState = await readManagedOutputState(rootPath, liveOutputRoots, includeWorkspaceLock, outPath);
  const actualPaths = await listGeneratedFiles(rootPath, outputRoots, rendered, previousManagedState.paths);
  const actual = new Set(actualPaths);
  const failures: string[] = [];
  const driftDiagnostics: SkillsetDiagnostic[] = [];

  for (const file of rendered) {
    if (!actual.has(file.path)) {
      failures.push(
        previousManagedState.paths.has(file.path)
          ? `missing managed generated file: ${file.path}`
          : `missing generated file: ${file.path}`
      );
      driftDiagnostics.push(generatedDriftDiagnostic(
        previousManagedState.paths.has(file.path) ? "missing-managed" : "missing",
        file.path
      ));
      continue;
    }

    const outputPath = resolveInside(rootPath, file.path);
    const current = await readFile(outputPath);
    if (!bytesEqual(current, file.content)) {
      const message = versionDriftMessage(file.path, current, file.content) ?? `stale generated file: ${file.path}`;
      failures.push(message);
      driftDiagnostics.push(generatedDriftDiagnostic("changed", file.path, message));
    }
  }

  for (const path of actualPaths) {
    if (!previousManagedState.paths.has(path)) continue;
    if (!expected.has(path)) {
      failures.push(`stale generated file: ${path}`);
      driftDiagnostics.push(generatedDriftDiagnostic("removed", path));
    }
  }

  return {
    data: { checkedFiles: rendered.length, failures },
    diagnostics: [...diagnostics, ...driftDiagnostics],
    renderResults: renderResultsWithDiagnostics,
    ok: failures.length === 0,
    operation: "check",
    writes: {
      deletedPaths: [],
      mode: "read",
      paths: [],
      writtenPaths: [],
    },
  };
}

function generatedDriftDiagnostic(
  kind: "changed" | "missing" | "missing-managed" | "removed",
  path: string,
  message = generatedDriftMessage(kind, path)
): SkillsetDiagnostic {
  return {
    code: `generated-output-${kind}`,
    message,
    outputPath: path,
    severity: "error",
  };
}

function generatedDriftMessage(
  kind: "changed" | "missing" | "missing-managed" | "removed",
  path: string
): string {
  if (kind === "changed") return `stale generated file: ${path}`;
  if (kind === "missing") return `missing generated file: ${path}`;
  if (kind === "missing-managed") return `missing managed generated file: ${path}`;
  return `stale generated file: ${path}`;
}

function buildResult(
  rendered: readonly RenderedFile[],
  diagnostics: readonly SkillsetDiagnostic[],
  renderResults: readonly SkillsetRenderResult[],
  writes: SkillsetWriteSummary
): SkillsetBuildResult {
  return {
    data: rendered,
    diagnostics,
    renderResults,
    ok: true,
    operation: "build",
    writes,
  };
}

function attachDiagnosticsToRenderResults(
  renderResults: readonly SkillsetRenderResult[],
  diagnostics: readonly SkillsetDiagnostic[]
): readonly SkillsetRenderResult[] {
  const outputDiagnostics = diagnostics.filter((diagnostic) => diagnostic.outputPath !== undefined);
  if (outputDiagnostics.length === 0) return renderResults;

  return renderResults.map((outcome) => {
    const outputPaths = new Set((outcome.outputs ?? []).map((output) => output.path));
    if (outputPaths.size === 0) return outcome;
    const matching = outputDiagnostics.filter((diagnostic) => {
      if (diagnostic.outputPath === undefined || !outputPaths.has(diagnostic.outputPath)) return false;
      if (diagnostic.target !== undefined && diagnostic.target !== outcome.target) return false;
      return diagnostic.featureId === undefined || diagnostic.featureId === outcome.featureId;
    });
    if (matching.length === 0) return outcome;
    return defineRenderResult({
      ...outcome,
      diagnostics: [
        ...(outcome.diagnostics ?? []),
        ...matching.map((diagnostic) => diagnosticRefForOutput(diagnostic)),
      ],
    });
  });
}

function diagnosticRefForOutput(diagnostic: SkillsetDiagnostic): {
  readonly code: string;
  readonly message: string;
  readonly path: string;
} {
  if (diagnostic.outputPath === undefined) {
    throw new Error("skillset: render result diagnostic ref requires an output path");
  }
  return {
    code: diagnostic.code,
    message: diagnostic.message,
    path: diagnostic.outputPath,
  };
}

function withPersistedRenderResults(
  rendered: readonly RenderedFile[],
  renderResults: readonly SkillsetRenderResult[]
): readonly RenderedFile[] {
  if (renderResults.length === 0) return rendered;
  return rendered.map((file) => {
    if (!isLockFilePath(file.path)) return file;
    const lock = parseLockFile(file);
    const lockOutcomes = renderResultsForLock(file.path, lock, renderResults);
    const value: JsonRecord = {
      ...lock,
      ...(lockOutcomes.length === 0 ? {} : { renderResults: lockOutcomes as unknown as JsonValue }),
    };
    return {
      ...file,
      content: textEncoder.encode(renderValidatedJson(value, file.path)),
    };
  });
}

function parseLockFile(file: RenderedFile): JsonRecord {
  const parsed = JSON.parse(textDecoder.decode(file.content)) as unknown;
  if (!isJsonRecord(parsed)) {
    throw new Error(`skillset: generated lock ${file.path} must be a JSON object`);
  }
  return parsed;
}

function renderResultsForLock(
  lockPath: string,
  lock: JsonRecord,
  renderResults: readonly SkillsetRenderResult[]
): readonly SkillsetRenderResult[] {
  const target = typeof lock.target === "string" ? lock.target : undefined;
  const outputRoot = outputRootForLockPath(lockPath);
  const lockOutputs = outputPathsForLock(outputRoot, lock);
  return renderResults
    .filter((outcome) => {
      if (target !== undefined && (outcome.target ?? "workspace") !== target) return false;
      const outputPaths = outcome.outputs?.map((output) => output.path) ?? [];
      if (outputPaths.length === 0) {
        return outputRoot === "." && outcome.target === undefined;
      }
      return outputPaths.some((path) => lockOutputs.has(path));
    })
    .sort((left, right) =>
      compareStrings(
        `${left.sourceUnit}\0${left.target ?? ""}\0${left.featureId}\0${left.destination ?? ""}\0${left.status}\0${left.sourcePath ?? ""}`,
        `${right.sourceUnit}\0${right.target ?? ""}\0${right.featureId}\0${right.destination ?? ""}\0${right.status}\0${right.sourcePath ?? ""}`
      )
    );
}

function outputPathsForLock(outputRoot: string, lock: JsonRecord): ReadonlySet<string> {
  const items = Array.isArray(lock.items) ? lock.items : [];
  const paths = new Set<string>();
  for (const item of items) {
    if (!isJsonRecord(item)) continue;
    let files: readonly string[] = [];
    if (Array.isArray(item.files) && item.files.every((entry) => typeof entry === "string")) {
      files = item.files;
    } else if (typeof item.outputPath === "string") {
      files = [item.outputPath];
    }
    for (const file of files) paths.add(join(outputRoot, file).replaceAll("\\", "/"));
  }
  return paths;
}

function outputRootForLockPath(lockPath: string): string {
  if (lockPath === ".skillset.lock") return ".";
  return dirname(lockPath).replaceAll("\\", "/");
}

function isLockFilePath(path: string): boolean {
  return path === ".skillset.lock" || path.endsWith("/.skillset.lock");
}

async function diagnoseMissingManagedOutputs(
  rootPath: string,
  rendered: readonly RenderedFile[],
  previousManagedPaths: ReadonlySet<string>
): Promise<readonly SkillsetDiagnostic[]> {
  const diagnostics: SkillsetDiagnostic[] = [];
  for (const file of rendered) {
    if (!previousManagedPaths.has(file.path)) continue;
    if (await exists(resolveInside(rootPath, file.path))) continue;
    diagnostics.push({
      code: "managed-output-missing",
      featureId: "output-safety",
      message: `managed output is missing and will be regenerated: ${file.path}`,
      outputPath: file.path,
      severity: "warning",
    });
  }
  return diagnostics;
}

async function writeRenderedFiles(
  rootPath: string,
  rendered: readonly RenderedFile[]
): Promise<readonly string[]> {
  const writtenPaths: string[] = [];
  for (const file of rendered) {
    const outputPath = resolveInside(rootPath, file.path);
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, file.content);
    writtenPaths.push(file.path);
  }
  return writtenPaths.sort(compareStrings);
}

async function writeChangedRenderedFiles(
  rootPath: string,
  rendered: readonly RenderedFile[],
  actualPaths: ReadonlySet<string>
): Promise<readonly string[]> {
  const writtenPaths: string[] = [];
  for (const file of rendered) {
    const outputPath = resolveInside(rootPath, file.path);
    if (actualPaths.has(file.path)) {
      const current = await readFile(outputPath);
      if (bytesEqual(current, file.content)) continue;
    }
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, file.content);
    writtenPaths.push(file.path);
  }
  return writtenPaths.sort(compareStrings);
}

async function removeStaleGeneratedFiles(
  rootPath: string,
  actualPaths: ReadonlySet<string>,
  expectedPaths: ReadonlySet<string>
): Promise<readonly string[]> {
  const deletedPaths: string[] = [];
  for (const path of actualPaths) {
    if (expectedPaths.has(path)) continue;
    await rm(resolveInside(rootPath, path), { force: true });
    deletedPaths.push(path);
  }
  return deletedPaths.sort(compareStrings);
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
  previousManagedPaths: ReadonlySet<string>
): Promise<readonly string[]> {
  const paths = new Set(await listOutputFiles(rootPath, outputRoots));

  for (const path of previousManagedPaths) {
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

function writeSummary(
  writtenPaths: readonly string[],
  deletedPaths: readonly string[]
): SkillsetWriteSummary {
  const written = [...writtenPaths].sort(compareStrings);
  const deleted = [...deletedPaths].sort(compareStrings);
  return {
    deletedPaths: deleted,
    mode: "write",
    paths: sortedUnique([...written, ...deleted]),
    writtenPaths: written,
  };
}

function sortedUnique(paths: readonly string[]): readonly string[] {
  return [...new Set(paths)].sort(compareStrings);
}

function staleManagedOutputPaths(
  previousManagedPaths: ReadonlySet<string>,
  expectedPaths: ReadonlySet<string>
): readonly string[] {
  return [...previousManagedPaths].filter((path) => !expectedPaths.has(path)).sort(compareStrings);
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
