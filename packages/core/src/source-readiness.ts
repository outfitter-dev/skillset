import { join } from "node:path";

import {
  buildSkillsetResult,
  diffSkillsetResult,
  includesProjectScope,
  ISOLATED_OUT_ROOT,
  scopedOutputRoots,
  type SkillsetDiff,
} from "./build";
import { inspectSkillset } from "./lint";
import {
  SkillsetFeatureDiagnosticError,
  type SkillsetDiagnostic,
  type SkillsetOperationResult,
  type SkillsetWriteSummary,
} from "./operation-result";
import {
  createOperationalPathContext,
  logicalOperationalPath,
  resolveOperationalPath,
} from "./operational-cache";
import {
  independentlyObservedOutputBaseline,
  readManagedOutputState,
} from "./output-safety";
import {
  classifySkillsetOutputFailure,
  classifySkillsetOutputState,
  type SkillsetOutputStateEvidence,
} from "./output-state";
import { compareStrings } from "./path";
import type { SkillsetRenderResult } from "./render-result";
import { loadBuildGraph } from "./resolver";
import type {
  CheckResult,
  LintIssue,
  LintResult,
  SkillsetOptions,
} from "./types";

export interface CheckSkillsetSourceReadinessOptions extends SkillsetOptions {
  /** Explicitly request a generated-output-only rebuild. */
  readonly write?: "outputs";
  /** Output paths proven source-driven by the calling analysis or operation. */
  readonly sourceDrivenOutputPaths?: readonly string[];
}

export interface SkillsetSourceReadinessData {
  readonly checks: {
    readonly graph: CheckResult;
    readonly lint: LintResult;
    readonly managedOutputs: CheckResult;
  };
  readonly drift: SkillsetDiff;
  readonly fixedPaths: readonly string[];
  readonly managedOutputPaths: readonly string[];
  readonly outputDiagnostics: readonly SkillsetDiagnostic[];
  readonly outputState: SkillsetOutputStateEvidence;
  readonly remainingPaths: readonly string[];
  readonly stalePaths: readonly string[];
  readonly warnings: readonly string[];
  readonly writePerformed: boolean;
}

interface SourceReadinessFacts {
  readonly data: Omit<
    SkillsetSourceReadinessData,
    "fixedPaths" | "remainingPaths" | "stalePaths" | "writePerformed"
  >;
  readonly diagnostics: readonly SkillsetDiagnostic[];
  readonly renderResults: readonly SkillsetRenderResult[];
}

interface SourceReadinessFailure {
  readonly error: unknown;
  readonly hasBaseline?: boolean;
  readonly partial?: SourceReadinessFacts;
}

const EMPTY_DRIFT: SkillsetDiff = {
  added: [],
  changed: [],
  missing: [],
  removed: [],
};
const EMPTY_LINT: LintResult = { checkedSkills: 0, issues: [] };
const READ_WRITES: SkillsetWriteSummary = {
  deletedPaths: [],
  mode: "read",
  paths: [],
  writtenPaths: [],
};
/**
 * Check source and generated-output readiness without Git, release, recovery,
 * presentation, or exit policy. Writes require the explicit `outputs` request
 * and a fresh neutral safety check immediately before rebuilding.
 */
export async function checkSkillsetSourceReadiness(
  rootPath: string,
  options: CheckSkillsetSourceReadinessOptions = {}
): Promise<SkillsetOperationResult<SkillsetSourceReadinessData>> {
  const { sourceDrivenOutputPaths, write, ...skillsetOptions } = options;
  const inspection = sourceDrivenOutputPaths === undefined
    ? {}
    : { sourceDrivenOutputPaths };
  const initial = await collectSourceReadiness(rootPath, skillsetOptions, inspection);
  if ("error" in initial) {
    return collectionFailureResult(initial);
  }

  if (write !== "outputs") {
    const stalePaths = driftPaths(initial.data.drift);
    return readinessResult(
      initial,
      {
        fixedPaths: [],
        remainingPaths: stalePaths,
        stalePaths,
        writePerformed: false,
      },
      READ_WRITES
    );
  }

  // Reload every neutral fact immediately before a requested write. The app or
  // library caller owns higher-level eligibility; Core independently refuses
  // stale managed edits, lint failures, and error diagnostics.
  const current = await collectSourceReadiness(rootPath, skillsetOptions, inspection);
  if ("error" in current) {
    return collectionFailureResult(current);
  }
  const stalePaths = driftPaths(current.data.drift);
  if (stalePaths.length === 0) {
    return readinessResult(
      current,
      {
        fixedPaths: [],
        remainingPaths: [],
        stalePaths: [],
        writePerformed: false,
      },
      READ_WRITES,
      [
        {
          code: "source-readiness-output-current",
          message:
            "generated output is already current; no rebuild was performed",
          severity: "info",
        },
      ]
    );
  }

  const blockers = neutralWriteBlockers(current);
  if (blockers.length > 0) {
    return readinessResult(
      current,
      {
        fixedPaths: [],
        remainingPaths: stalePaths,
        stalePaths,
        writePerformed: false,
      },
      READ_WRITES,
      [
        {
          code: "source-readiness-output-write-blocked",
          message: `generated-output rebuild is blocked by ${blockers.join(", ")}`,
          severity: "error",
        },
      ]
    );
  }

  let writes = READ_WRITES;
  let writePerformed = false;
  try {
    const build = await buildSkillsetResult(rootPath, skillsetOptions, inspection);
    writes = build.writes;
    writePerformed = build.ok && build.writes.mode === "write" && build.writes.paths.length > 0;
  } catch (error) {
    const buildFailureDiagnostics = failureDiagnostics(error);
    const afterFailure = await collectSourceReadiness(
      rootPath,
      skillsetOptions,
      inspection
    );
    if (!("error" in afterFailure)) {
      const remainingPaths = driftPaths(afterFailure.data.drift);
      const remainingSet = new Set(remainingPaths);
      const fixedPaths = stalePaths.filter((path) => !remainingSet.has(path));
      const partialWrites = await observedPartialWrites(
        rootPath,
        skillsetOptions,
        fixedPaths
      );
      return readinessResult(
        afterFailure,
        {
          fixedPaths,
          remainingPaths,
          stalePaths,
          writePerformed: partialWrites.mode === "write",
        },
        partialWrites,
        buildFailureDiagnostics
      );
    }
    return readinessResult(
      current,
      {
        fixedPaths: [],
        remainingPaths: stalePaths,
        stalePaths,
        writePerformed: false,
      },
      READ_WRITES,
      [...buildFailureDiagnostics, ...failureDiagnostics(afterFailure.error)]
    );
  }

  const remaining = await collectSourceReadiness(rootPath, skillsetOptions, inspection);
  if ("error" in remaining) {
    return readinessResult(
      current,
      {
        fixedPaths: [],
        remainingPaths: stalePaths,
        stalePaths,
        writePerformed,
      },
      writes,
      failureDiagnostics(remaining.error)
    );
  }
  const remainingPaths = driftPaths(remaining.data.drift);
  const remainingSet = new Set(remainingPaths);
  const fixedPaths = stalePaths.filter((path) => !remainingSet.has(path));
  return readinessResult(
    remaining,
    {
      fixedPaths,
      remainingPaths,
      stalePaths,
      writePerformed,
    },
    writes
  );
}

async function observedPartialWrites(
  rootPath: string,
  options: SkillsetOptions,
  fixedPaths: readonly string[]
): Promise<SkillsetWriteSummary> {
  if (fixedPaths.length === 0) return READ_WRITES;
  const graph = await loadBuildGraph(rootPath, options);
  const pathContext = createOperationalPathContext(rootPath, {
    ...(graph.root.workspace.cacheKey === undefined
      ? {}
      : { workspaceCacheKey: graph.root.workspace.cacheKey }),
    ...(options.xdg?.env === undefined ? {} : { env: options.xdg.env }),
    ...(options.xdg?.homeDir === undefined
      ? {}
      : { homeDir: options.xdg.homeDir }),
  });
  const writtenPaths: string[] = [];
  const deletedPaths: string[] = [];
  for (const path of fixedPaths) {
    if (await Bun.file(resolveOperationalPath(pathContext, path)).exists()) {
      writtenPaths.push(path);
    } else {
      deletedPaths.push(path);
    }
  }
  return {
    deletedPaths,
    mode: "write",
    paths: fixedPaths,
    writtenPaths,
  };
}

async function collectSourceReadiness(
  rootPath: string,
  options: SkillsetOptions,
  inspection: { readonly sourceDrivenOutputPaths?: readonly string[] } = {}
): Promise<SourceReadinessFacts | SourceReadinessFailure> {
  try {
    const graph = await loadBuildGraph(rootPath, options);
    const lint = await inspectSkillset(graph);
    const outPath =
      options.isolated === true
        ? (path: string) => join(ISOLATED_OUT_ROOT, path)
        : (path: string) => path;
    const pathContext = createOperationalPathContext(rootPath, {
      ...(graph.root.workspace.cacheKey === undefined
        ? {}
        : { workspaceCacheKey: graph.root.workspace.cacheKey }),
      ...(options.xdg?.env === undefined ? {} : { env: options.xdg.env }),
      ...(options.xdg?.homeDir === undefined
        ? {}
        : { homeDir: options.xdg.homeDir }),
    });
    const managed = await readManagedOutputState(
      rootPath,
      scopedOutputRoots(graph, options.scopes),
      includesProjectScope(options.scopes),
      outPath,
      (path) => resolveOperationalPath(pathContext, path),
      (path) => logicalOperationalPath(pathContext, path)
    );
    let diff: Awaited<ReturnType<typeof diffSkillsetResult>>;
    try {
      diff = await diffSkillsetResult(rootPath, options, inspection);
    } catch (error) {
      return {
        error,
        partial: {
          data: {
            checks: {
              graph: { checkedFiles: 1, failures: [] },
              lint,
              managedOutputs: {
                checkedFiles: managed.paths.size,
                failures: [],
              },
            },
            drift: EMPTY_DRIFT,
            managedOutputPaths: [...managed.paths].sort(compareStrings),
            outputDiagnostics: [],
            outputState: classifySkillsetOutputFailure(error, managed.hasBaseline),
            warnings: graph.warnings,
          },
          diagnostics: lint.issues.map(lintDiagnostic),
          renderResults: [],
        },
      };
    }
    const driftSet = new Set(driftPaths(diff.data));
    const outputEditedPaths = [
      ...new Set([
        ...managed.editedPaths,
        ...diff.diagnostics.flatMap((diagnostic) =>
          diagnostic.code === "managed-output-edited" &&
          diagnostic.outputPath !== undefined
            ? [diagnostic.outputPath]
            : []
        ),
      ]),
    ]
      .filter((path) => driftSet.has(path))
      .sort(compareStrings);
    return {
      data: {
        checks: {
          graph: { checkedFiles: 1, failures: [] },
          lint,
          managedOutputs: {
            checkedFiles: managed.paths.size,
            failures: outputEditedPaths,
          },
        },
        drift: diff.data,
        managedOutputPaths: [...managed.paths].sort(compareStrings),
        outputDiagnostics: diff.diagnostics,
        outputState: diff.outputState,
        warnings: graph.warnings,
      },
      diagnostics: [...diff.diagnostics, ...lint.issues.map(lintDiagnostic)],
      renderResults: diff.renderResults,
    };
  } catch (error) {
    return {
      error,
      hasBaseline: await independentlyObservedOutputBaseline(rootPath, options),
    };
  }
}

function readinessResult(
  facts: SourceReadinessFacts,
  state: Pick<
    SkillsetSourceReadinessData,
    "fixedPaths" | "remainingPaths" | "stalePaths" | "writePerformed"
  >,
  writes: SkillsetWriteSummary,
  extraDiagnostics: readonly SkillsetDiagnostic[] = []
): SkillsetOperationResult<SkillsetSourceReadinessData> {
  const data = { ...facts.data, ...state };
  const diagnostics = [...facts.diagnostics, ...extraDiagnostics];
  return {
    data,
    diagnostics,
    renderResults: facts.renderResults,
    ok:
      diagnostics.every((diagnostic) => diagnostic.severity !== "error") &&
      data.checks.lint.issues.every((issue) => issue.severity !== "error") &&
      data.checks.managedOutputs.failures.length === 0 &&
      data.remainingPaths.length === 0,
    operation: "check",
    writes,
  };
}

function failedResult(
  error: unknown,
  hasBaseline = false
): SkillsetOperationResult<SkillsetSourceReadinessData> {
  return {
    data: {
      drift: EMPTY_DRIFT,
      checks: {
        graph: { checkedFiles: 0, failures: [errorMessage(error)] },
        lint: EMPTY_LINT,
        managedOutputs: { checkedFiles: 0, failures: [] },
      },
      fixedPaths: [],
      managedOutputPaths: [],
      outputDiagnostics: [],
      outputState: classifySkillsetOutputFailure(error, hasBaseline),
      remainingPaths: [],
      stalePaths: [],
      warnings: [],
      writePerformed: false,
    },
    diagnostics: failureDiagnostics(error),
    renderResults: [],
    ok: false,
    operation: "check",
    writes: READ_WRITES,
  };
}

function collectionFailureResult(
  failure: SourceReadinessFailure
): SkillsetOperationResult<SkillsetSourceReadinessData> {
  if (failure.partial === undefined) {
    return failedResult(failure.error, failure.hasBaseline);
  }
  const stalePaths = driftPaths(failure.partial.data.drift);
  return readinessResult(
    failure.partial,
    {
      fixedPaths: [],
      remainingPaths: stalePaths,
      stalePaths,
      writePerformed: false,
    },
    READ_WRITES,
    failureDiagnostics(failure.error)
  );
}

function neutralWriteBlockers(facts: SourceReadinessFacts): readonly string[] {
  const blockers: string[] = [];
  if (
    facts.data.checks.lint.issues.some((issue) => issue.severity === "error")
  ) {
    blockers.push("source lint errors");
  }
  if (facts.data.checks.managedOutputs.failures.length > 0) {
    blockers.push("managed target edits");
  }
  if (
    facts.data.outputDiagnostics.some(
      (diagnostic) => diagnostic.severity === "error"
    )
  ) {
    blockers.push("generated-output diagnostics");
  }
  return blockers;
}

function driftPaths(drift: SkillsetDiff): readonly string[] {
  return [
    ...new Set([
      ...drift.added,
      ...drift.changed,
      ...drift.missing,
      ...drift.removed,
    ]),
  ].sort(compareStrings);
}

function lintDiagnostic(issue: LintIssue): SkillsetDiagnostic {
  return {
    code: issue.code,
    ...(issue.featureId === undefined ? {} : { featureId: issue.featureId }),
    message: issue.message,
    path: issue.path,
    severity: issue.severity === "error" ? "error" : "warning",
  };
}

function sourceReadinessFailure(error: unknown): SkillsetDiagnostic {
  return {
    code: "source-readiness-failed",
    message: errorMessage(error),
    severity: "error",
  };
}

function failureDiagnostics(error: unknown): readonly SkillsetDiagnostic[] {
  const failure = sourceReadinessFailure(error);
  if (!(error instanceof SkillsetFeatureDiagnosticError)) return [failure];
  return [
    {
      code: error.code,
      featureId: error.featureId,
      message: error.message,
      ...(error.path === undefined ? {} : { path: error.path }),
      severity: "error",
    },
    failure,
  ];
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
