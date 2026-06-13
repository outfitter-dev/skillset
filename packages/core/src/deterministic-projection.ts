import { cp, lstat, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";

import {
  buildSkillsetResult,
  ISOLATED_OUT_ROOT,
  type SkillsetBuildResult,
} from "./build";
import { compareStrings, resolveInside } from "./path";
import {
  compareNormalizedOutputTreeEntries,
  compareNormalizedOutputTrees,
  formatNormalizedTreeComparison,
  type NormalizedOutputTreeEntry,
  type NormalizedTreeComparison,
  type NormalizedOutputTreeOptions,
} from "./normalized-output-tree";
import type { JsonRecord, JsonValue, SkillsetOptions } from "./types";
import { stringifyJson } from "./yaml";

const DEFAULT_SOURCE_PATHS = ["."] as const;
const DEFAULT_COPY_EXCLUDED_PATHS = [
  ".agents",
  ".claude",
  ".codex",
  ".git",
  ".skillset/build",
  "node_modules",
  "plugins-claude",
  "plugins-codex",
] as const;

const textEncoder = new TextEncoder();

export type DeterministicProjectionRunName = "left" | "right";

export interface DeterministicProjectionRunContext {
  readonly build: SkillsetBuildResult;
  readonly name: DeterministicProjectionRunName;
  readonly outputRoot: string;
  readonly workspacePath: string;
}

export interface DeterministicProjectionOptions {
  /**
   * Relative source paths to copy into each clean temp workspace. Defaults to
   * the whole root, excluding generated/runtime-heavy paths.
   */
  readonly sourcePaths?: readonly string[];
  /** Skillset build options applied to both temp-root projections. */
  readonly buildOptions?: SkillsetOptions;
  /** Extra output-tree comparison options. */
  readonly comparisonOptions?: NormalizedOutputTreeOptions;
  /** Test/conformance hook that may inspect or perturb a temp projection. */
  readonly afterProjection?: (run: DeterministicProjectionRunContext) => Promise<void> | void;
  /** Keep the temp runner root on disk for local debugging. */
  readonly keepTemp?: boolean;
  /** Parent directory for the runner's temp root; the runner creates a child. */
  readonly tempParentPath?: string;
}

export interface DeterministicProjectionRunSummary {
  readonly generatedFiles: number;
  readonly name: DeterministicProjectionRunName;
  readonly outputRoot: string;
  readonly workspacePath: string;
}

export interface DeterministicProjectionReport {
  readonly ok: boolean;
  readonly outputComparison: NormalizedTreeComparison;
  readonly resultComparison: NormalizedTreeComparison;
  readonly runs: readonly [
    DeterministicProjectionRunSummary,
    DeterministicProjectionRunSummary,
  ];
  readonly tempRootPath: string;
}

export async function runDeterministicProjection(
  rootPath: string,
  options: DeterministicProjectionOptions = {}
): Promise<DeterministicProjectionReport> {
  const resolvedRootPath = resolve(rootPath);
  const tempRootPath = await createTempRoot(options.tempParentPath);
  try {
    const left = await runProjection(resolvedRootPath, tempRootPath, "left", options);
    const right = await runProjection(resolvedRootPath, tempRootPath, "right", options);
    const forbiddenSubstrings = [
      tempRootPath,
      left.workspacePath,
      right.workspacePath,
      ...(options.comparisonOptions?.forbiddenSubstrings ?? []),
    ];
    const outputComparison = await compareNormalizedOutputTrees(
      left.outputRoot,
      right.outputRoot,
      {
        ...options.comparisonOptions,
        forbiddenSubstrings,
      }
    );
    const resultComparison = compareProjectionResults(left, right, forbiddenSubstrings);
    return {
      ok: outputComparison.equal && resultComparison.equal,
      outputComparison,
      resultComparison,
      runs: [runSummary(left), runSummary(right)],
      tempRootPath,
    };
  } finally {
    if (options.keepTemp !== true) {
      await rm(tempRootPath, { force: true, recursive: true });
    }
  }
}

export async function assertDeterministicProjection(
  rootPath: string,
  options: DeterministicProjectionOptions = {}
): Promise<DeterministicProjectionReport> {
  const report = await runDeterministicProjection(rootPath, options);
  if (!report.ok) throw new Error(formatDeterministicProjectionReport(report));
  return report;
}

export function formatDeterministicProjectionReport(
  report: DeterministicProjectionReport,
  limit = 20
): string {
  if (report.ok) {
    const generated = report.runs.map((run) => run.generatedFiles).join(" / ");
    return `deterministic projection matched (${generated} generated files)`;
  }
  const sections = ["skillset: deterministic projection differed"];
  if (!report.outputComparison.equal) {
    sections.push(formatNormalizedTreeComparison(report.outputComparison, limit));
  }
  if (!report.resultComparison.equal) {
    sections.push("operation result summary differed");
    sections.push(formatNormalizedTreeComparison(report.resultComparison, limit));
  }
  return sections.join("\n");
}

async function runProjection(
  rootPath: string,
  tempRootPath: string,
  name: DeterministicProjectionRunName,
  options: DeterministicProjectionOptions
): Promise<DeterministicProjectionRunContext> {
  const workspacePath = join(tempRootPath, name, "workspace");
  await copySourceSelection(rootPath, workspacePath, options.sourcePaths ?? DEFAULT_SOURCE_PATHS);
  const build = await buildSkillsetResult(workspacePath, {
    ...options.buildOptions,
    buildMode: "all",
    isolated: true,
  });
  const run = {
    build,
    name,
    outputRoot: join(workspacePath, ISOLATED_OUT_ROOT),
    workspacePath,
  };
  await options.afterProjection?.(run);
  return run;
}

async function copySourceSelection(
  rootPath: string,
  workspacePath: string,
  sourcePaths: readonly string[]
): Promise<void> {
  await mkdir(workspacePath, { recursive: true });
  const normalizedSourcePaths = sourcePaths.map(normalizeRelativePath).sort(compareStrings);
  if (normalizedSourcePaths.length === 0) {
    throw new Error("skillset: deterministic projection requires at least one source path");
  }
  for (const sourcePath of normalizedSourcePaths) {
    const source = sourcePath === "." ? rootPath : resolveInside(rootPath, sourcePath);
    const target = sourcePath === "." ? workspacePath : join(workspacePath, sourcePath);
    await mkdir(dirname(target), { recursive: true });
    await cp(source, target, {
      filter: (path) => shouldCopyPath(rootPath, path),
      recursive: true,
    });
  }
}

async function shouldCopyPath(rootPath: string, path: string): Promise<boolean> {
  const relativePath = normalizePath(relative(rootPath, path));
  if (relativePath === "") return true;
  if ((await lstat(path)).isSymbolicLink()) {
    throw new Error(`skillset: deterministic projection source does not support symlinks: ${relativePath}`);
  }
  return !DEFAULT_COPY_EXCLUDED_PATHS.some(
    (excluded) => relativePath === excluded || relativePath.startsWith(`${excluded}/`)
  );
}

async function createTempRoot(tempParentPath: string | undefined): Promise<string> {
  const parent = tempParentPath === undefined ? tmpdir() : resolve(tempParentPath);
  await mkdir(parent, { recursive: true });
  return mkdtemp(join(parent, "skillset-projection-"));
}

function compareProjectionResults(
  left: DeterministicProjectionRunContext,
  right: DeterministicProjectionRunContext,
  forbiddenSubstrings: readonly string[]
): NormalizedTreeComparison {
  return compareNormalizedOutputTreeEntries(
    [projectionResultEntry(left, forbiddenSubstrings)],
    [projectionResultEntry(right, forbiddenSubstrings)]
  );
}

function projectionResultEntry(
  run: DeterministicProjectionRunContext,
  forbiddenSubstrings: readonly string[]
): NormalizedOutputTreeEntry {
  const content = stringifyJson(buildResultSummary(run.build));
  for (const forbidden of forbiddenSubstrings) {
    if (content.includes(forbidden)) {
      throw new Error(`skillset: deterministic projection result for ${run.name} contains forbidden value ${forbidden}`);
    }
  }
  return {
    bytes: textEncoder.encode(content),
    kind: "json",
    path: "operation-result.json",
  };
}

function buildResultSummary(result: SkillsetBuildResult): JsonRecord {
  return {
    diagnostics: result.diagnostics as unknown as JsonValue,
    generatedPaths: result.data.map((file) => file.path).sort(compareStrings),
    loweringOutcomes: result.loweringOutcomes as unknown as JsonValue,
    operation: result.operation,
    writes: result.writes as unknown as JsonValue,
  };
}

function runSummary(run: DeterministicProjectionRunContext): DeterministicProjectionRunSummary {
  return {
    generatedFiles: run.build.data.length,
    name: run.name,
    outputRoot: run.outputRoot,
    workspacePath: run.workspacePath,
  };
}

function normalizeRelativePath(path: string): string {
  const normalized = normalizePath(path.trim());
  if (normalized.length === 0 || normalized === ".") return ".";
  if (normalized.startsWith("/") || normalized === ".." || normalized.startsWith("../")) {
    throw new Error(`skillset: deterministic projection source path ${JSON.stringify(path)} must stay inside the root`);
  }
  return normalized.replace(/\/+$/u, "");
}

function normalizePath(path: string): string {
  return path.replaceAll("\\", "/");
}
