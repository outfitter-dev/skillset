import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { compareStrings } from "./path";
import { hasValidLockProvenance, withLockProvenance } from "./lock-provenance";
import {
  applyGeneratedFileMode,
  formatGeneratedFileMode,
  generatedFileOnDiskMatchesMode,
  supportsGeneratedFileModes,
} from "./generated-file-mode";
import { pluginTargetForOutputPath } from "./plugin-output";
import { targetNames } from "./targets";
import { collectRenderResults } from "./render-result-collector";
import { enforceRenderResultPolicy } from "./render-result-policy";
import {
  discardOutputBackup,
  diagnoseOutputBackupPreflight,
  diagnoseOutputBackupPlan,
  persistOutputBackupPlan,
  planOutputBackups,
  readManagedOutputState,
  withBackupSummary,
  type ManagedOutputState,
  type OutputBackupSummary,
  type OutputPathResolver,
  type OutputWritePreimage,
} from "./output-safety";
import {
  createOperationalPathContext,
  logicalOperationalPath,
  resolveOperationalPath,
  type OperationalPathContext,
} from "./operational-cache";
import { renderBuildGraph } from "./render";
import { loadBuildGraph } from "./resolver";
import { renderValidatedJson } from "./structured-output";
import {
  sourceWarningDiagnostic,
  type SkillsetDiagnostic,
  type SkillsetOperationResult,
  type SkillsetWriteSummary,
} from "./operation-result";
import { classifySkillsetOutputState, type SkillsetOutputStateEvidence } from "./output-state";
import { SkillsetRenderResultError, defineRenderResult, type SkillsetRenderResult, type SkillsetRenderResultPolicy } from "./render-result";
import type { BuildGraph, BuildScope, CheckResult, JsonRecord, JsonValue, RenderedFile, SkillsetOptions, UnsupportedDestinationPolicy } from "./types";
import { isJsonRecord, parseMarkdown } from "./yaml";

/** Mirror root for isolated builds; the full projection lands under it. */
export const ISOLATED_OUT_ROOT = ".skillset/cache/latest";

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
const LOCK_TOP_LEVEL_KEYS = new Set([
  "buildMode",
  "features",
  "generatedBy",
  "items",
  "marketplaces",
  "outputRoot",
  "provenanceHash",
  "renderResults",
  "schemaVersion",
  "selectedTargets",
  "skillsetMetadata",
  "sourceRoot",
  "target",
]);
const LOCK_FEATURE_KEYS = new Set(["promptArguments"]);
const LOCK_ITEM_KEYS = new Set([
  "dependencies",
  "feature",
  "fileModes",
  "files",
  "includedSkills",
  "kind",
  "name",
  "origin",
  "outputHash",
  "outputPath",
  "plugin",
  "preprocessDependencies",
  "renderInputsHash",
  "skillReferences",
  "skippedSkills",
  "sourceHash",
  "sourceOrigin",
  "sourcePath",
  "sourcePointer",
  "targetState",
  "transforms",
  "validation",
  "version",
]);

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

export type SkillsetBuildResult = SkillsetOperationResult<readonly RenderedFile[]> & {
  readonly outputState: SkillsetOutputStateEvidence;
};

export class SkillsetBuildBlockedError extends Error {
  readonly result: SkillsetBuildResult;

  constructor(result: SkillsetBuildResult) {
    super(`skillset: build blocked by ${result.outputState.blockers.map((blocker) => blocker.code).join(", ")}`);
    this.name = "SkillsetBuildBlockedError";
    this.result = result;
  }
}

export async function buildSkillset(
  rootPath: string,
  options: SkillsetOptions = {}
): Promise<readonly RenderedFile[]> {
  const result = await buildSkillsetResult(rootPath, options);
  if (!result.ok) throw new SkillsetBuildBlockedError(result);
  return result.data;
}

export async function buildSkillsetResult(
  rootPath: string,
  options: SkillsetOptions = {},
  inspectionOptions: SkillsetDiffInspectionOptions = {}
): Promise<SkillsetBuildResult> {
  return buildSkillsetResultInternal(rootPath, options, {
    ...(inspectionOptions.sourceDrivenOutputPaths === undefined
      ? {}
      : { sourceDrivenOutputPaths: inspectionOptions.sourceDrivenOutputPaths }),
  });
}

/** @internal Write-authority seam used by source readiness after app analysis. */
export interface SkillsetBuildAuthorityHooks {
  readonly afterBackupPersistence?: () => Promise<void> | void;
  readonly afterBackupPlanning?: () => Promise<void> | void;
  readonly beforeFinalWriteInspection?: () => Promise<void> | void;
}

export async function buildSkillsetResultWithAuthority(
  rootPath: string,
  options: SkillsetOptions,
  inspectionOptions: SkillsetDiffInspectionOptions,
  managedLockRepairPaths: readonly string[],
  hooks: SkillsetBuildAuthorityHooks = {}
): Promise<SkillsetBuildResult> {
  return buildSkillsetResultInternal(rootPath, options, {
    ...(hooks.afterBackupPersistence === undefined
      ? {}
      : { afterBackupPersistence: hooks.afterBackupPersistence }),
    ...(hooks.afterBackupPlanning === undefined
      ? {}
      : { afterBackupPlanning: hooks.afterBackupPlanning }),
    ...(hooks.beforeFinalWriteInspection === undefined
      ? {}
      : { beforeFinalWriteInspection: hooks.beforeFinalWriteInspection }),
    managedLockRepairPaths,
    ...(inspectionOptions.sourceDrivenOutputPaths === undefined
      ? {}
      : { sourceDrivenOutputPaths: inspectionOptions.sourceDrivenOutputPaths }),
  });
}

interface SkillsetBuildInspectionOptions extends SkillsetDiffInspectionOptions {
  /** @internal Deterministic race injection after backup persistence. */
  readonly afterBackupPersistence?: () => Promise<void> | void;
  /** @internal Deterministic race injection after backup planning. */
  readonly afterBackupPlanning?: () => Promise<void> | void;
  /** @internal Deterministic race injection immediately before final inspection. */
  readonly beforeFinalWriteInspection?: () => Promise<void> | void;
  readonly managedLockRepairPaths?: readonly string[];
}

async function buildSkillsetResultInternal(
  rootPath: string,
  options: SkillsetOptions,
  inspectionOptions: SkillsetBuildInspectionOptions
): Promise<SkillsetBuildResult> {
  const graph = await loadBuildGraph(rootPath, options);
  const diagnostics = [...graph.warnings.map(sourceWarningDiagnostic)];
  const pathContext = operationalPathContextForGraph(rootPath, graph, options);
  const resolveOutputPath = outputPathResolver(pathContext);
  const outPath = outPathMapper(options);
  const allRendered = await renderBuildGraph(graph);
  const scopedRendered = scopedRenderedFiles(graph, allRendered, options.scopes);
  const renderResults = collectRenderResults(graph, allRendered, {
    includedPaths: new Set(scopedRendered.map((file) => file.path)),
    mapOutputPath: outPath,
    scopes: options.scopes,
  });
  const policyAdjustedRenderResults = applyUnsupportedDestinationPolicy(renderResults, graph.root.compile.unsupportedDestination);
  enforceSoftPolicyHasUsableOutput(scopedRendered, policyAdjustedRenderResults, graph.root.compile.unsupportedDestination);
  enforceRenderResultPolicy(policyAdjustedRenderResults, graph.root.compile.unsupportedDestination);
  diagnostics.push(...unsupportedDestinationPolicyDiagnostics(policyAdjustedRenderResults, graph.root.compile.unsupportedDestination));
  const renderedWithoutOutcomeMetadata = mirroredRenderedFiles(scopedRendered, outPath);
  const instructionDiagnostics = diagnoseLargeInstructionFiles(renderedWithoutOutcomeMetadata);
  diagnostics.push(...instructionDiagnostics);
  const renderResultsWithDiagnostics = attachDiagnosticsToRenderResults(policyAdjustedRenderResults, instructionDiagnostics);
  const rendered = withPersistedRenderResults(
    renderedWithoutOutcomeMetadata,
    renderResultsWithDiagnostics
  );
  const liveOutputRoots = scopedOutputRoots(graph, options.scopes);
  const outputRoots = mirroredOutputRoots(liveOutputRoots, outPath);
  const includeWorkspaceLock = includesProjectScope(options.scopes);
  const expectedPaths = new Set(rendered.map((file) => file.path));
  const previousManagedState = await readManagedOutputState(rootPath, liveOutputRoots, includeWorkspaceLock, outPath, resolveOutputPath, displayPathMapper(pathContext));
  diagnostics.push(...await diagnoseMissingManagedOutputs(rendered, previousManagedState.paths, resolveOutputPath));
  const inspectionArgs = {
    diagnostics,
    expected: new Map(rendered.map((file) => [file.path, file])),
    outputRoots,
    pathContext,
    previousManagedState,
    rendered,
    resolveOutputPath,
    rootPath,
    ...(inspectionOptions.managedLockRepairPaths === undefined
      ? {}
      : { managedLockRepairPaths: inspectionOptions.managedLockRepairPaths }),
    ...(inspectionOptions.sourceDrivenOutputPaths === undefined
      ? {}
      : { sourceDrivenOutputPaths: inspectionOptions.sourceDrivenOutputPaths }),
  };
  const inspection = await inspectOutputPlan(inspectionArgs);
  if (inspection.outputState.state === "blocked") {
    diagnostics.push(...inspection.preflightDiagnostics);
    return blockedBuildResult(
      rendered,
      diagnostics,
      inspection.outputState,
      renderResultsWithDiagnostics
    );
  }

  let writeInspection = inspection;
  if (inspectionOptions.managedLockRepairPaths !== undefined) {
    await inspectionOptions.beforeFinalWriteInspection?.();
    const finalManagedState = await readManagedOutputState(
      rootPath,
      liveOutputRoots,
      includeWorkspaceLock,
      outPath,
      resolveOutputPath,
      displayPathMapper(pathContext)
    );
    writeInspection = await inspectOutputPlan({
      ...inspectionArgs,
      previousManagedState: finalManagedState,
    });
    if (writeInspection.outputState.state === "blocked") {
      diagnostics.push(...writeInspection.preflightDiagnostics);
      return blockedBuildResult(
        rendered,
        diagnostics,
        writeInspection.outputState,
        renderResultsWithDiagnostics
      );
    }
  }
  const backupPlan = await planOutputBackups(
    rootPath,
    rendered,
    writeInspection.staleManagedPaths,
    writeInspection.managedState,
    resolveOutputPath
  );
  await inspectionOptions.afterBackupPlanning?.();
  const writePreimages = new Map(
    backupPlan.preimages.map((preimage) => [preimage.targetPath, preimage])
  );
  const planInvalidationDiagnostics = (
    await invalidatedOutputWritePaths(writePreimages, resolveOutputPath)
  ).map(outputWriteInvalidatedDiagnostic);
  if (planInvalidationDiagnostics.length > 0) {
    diagnostics.push(...planInvalidationDiagnostics);
    return blockedBuildResult(
      rendered,
      diagnostics,
      classifyWriteSafety(
        writeInspection.outputState,
        planInvalidationDiagnostics,
        writeInspection.managedState.paths.size,
        inspectionOptions.sourceDrivenOutputPaths ?? []
      ),
      renderResultsWithDiagnostics
    );
  }
  const plannedSafetyDiagnostics = diagnoseOutputBackupPlan(backupPlan);
  const plannedWriteOutputState = classifyWriteSafety(
    writeInspection.outputState,
    plannedSafetyDiagnostics,
    writeInspection.managedState.paths.size,
    inspectionOptions.sourceDrivenOutputPaths ?? []
  );
  if (plannedWriteOutputState.state === "blocked") {
    diagnostics.push(...plannedSafetyDiagnostics);
    return blockedBuildResult(
      rendered,
      diagnostics,
      plannedWriteOutputState,
      renderResultsWithDiagnostics
    );
  }
  const safety = await persistOutputBackupPlan(rootPath, backupPlan);
  await inspectionOptions.afterBackupPersistence?.();
  const persistedPlanInvalidationDiagnostics = (
    await invalidatedOutputWritePaths(writePreimages, resolveOutputPath)
  ).map(outputWriteInvalidatedDiagnostic);
  if (persistedPlanInvalidationDiagnostics.length > 0) {
    if (safety.backup !== undefined) {
      await discardOutputBackup(rootPath, safety.backup);
    }
    diagnostics.push(...persistedPlanInvalidationDiagnostics);
    return blockedBuildResult(
      rendered,
      diagnostics,
      classifyWriteSafety(
        writeInspection.outputState,
        persistedPlanInvalidationDiagnostics,
        writeInspection.managedState.paths.size,
        inspectionOptions.sourceDrivenOutputPaths ?? []
      ),
      renderResultsWithDiagnostics
    );
  }
  diagnostics.push(...safety.diagnostics);
  const writeOutputState = classifyWriteSafety(
    writeInspection.outputState,
    safety.diagnostics,
    writeInspection.managedState.paths.size,
    inspectionOptions.sourceDrivenOutputPaths ?? []
  );
  if (writeOutputState.state === "blocked") {
    return blockedBuildResult(
      rendered,
      diagnostics,
      writeOutputState,
      renderResultsWithDiagnostics,
      safety.backup
    );
  }

  if (graph.root.compile.build === "all") {
    const deletedPaths = await removeStaleGeneratedFiles(new Set(writeInspection.staleManagedPaths), expectedPaths, writePreimages, resolveOutputPath);
    const writtenPaths = await writeRenderedFiles(rendered, writePreimages, resolveOutputPath);
    return buildResult(rendered, diagnostics, writeOutputState, renderResultsWithDiagnostics, withBackupSummary(writeSummary(writtenPaths, deletedPaths), safety.backup));
  }

  const actualPaths = writeInspection.actualPaths;
  const deletedPaths = await removeStaleGeneratedFiles(new Set(writeInspection.staleManagedPaths), expectedPaths, writePreimages, resolveOutputPath);
  const writtenPaths = await writeChangedRenderedFiles(rendered, actualPaths, writePreimages, resolveOutputPath);

  return buildResult(rendered, diagnostics, writeOutputState, renderResultsWithDiagnostics, withBackupSummary(writeSummary(writtenPaths, deletedPaths), safety.backup));
}

export interface SkillsetDiff {
  readonly added: readonly string[];
  readonly changed: readonly string[];
  readonly missing: readonly string[];
  readonly removed: readonly string[];
}

interface OutputPlanInspection {
  readonly actualPaths: ReadonlySet<string>;
  readonly diff: SkillsetDiff;
  readonly managedState: ManagedOutputState;
  readonly outputState: SkillsetOutputStateEvidence;
  readonly preflightDiagnostics: readonly SkillsetDiagnostic[];
  readonly staleManagedPaths: readonly string[];
}

async function inspectOutputPlan(args: {
  readonly diagnostics: readonly SkillsetDiagnostic[];
  readonly expected: ReadonlyMap<string, RenderedFile>;
  readonly managedLockRepairPaths?: readonly string[];
  readonly outputRoots: readonly string[];
  readonly pathContext: OperationalPathContext;
  readonly previousManagedState: ManagedOutputState;
  readonly rendered: readonly RenderedFile[];
  readonly resolveOutputPath: OutputPathResolver;
  readonly rootPath: string;
  readonly sourceDrivenOutputPaths?: readonly string[];
}): Promise<OutputPlanInspection> {
  const actualPathList = await listGeneratedFiles(args.pathContext, args.outputRoots, args.rendered, args.previousManagedState.paths, args.resolveOutputPath);
  const actualPaths = new Set(actualPathList);
  const staleManagedPaths = staleManagedOutputPaths(args.previousManagedState.paths, new Set(args.expected.keys())).filter((path) => actualPaths.has(path));
  const added: string[] = [];
  const changed: string[] = [];
  const missing: string[] = [];
  const removed: string[] = [];
  const changedLocks = new Map<
    string,
    { readonly current: Uint8Array; readonly expected: Uint8Array }
  >();

  for (const file of args.rendered) {
    if (!actualPaths.has(file.path)) {
      if (args.previousManagedState.paths.has(file.path)) {
        missing.push(file.path);
      } else {
        added.push(file.path);
      }
      continue;
    }
    const current = await readFile(args.resolveOutputPath(file.path));
    if (!bytesEqual(current, file.content) || !(await generatedFileOnDiskMatchesMode(args.resolveOutputPath(file.path), file))) {
      changed.push(file.path);
      if (isLockFilePath(file.path)) {
        changedLocks.set(file.path, { current, expected: file.content });
      }
    }
  }
  for (const path of actualPathList) {
    if (!args.previousManagedState.paths.has(path)) continue;
    if (!args.expected.has(path)) removed.push(path);
  }

  const diff: SkillsetDiff = {
    added: added.sort(compareStrings),
    changed: changed.sort(compareStrings),
    missing: missing.sort(compareStrings),
    removed: removed.sort(compareStrings),
  };
  const sourceDrivenPayloadChanges = new Set([
    ...diff.added.filter((path) => !isLockFilePath(path)),
    ...diff.changed.filter((path) =>
      !isLockFilePath(path) && !args.previousManagedState.editedPaths.has(path)
    ),
    ...diff.removed.filter((path) =>
      !isLockFilePath(path) && !args.previousManagedState.editedPaths.has(path)
    ),
  ]);
  const removedPayloadChanges = new Set(
    diff.removed.filter((path) => !isLockFilePath(path))
  );
  const lockProvenanceStates = new Map(
    [...changedLocks].map(([path, contents]) => [
      path,
      args.previousManagedState.hasBaseline
        ? classifyLockProvenance(
            path,
            contents.current,
            contents.expected,
            sourceDrivenPayloadChanges,
            removedPayloadChanges,
            args.previousManagedState.editedPaths
          )
        : "trusted",
    ] as const)
  );
  const untrustedLockPaths = new Set(
    [...lockProvenanceStates]
      .filter(([, state]) => state !== "trusted")
      .map(([path]) => path)
  );
  const repairableLockPaths = [...lockProvenanceStates]
    .filter(([, state]) => isRepairableLockProvenance(state))
    .map(([path]) => path)
    .sort(compareStrings);
  const driftPathSet = new Set([
    ...diff.added,
    ...diff.changed,
    ...diff.missing,
    ...diff.removed,
  ]);
  const requestedLockRepairPaths = new Set(
    (args.managedLockRepairPaths ?? []).filter(isLockFilePath)
  );
  const approvedLockRepairPaths = new Set(
    [...requestedLockRepairPaths].filter(
      (path) => isRepairableLockProvenance(lockProvenanceStates.get(path))
    )
  );
  const invalidatedLockRepairPaths = [
    ...requestedLockRepairPaths,
  ]
    .filter(
      (path) =>
        driftPathSet.has(path) &&
        !isRepairableLockProvenance(lockProvenanceStates.get(path))
    )
    .sort(compareStrings);
  const allManagedEditPaths = new Set([
    ...args.previousManagedState.editedPaths,
    ...untrustedLockPaths,
  ]);
  const invalidatedLockRepairSet = new Set(invalidatedLockRepairPaths);
  const unexpectedManagedEditPaths = args.managedLockRepairPaths === undefined
    ? []
    : [...allManagedEditPaths]
        .filter(
          (path) =>
            driftPathSet.has(path) &&
            !approvedLockRepairPaths.has(path) &&
            !invalidatedLockRepairSet.has(path)
        )
        .sort(compareStrings);
  const effectiveManagedEditPaths = new Set(allManagedEditPaths);
  if (args.managedLockRepairPaths !== undefined) {
    for (const path of approvedLockRepairPaths) {
      effectiveManagedEditPaths.delete(path);
    }
  }
  const managedState = {
    ...args.previousManagedState,
    editedPaths: effectiveManagedEditPaths,
  };
  const preflightDiagnostics = [
    ...await diagnoseOutputBackupPreflight(
      args.rootPath,
      args.rendered,
      staleManagedPaths,
      managedState,
      args.resolveOutputPath
    ),
    ...repairableLockPaths.map((path) =>
      lockProvenanceStates.get(path) === "migration"
        ? managedLockIntegrityMigrationDiagnostic(path)
        : managedLockProvenanceStaleDiagnostic(path)
    ),
    ...invalidatedLockRepairPaths.map(
      managedLockRepairInvalidatedDiagnostic
    ),
    ...unexpectedManagedEditPaths.map(
      managedOutputWriteInvalidatedDiagnostic
    ),
  ];
  const outputChanges = new Set([
    ...diff.missing,
    ...diff.changed.filter((path) => managedState.editedPaths.has(path)),
    ...diff.removed.filter((path) => managedState.editedPaths.has(path)),
  ]);
  const candidateSourceChanges = [...diff.added, ...diff.changed, ...diff.removed]
    .filter((path) => !outputChanges.has(path));
  const blockers = outputBlockers(
    [...args.diagnostics, ...preflightDiagnostics],
    managedState.paths.size,
    args.sourceDrivenOutputPaths ?? []
  );
  const blockedPaths = new Set(blockers.flatMap((blocker) => blocker.path === undefined ? [] : [blocker.path]));
  const sourceChanges = candidateSourceChanges.filter((path) => !blockedPaths.has(path));

  return {
    actualPaths,
    diff,
    managedState,
    outputState: classifySkillsetOutputState({
      blockers,
      hasBaseline: managedState.hasBaseline,
      outputChanges: [...outputChanges],
      sourceChanges,
    }),
    preflightDiagnostics,
    staleManagedPaths,
  };
}

function outputBlockers(
  diagnostics: readonly SkillsetDiagnostic[],
  managedOutputCount: number,
  sourceDrivenOutputPaths: readonly string[]
): SkillsetOutputStateEvidence["blockers"] {
  return diagnostics
    .filter((diagnostic) =>
      diagnostic.severity === "error" ||
      (diagnostic.code === "unmanaged-output-collision" &&
        !isEstablishedSourceDrivenOutput(
          diagnostic.outputPath ?? diagnostic.path,
          managedOutputCount,
          sourceDrivenOutputPaths
        ))
    )
    .map((diagnostic) => ({
      code: diagnostic.code,
      ...(diagnostic.outputPath === undefined && diagnostic.path === undefined ? {} : { path: diagnostic.outputPath ?? diagnostic.path }),
    }));
}

function classifyWriteSafety(
  inspected: SkillsetOutputStateEvidence,
  diagnostics: readonly SkillsetDiagnostic[],
  managedOutputCount: number,
  sourceDrivenOutputPaths: readonly string[]
): SkillsetOutputStateEvidence {
  const blockers = [
    ...inspected.blockers,
    ...outputBlockers(
      diagnostics,
      managedOutputCount,
      sourceDrivenOutputPaths
    ),
  ];
  const blockedPaths = new Set(
    blockers.flatMap((blocker) => blocker.path === undefined ? [] : [blocker.path])
  );
  return classifySkillsetOutputState({
    blockers,
    hasBaseline: inspected.hasBaseline,
    outputChanges: inspected.outputChanges,
    sourceChanges: inspected.sourceChanges.filter((path) => !blockedPaths.has(path)),
  });
}

type LockProvenanceState = "migration" | "repairable" | "trusted" | "unsafe";

function isRepairableLockProvenance(
  state: LockProvenanceState | undefined
): boolean {
  return state === "migration" || state === "repairable";
}

function classifyLockProvenance(
  path: string,
  current: Uint8Array,
  expected: Uint8Array,
  sourceDrivenPayloadChanges: ReadonlySet<string>,
  removedPayloadChanges: ReadonlySet<string>,
  editedOutputPaths: ReadonlySet<string>
): LockProvenanceState {
  const currentLock = JSON.parse(textDecoder.decode(current)) as unknown;
  const expectedLock = JSON.parse(textDecoder.decode(expected)) as unknown;
  if (!isJsonRecord(currentLock) || !isJsonRecord(expectedLock)) return "unsafe";
  if (currentLock.generatedBy !== expectedLock.generatedBy) return "unsafe";
  if (Object.keys(currentLock).some((key) => !LOCK_TOP_LEVEL_KEYS.has(key))) {
    return "unsafe";
  }
  if (hasUnknownFixedShapeLockFields(currentLock)) return "unsafe";
  const legacySchemaMigration =
    currentLock.schemaVersion === 1 &&
    expectedLock.schemaVersion === 2 &&
    hasCoherentLegacyIntegrity(path, currentLock, editedOutputPaths);
  if (
    !legacySchemaMigration &&
    currentLock.schemaVersion !== expectedLock.schemaVersion
  ) {
    return "unsafe";
  }
  if (currentLock.provenanceHash !== undefined) {
    if (!hasValidLockProvenance(currentLock)) return "repairable";
    return bytesEqual(
      current,
      textEncoder.encode(renderValidatedJson(currentLock, path))
    )
      ? "trusted"
      : "repairable";
  }
  if (currentLock.schemaVersion === 2) return "migration";
  if (
    legacySchemaMigration &&
    hasLegacyTopLevelChanges(currentLock, expectedLock)
  ) {
    return "repairable";
  }

  // Top-level fields are derived from config, render results, or target
  // topology. Item provenance may also change from source, but only alongside
  // a tracked payload change; otherwise the lock itself is the untrusted side.
  if (JSON.stringify(currentLock.items) === JSON.stringify(expectedLock.items)) {
    return "trusted";
  }
  if (
    legacySchemaMigration &&
    lockItemsWithoutGeneratedIntegrity(currentLock) ===
      lockItemsWithoutGeneratedIntegrity(expectedLock)
  ) {
    return "trusted";
  }
  const outputRoot = outputRootForLockPath(path);
  const currentItems = lockItemsByIdentity(currentLock);
  const expectedItems = lockItemsByIdentity(expectedLock);
  for (const identity of new Set([...currentItems.keys(), ...expectedItems.keys()])) {
    const currentGroup = currentItems.get(identity) ?? [];
    const expectedGroup = expectedItems.get(identity) ?? [];
    if (JSON.stringify(currentGroup) === JSON.stringify(expectedGroup)) continue;
    const trackedPaths = new Set(
      [...currentGroup, ...expectedGroup]
        .flatMap((item) => [...outputPathsForLockItem(outputRoot, item)])
    );
    if (
      expectedGroup.length === 0 &&
      currentGroup.length > 0 &&
      [...removedPayloadChanges].some((payloadPath) => trackedPaths.has(payloadPath))
    ) {
      continue;
    }
    if (![...sourceDrivenPayloadChanges].some((payloadPath) => trackedPaths.has(payloadPath))) {
      return "repairable";
    }
  }
  return "trusted";
}

function managedLockProvenanceStaleDiagnostic(
  outputPath: string
): SkillsetDiagnostic {
  return {
    code: "managed-lock-provenance-stale",
    featureId: "output-safety",
    message:
      "managed lock differs only in recognized generated provenance; an explicit repair may rebuild it",
    outputPath,
    severity: "warning",
  };
}

function managedLockIntegrityMigrationDiagnostic(
  outputPath: string
): SkillsetDiagnostic {
  return {
    code: "managed-lock-integrity-migration",
    featureId: "output-safety",
    message:
      "managed v2 lock does not include verifiable lock integrity provenance; run skillset build --yes to migrate it, with the previous lock backed up before writing",
    outputPath,
    severity: "warning",
  };
}

function managedLockRepairInvalidatedDiagnostic(
  outputPath: string
): SkillsetDiagnostic {
  return {
    code: "managed-lock-repair-invalidated",
    featureId: "output-safety",
    message:
      "managed lock no longer matches the approved repair evidence; rerun inspection before writing",
    outputPath,
    severity: "error",
  };
}

function managedOutputWriteInvalidatedDiagnostic(
  outputPath: string
): SkillsetDiagnostic {
  return {
    code: "managed-output-write-invalidated",
    featureId: "output-safety",
    message:
      "managed output changed after write safety approval; rerun inspection before writing",
    outputPath,
    severity: "error",
  };
}

function outputWriteInvalidatedDiagnostic(
  outputPath: string
): SkillsetDiagnostic {
  return {
    code: "output-write-preimage-invalidated",
    featureId: "output-safety",
    message:
      "output changed after final write approval; rerun inspection before writing",
    outputPath,
    severity: "error",
  };
}

function hasUnknownFixedShapeLockFields(lock: JsonRecord): boolean {
  if (
    !isJsonRecord(lock.features) ||
    Object.keys(lock.features).some((key) => !LOCK_FEATURE_KEYS.has(key))
  ) {
    return true;
  }
  if (!Array.isArray(lock.items)) return true;
  return lock.items.some(
    (item) =>
      !isJsonRecord(item) ||
      Object.keys(item).some((key) => !LOCK_ITEM_KEYS.has(key))
  );
}

function hasCoherentLegacyIntegrity(
  path: string,
  lock: JsonRecord,
  editedOutputPaths: ReadonlySet<string>
): boolean {
  const items = Array.isArray(lock.items) ? lock.items : [];
  if (items.length === 0) return false;
  const outputRoot = outputRootForLockPath(path);
  for (const item of items) {
    if (
      !isJsonRecord(item) ||
      item.fileModes !== undefined ||
      typeof item.outputHash !== "string"
    ) {
      return false;
    }
    if (
      [...outputPathsForLockItem(outputRoot, item)]
        .some((outputPath) => editedOutputPaths.has(outputPath))
    ) {
      return false;
    }
  }
  return true;
}

function lockItemsWithoutGeneratedIntegrity(lock: JsonRecord): string {
  const items = Array.isArray(lock.items) ? lock.items : [];
  return JSON.stringify(
    items.map((item) => {
      if (!isJsonRecord(item)) return item;
      return Object.fromEntries(
        Object.entries(item).filter(
          ([key]) => key !== "fileModes" && key !== "outputHash"
        )
      );
    })
  );
}

function hasLegacyTopLevelChanges(
  current: JsonRecord,
  expected: JsonRecord
): boolean {
  const legacyComparableMetadata = (lock: JsonRecord): string =>
    JSON.stringify(
      Object.fromEntries(
        Object.entries(lock).filter(
          ([key]) =>
            key !== "items" &&
            key !== "provenanceHash" &&
            key !== "schemaVersion"
        )
      )
    );
  return legacyComparableMetadata(current) !== legacyComparableMetadata(expected);
}

function lockItemsByIdentity(
  lock: JsonRecord
): ReadonlyMap<string, readonly JsonRecord[]> {
  const groups = new Map<string, JsonRecord[]>();
  const items = Array.isArray(lock.items) ? lock.items : [];
  for (const item of items) {
    if (!isJsonRecord(item)) continue;
    const identity = JSON.stringify([
      item.kind,
      item.name,
      item.sourcePath,
      item.outputPath,
    ]);
    const group = groups.get(identity) ?? [];
    group.push(item);
    groups.set(identity, group);
  }
  return groups;
}

function isEstablishedSourceDrivenOutput(
  path: string | undefined,
  managedOutputCount: number,
  sourceDrivenOutputPaths: readonly string[]
): boolean {
  return path !== undefined &&
    managedOutputCount > 0 &&
    sourceDrivenOutputPaths.includes(path);
}

export type SkillsetDiffResult = SkillsetOperationResult<SkillsetDiff> & {
  readonly outputState: SkillsetOutputStateEvidence;
};

export interface SkillsetDiffInspectionOptions {
  readonly enforceRenderPolicy?: boolean;
  /** Paths proven source-driven by the calling analysis or operation. */
  readonly sourceDrivenOutputPaths?: readonly string[];
}

/**
 * Compute the generated changes a build would make, without writing anything.
 * Backs `skillset diff` and `skillset status`.
 */
export async function diffSkillset(
  rootPath: string,
  options: SkillsetOptions = {}
): Promise<SkillsetDiff> {
  return (await diffSkillsetResult(rootPath, options)).data;
}

export async function diffSkillsetResult(
  rootPath: string,
  options: SkillsetOptions = {},
  inspection: SkillsetDiffInspectionOptions = {}
): Promise<SkillsetDiffResult> {
  const graph = await loadBuildGraph(rootPath, options);
  const diagnostics = [...graph.warnings.map(sourceWarningDiagnostic)];
  const pathContext = operationalPathContextForGraph(rootPath, graph, options);
  const resolveOutputPath = outputPathResolver(pathContext);
  const outPath = outPathMapper(options);
  const allRendered = await renderBuildGraph(graph);
  const scopedRendered = scopedRenderedFiles(graph, allRendered, options.scopes);
  const renderResults = collectRenderResults(graph, allRendered, {
    includedPaths: new Set(scopedRendered.map((file) => file.path)),
    mapOutputPath: outPath,
    scopes: options.scopes,
  });
  const policyAdjustedRenderResults = applyUnsupportedDestinationPolicy(renderResults, graph.root.compile.unsupportedDestination);
  if (inspection.enforceRenderPolicy !== false) {
    enforceSoftPolicyHasUsableOutput(scopedRendered, policyAdjustedRenderResults, graph.root.compile.unsupportedDestination);
    enforceRenderResultPolicy(policyAdjustedRenderResults, graph.root.compile.unsupportedDestination);
  }
  diagnostics.push(...unsupportedDestinationPolicyDiagnostics(policyAdjustedRenderResults, graph.root.compile.unsupportedDestination));
  const renderedWithoutOutcomeMetadata = mirroredRenderedFiles(scopedRendered, outPath);
  const instructionDiagnostics = diagnoseLargeInstructionFiles(renderedWithoutOutcomeMetadata);
  diagnostics.push(...instructionDiagnostics);
  const renderResultsWithDiagnostics = attachDiagnosticsToRenderResults(policyAdjustedRenderResults, instructionDiagnostics);
  const rendered = withPersistedRenderResults(
    renderedWithoutOutcomeMetadata,
    renderResultsWithDiagnostics
  );
  const expected = new Map(rendered.map((file) => [file.path, file]));
  const liveOutputRoots = scopedOutputRoots(graph, options.scopes);
  const outputRoots = mirroredOutputRoots(liveOutputRoots, outPath);
  const includeWorkspaceLock = includesProjectScope(options.scopes);
  const previousManagedState = await readManagedOutputState(rootPath, liveOutputRoots, includeWorkspaceLock, outPath, resolveOutputPath, displayPathMapper(pathContext));
  const inspectionResult = await inspectOutputPlan({
    diagnostics,
    expected,
    outputRoots,
    pathContext,
    previousManagedState,
    rendered,
    resolveOutputPath,
    rootPath,
    ...(inspection.sourceDrivenOutputPaths === undefined
      ? {}
      : { sourceDrivenOutputPaths: inspection.sourceDrivenOutputPaths }),
  });
  diagnostics.push(...inspectionResult.preflightDiagnostics);
  return {
    data: inspectionResult.diff,
    diagnostics,
    outputState: inspectionResult.outputState,
    renderResults: renderResultsWithDiagnostics,
    ok: inspectionResult.outputState.state !== "blocked",
    operation: "diff",
    writes: {
      deletedPaths: [],
      mode: "read",
      paths: [],
      writtenPaths: [],
    },
  };
}

export async function verifySkillset(
  rootPath: string,
  options: SkillsetOptions = {}
): Promise<CheckResult> {
  const result = await verifySkillsetResult(rootPath, options);
  if (!result.ok) {
    throw new Error(`skillset: generated output is not current\n${result.data.failures.join("\n")}`);
  }
  return result.data;
}

export type SkillsetVerifyResult = SkillsetOperationResult<CheckResult> & {
  readonly outputState: SkillsetOutputStateEvidence;
};

export async function verifySkillsetResult(
  rootPath: string,
  options: SkillsetOptions = {}
): Promise<SkillsetVerifyResult> {
  const graph = await loadBuildGraph(rootPath, options);
  const diagnostics = [...graph.warnings.map(sourceWarningDiagnostic)];
  const pathContext = operationalPathContextForGraph(rootPath, graph, options);
  const resolveOutputPath = outputPathResolver(pathContext);
  const outPath = outPathMapper(options);
  const allRendered = await renderBuildGraph(graph);
  const scopedRendered = scopedRenderedFiles(graph, allRendered, options.scopes);
  const renderResults = collectRenderResults(graph, allRendered, {
    includedPaths: new Set(scopedRendered.map((file) => file.path)),
    mapOutputPath: outPath,
    scopes: options.scopes,
  });
  const policyAdjustedRenderResults = applyUnsupportedDestinationPolicy(renderResults, graph.root.compile.unsupportedDestination);
  enforceSoftPolicyHasUsableOutput(scopedRendered, policyAdjustedRenderResults, graph.root.compile.unsupportedDestination);
  enforceRenderResultPolicy(policyAdjustedRenderResults, graph.root.compile.unsupportedDestination);
  diagnostics.push(...unsupportedDestinationPolicyDiagnostics(policyAdjustedRenderResults, graph.root.compile.unsupportedDestination));
  const renderedWithoutOutcomeMetadata = mirroredRenderedFiles(scopedRendered, outPath);
  const instructionDiagnostics = diagnoseLargeInstructionFiles(renderedWithoutOutcomeMetadata);
  diagnostics.push(...instructionDiagnostics);
  const renderResultsWithDiagnostics = attachDiagnosticsToRenderResults(policyAdjustedRenderResults, instructionDiagnostics);
  const rendered = withPersistedRenderResults(
    renderedWithoutOutcomeMetadata,
    renderResultsWithDiagnostics
  );
  const expected = new Map(rendered.map((file) => [file.path, file]));
  const liveOutputRoots = scopedOutputRoots(graph, options.scopes);
  const outputRoots = mirroredOutputRoots(liveOutputRoots, outPath);
  const includeWorkspaceLock = includesProjectScope(options.scopes);
  const previousManagedState = await readManagedOutputState(rootPath, liveOutputRoots, includeWorkspaceLock, outPath, resolveOutputPath, displayPathMapper(pathContext));
  const inspection = await inspectOutputPlan({
    diagnostics,
    expected,
    outputRoots,
    pathContext,
    previousManagedState,
    rendered,
    resolveOutputPath,
    rootPath,
  });
  diagnostics.push(...inspection.preflightDiagnostics);
  const actualPaths = [...inspection.actualPaths];
  const actual = inspection.actualPaths;
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

    const outputPath = resolveOutputPath(file.path);
    const current = await readFile(outputPath);
    if (!bytesEqual(current, file.content)) {
      const message = versionDriftMessage(file.path, current, file.content) ?? `stale generated file: ${file.path}`;
      failures.push(message);
      driftDiagnostics.push(generatedDriftDiagnostic("changed", file.path, message));
      continue;
    }
    if (!(await generatedFileOnDiskMatchesMode(outputPath, file))) {
      const actualMode = supportsGeneratedFileModes()
        ? ((await stat(outputPath)).mode & 0o777).toString(8).padStart(4, "0")
        : formatGeneratedFileMode(file.mode);
      const message =
        `stale generated file mode: ${file.path}; expected ${formatGeneratedFileMode(file.mode)}, found ${actualMode}`;
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
    outputState: inspection.outputState,
    renderResults: renderResultsWithDiagnostics,
    ok: failures.length === 0 && inspection.outputState.state !== "blocked",
    operation: "verify",
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

function applyUnsupportedDestinationPolicy(
  renderResults: readonly SkillsetRenderResult[],
  unsupportedPolicy: UnsupportedDestinationPolicy
): readonly SkillsetRenderResult[] {
  if (unsupportedPolicy === "error") return renderResults;
  const policy = unsupportedDestinationRenderPolicy(unsupportedPolicy);
  return renderResults.map((outcome) => {
    if (!isSoftUnsupportedDestinationOutcome(outcome)) return outcome;
    return defineRenderResult({ ...outcome, policy });
  });
}

function unsupportedDestinationPolicyDiagnostics(
  renderResults: readonly SkillsetRenderResult[],
  unsupportedPolicy: UnsupportedDestinationPolicy
): readonly SkillsetDiagnostic[] {
  if (unsupportedPolicy === "error") return [];
  return renderResults
    .filter(isSoftUnsupportedDestinationOutcome)
    .map((outcome) => ({
      code: `unsupported-destination-${unsupportedPolicy}`,
      featureId: outcome.featureId,
      message: unsupportedDestinationPolicyMessage(outcome, unsupportedPolicy),
      ...(outcome.sourcePath === undefined ? {} : { path: outcome.sourcePath }),
      severity: "warning" as const,
      sourceUnit: outcome.sourceUnit,
      ...(outcome.target === undefined ? {} : { target: outcome.target }),
    }));
}

function unsupportedDestinationPolicyMessage(
  outcome: SkillsetRenderResult,
  unsupportedPolicy: UnsupportedDestinationPolicy
): string {
  const target = outcome.target ?? "workspace";
  const destination = outcome.destination === undefined ? "" : ` ${outcome.destination}`;
  const reason = outcome.reason ?? "no reason recorded";
  if (unsupportedPolicy === "warn") {
    return `unsupported destination warning: ${target}${destination} ${outcome.featureId} ${outcome.status}; ${reason}`;
  }
  if (unsupportedPolicy === "skip") {
    return `unsupported destination skipped: ${target}${destination} ${outcome.featureId} ${outcome.status}; ${reason}`;
  }
  return `unsupported destination forced: ${target}${destination} ${outcome.featureId} ${outcome.status}; ${reason}`;
}

function unsupportedDestinationRenderPolicy(
  unsupportedPolicy: UnsupportedDestinationPolicy
): SkillsetRenderResultPolicy {
  return `unsupported:${unsupportedPolicy}`;
}

function isSoftUnsupportedDestinationOutcome(outcome: SkillsetRenderResult): boolean {
  return outcome.status === "lossy" || outcome.status === "unsupported";
}

function enforceSoftPolicyHasUsableOutput(
  rendered: readonly RenderedFile[],
  renderResults: readonly SkillsetRenderResult[],
  unsupportedPolicy: UnsupportedDestinationPolicy
): void {
  if (unsupportedPolicy === "error") return;
  const softened = renderResults.filter(isSoftUnsupportedDestinationOutcome);
  if (softened.length === 0) return;
  if (rendered.some((file) => !isLockFilePath(file.path))) return;
  throw new SkillsetRenderResultError(
    [
      `skillset: unsupported destination policy ${unsupportedPolicy} produced no usable target output`,
      "at least one non-lock output must remain so unsupported source cannot look synchronized",
    ].join("\n"),
    softened,
    "no-usable-output"
  );
}

function buildResult(
  rendered: readonly RenderedFile[],
  diagnostics: readonly SkillsetDiagnostic[],
  outputState: SkillsetOutputStateEvidence,
  renderResults: readonly SkillsetRenderResult[],
  writes: SkillsetWriteSummary
): SkillsetBuildResult {
  return {
    data: rendered,
    diagnostics,
    outputState,
    renderResults,
    ok: true,
    operation: "build",
    writes,
  };
}

function blockedBuildResult(
  rendered: readonly RenderedFile[],
  diagnostics: readonly SkillsetDiagnostic[],
  outputState: SkillsetOutputStateEvidence,
  renderResults: readonly SkillsetRenderResult[],
  backup?: OutputBackupSummary
): SkillsetBuildResult {
  return {
    data: rendered,
    diagnostics,
    outputState,
    renderResults,
    ok: false,
    operation: "build",
    writes: withBackupSummary(
      {
        deletedPaths: [],
        mode: "read",
        paths: [],
        writtenPaths: [],
      },
      backup
    ),
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
  return rendered.map((file) => {
    if (!isLockFilePath(file.path)) return file;
    const lock = parseLockFile(file);
    const lockOutcomes = renderResultsForLock(file.path, lock, renderResults);
    const withoutHash: JsonRecord = {
      ...lock,
      ...(lockOutcomes.length === 0 ? {} : { renderResults: lockOutcomes as unknown as JsonValue }),
    };
    const value = withLockProvenance(withoutHash);
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
      if (target !== undefined && target !== "workspace" && (outcome.target ?? "workspace") !== target) return false;
      const outputPaths = outcome.outputs?.map((output) => output.path) ?? [];
      if (outputPaths.length === 0) {
        return outputRoot === "." || noOutputOutcomeBelongsToLock(outcome, outputRoot);
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

function noOutputOutcomeBelongsToLock(
  outcome: SkillsetRenderResult,
  outputRoot: string
): boolean {
  if (outcome.sourceUnit.startsWith("plugin.")) {
    const pluginId = outcome.sourceUnit.slice("plugin.".length).split(".")[0];
    return outputRoot.startsWith(`plugins/${pluginId}/`);
  }
  if (outcome.sourceUnit.startsWith("skill:")) {
    return outputRoot.endsWith("/skills") || outputRoot.endsWith(".agents/skills");
  }
  if (outcome.sourceUnit.startsWith("agent:")) {
    return outputRoot.endsWith("/agents");
  }
  return false;
}

function outputPathsForLock(outputRoot: string, lock: JsonRecord): ReadonlySet<string> {
  const items = Array.isArray(lock.items) ? lock.items : [];
  const paths = new Set<string>();
  for (const item of items) {
    if (!isJsonRecord(item)) continue;
    for (const path of outputPathsForLockItem(outputRoot, item)) paths.add(path);
  }
  return paths;
}

function outputPathsForLockItem(
  outputRoot: string,
  item: JsonRecord
): ReadonlySet<string> {
  let files: readonly string[] = [];
  if (Array.isArray(item.files) && item.files.every((entry) => typeof entry === "string")) {
    files = item.files;
  } else if (typeof item.outputPath === "string") {
    files = [item.outputPath];
  }
  return new Set(
    files.map((file) => join(outputRoot, file).replaceAll("\\", "/"))
  );
}

function outputRootForLockPath(lockPath: string): string {
  if (lockPath === "skillset.lock") return ".";
  return dirname(lockPath).replaceAll("\\", "/");
}

function isLockFilePath(path: string): boolean {
  return path === "skillset.lock" || path.endsWith("/skillset.lock");
}

async function diagnoseMissingManagedOutputs(
  rendered: readonly RenderedFile[],
  previousManagedPaths: ReadonlySet<string>,
  resolveOutputPath: OutputPathResolver
): Promise<readonly SkillsetDiagnostic[]> {
  const diagnostics: SkillsetDiagnostic[] = [];
  for (const file of rendered) {
    if (!previousManagedPaths.has(file.path)) continue;
    if (await exists(resolveOutputPath(file.path))) continue;
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
  rendered: readonly RenderedFile[],
  writePreimages: ReadonlyMap<string, OutputWritePreimage>,
  resolveOutputPath: OutputPathResolver
): Promise<readonly string[]> {
  const writtenPaths: string[] = [];
  for (const file of rendered) {
    const outputPath = resolveOutputPath(file.path);
    const preimage = await assertOutputWritePreimage(file.path, writePreimages, resolveOutputPath);
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, file.content, {
      flag: preimage.state === "absent" ? "wx" : "w",
    });
    await applyGeneratedFileMode(outputPath, file);
    writtenPaths.push(file.path);
  }
  return writtenPaths.sort(compareStrings);
}

async function writeChangedRenderedFiles(
  rendered: readonly RenderedFile[],
  actualPaths: ReadonlySet<string>,
  writePreimages: ReadonlyMap<string, OutputWritePreimage>,
  resolveOutputPath: OutputPathResolver
): Promise<readonly string[]> {
  const writtenPaths: string[] = [];
  for (const file of rendered) {
    const outputPath = resolveOutputPath(file.path);
    const preimage = await assertOutputWritePreimage(file.path, writePreimages, resolveOutputPath);
    if (actualPaths.has(file.path)) {
      const current = await readFile(outputPath);
      if (bytesEqual(current, file.content)) {
        if (await generatedFileOnDiskMatchesMode(outputPath, file)) continue;
        await applyGeneratedFileMode(outputPath, file);
        writtenPaths.push(file.path);
        continue;
      }
    }
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, file.content, {
      flag: preimage.state === "absent" ? "wx" : "w",
    });
    await applyGeneratedFileMode(outputPath, file);
    writtenPaths.push(file.path);
  }
  return writtenPaths.sort(compareStrings);
}

async function removeStaleGeneratedFiles(
  actualPaths: ReadonlySet<string>,
  expectedPaths: ReadonlySet<string>,
  writePreimages: ReadonlyMap<string, OutputWritePreimage>,
  resolveOutputPath: OutputPathResolver
): Promise<readonly string[]> {
  const deletedPaths: string[] = [];
  for (const path of actualPaths) {
    if (expectedPaths.has(path)) continue;
    await assertOutputWritePreimage(path, writePreimages, resolveOutputPath);
    await rm(resolveOutputPath(path), { force: true });
    deletedPaths.push(path);
  }
  return deletedPaths.sort(compareStrings);
}

async function readOutputWritePreimage(
  targetPath: string,
  resolveOutputPath: OutputPathResolver
): Promise<OutputWritePreimage> {
  const absolutePath = resolveOutputPath(targetPath);
  if (!(await exists(absolutePath))) return { state: "absent", targetPath };
  const content = await readFile(absolutePath);
  const currentStats = await stat(absolutePath);
  return {
    content,
    ...(supportsGeneratedFileModes()
      ? { mode: formatDiskMode(currentStats.mode) }
      : {}),
    state: "present",
    targetPath,
  };
}

async function invalidatedOutputWritePaths(
  preimages: ReadonlyMap<string, OutputWritePreimage>,
  resolveOutputPath: OutputPathResolver
): Promise<readonly string[]> {
  const invalidated: string[] = [];
  for (const [targetPath, preimage] of preimages) {
    const current = await readOutputWritePreimage(targetPath, resolveOutputPath);
    if (!outputWritePreimagesEqual(preimage, current)) invalidated.push(targetPath);
  }
  return invalidated.sort(compareStrings);
}

async function assertOutputWritePreimage(
  targetPath: string,
  preimages: ReadonlyMap<string, OutputWritePreimage>,
  resolveOutputPath: OutputPathResolver
): Promise<OutputWritePreimage> {
  const preimage = preimages.get(targetPath);
  if (preimage === undefined) {
    throw new Error(`skillset: missing write preimage for ${targetPath}`);
  }
  const current = await readOutputWritePreimage(targetPath, resolveOutputPath);
  if (!outputWritePreimagesEqual(preimage, current)) {
    throw new Error(
      `skillset: output changed after final write approval: ${targetPath}`
    );
  }
  return preimage;
}

function outputWritePreimagesEqual(
  left: OutputWritePreimage,
  right: OutputWritePreimage
): boolean {
  if (left.state !== right.state) return false;
  if (left.state === "absent" || right.state === "absent") return true;
  return bytesEqual(left.content, right.content) && left.mode === right.mode;
}

function formatDiskMode(mode: number): string {
  return (mode & 0o777).toString(8).padStart(4, "0");
}

async function listOutputFiles(
  context: OperationalPathContext,
  outputRoots: readonly string[],
  resolveOutputPath: OutputPathResolver
): Promise<readonly string[]> {
  const paths: string[] = [];
  for (const outputRoot of outputRoots) {
    const absoluteTarget = resolveOutputPath(outputRoot);
    if (!(await exists(absoluteTarget))) continue;
    for (const file of await collectFiles(absoluteTarget)) {
      paths.push(logicalOperationalPath(context, file));
    }
  }
  return paths.sort();
}

async function listGeneratedFiles(
  context: OperationalPathContext,
  outputRoots: readonly string[],
  rendered: readonly RenderedFile[],
  previousManagedPaths: ReadonlySet<string>,
  resolveOutputPath: OutputPathResolver
): Promise<readonly string[]> {
  const paths = new Set(await listOutputFiles(context, outputRoots, resolveOutputPath));

  for (const path of previousManagedPaths) {
    if (isInsideAnyOutputRoot(path, outputRoots)) continue;
    if (await exists(resolveOutputPath(path))) paths.add(path);
  }

  for (const file of rendered) {
    if (isInsideAnyOutputRoot(file.path, outputRoots)) continue;
    if (await exists(resolveOutputPath(file.path))) paths.add(file.path);
  }

  return [...paths].sort();
}

function outputPathResolver(context: OperationalPathContext): OutputPathResolver {
  return (path) => resolveOperationalPath(context, path);
}

function displayPathMapper(context: OperationalPathContext): (absolutePath: string) => string {
  return (absolutePath) => logicalOperationalPath(context, absolutePath);
}

function operationalPathContextForGraph(
  rootPath: string,
  graph: BuildGraph,
  options: SkillsetOptions
): OperationalPathContext {
  return createOperationalPathContext(rootPath, {
    ...(graph.root.workspace.cacheKey === undefined ? {} : { workspaceCacheKey: graph.root.workspace.cacheKey }),
    ...(options.xdg?.env === undefined ? {} : { env: options.xdg.env }),
    ...(options.xdg?.homeDir === undefined ? {} : { homeDir: options.xdg.homeDir }),
  });
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
    pluginTargetForOutputPath(graph, path) !== undefined ||
    targetNames().some((target) => isInsideOutputRoot(path, graph.root.outputs.plugins[target]))
  ) {
    return "plugins";
  }
  if (
    targetNames().some((target) => isInsideOutputRoot(path, graph.root.outputs.skills[target]))
  ) {
    return "repo";
  }
  return "project";
}

function isInsideOutputRoot(path: string, outputRoot: string): boolean {
  return path === outputRoot || path.startsWith(`${outputRoot}/`);
}

export function includesProjectScope(scopes: readonly BuildScope[] | undefined): boolean {
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
    path.endsWith("/.codex-plugin/plugin.json") ||
    path.endsWith("/.cursor-plugin/plugin.json")
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
