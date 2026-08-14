import {
  buildSkillsetResult,
  checkSkillsetSourceReadiness,
  classifySkillsetOutputFailure,
  diffSkillsetResult,
  type SkillsetDiagnostic,
  type SkillsetOutputStateEvidence,
} from "@skillset/core";
import type { SkillsetOptions } from "@skillset/core/internal/types";

import { serializeDiagnostics } from "./cli-diagnostics";
import { rememberKnownSkillsetWorkspace } from "./cli-known-workspaces";
import { printCliJsonData } from "./cli-output";
import {
  printDiagnostics,
  printDiffPlan,
  printGeneratedChangelogDriftHint,
} from "./cli-renderers";

export interface BuildCommandRequest {
  readonly jsonOutput: boolean;
  readonly options: SkillsetOptions;
  readonly rootPath: string;
  readonly yes: boolean;
}

export async function runBuildCommand({
  jsonOutput,
  options,
  rootPath,
  yes,
}: BuildCommandRequest): Promise<void> {
  if (!yes) {
    let result: Awaited<ReturnType<typeof diffSkillsetResult>>;
    try {
      result = await diffSkillsetResult(rootPath, options);
    } catch (error) {
      await reportBlockedDerivation("build.plan", rootPath, options, error, jsonOutput);
      return;
    }
    if (jsonOutput) {
      if (result.ok) {
        await rememberKnownSkillsetWorkspace(rootPath, options, true);
      }
      printCliJsonData(
        "build.plan",
        {
          changes: result.data,
          outputState: result.outputState,
          state: "planned",
          writes: [],
        },
        result.ok ? 0 : 1,
        "plan",
        serializeDiagnostics(result.diagnostics)
      );
      if (!result.ok) {
        process.exitCode = 1;
      }
      return;
    }
    console.log("skillset: build projects source to generated output");
    printDiagnostics(result.diagnostics);
    const { data: diff } = result;
    printDiffPlan(diff, "write confirmation required");
    if (!result.ok) {
      console.error("skillset: build is blocked; resolve the reported errors before writing generated files");
      process.exitCode = 1;
      return;
    }
    console.log("skillset: rerun with --yes to write generated files");
    await rememberKnownSkillsetWorkspace(rootPath, options);
    return;
  }
  let preview: Awaited<ReturnType<typeof diffSkillsetResult>>;
  try {
    preview = await diffSkillsetResult(rootPath, options);
  } catch (error) {
    await reportBlockedDerivation("build.apply", rootPath, options, error, jsonOutput);
    return;
  }
  if (!preview.ok) {
    if (jsonOutput) {
      printCliJsonData(
        "build.apply",
        {
          report: {
            ok: false,
            operation: "build",
            outputState: preview.outputState,
            renderResults: preview.renderResults.length,
            renderedFiles: 0,
            writes: { deletedPaths: [], mode: "read", paths: [], writtenPaths: [] },
          },
          state: "blocked",
          writes: [],
        },
        1,
        "mutation",
        serializeDiagnostics(preview.diagnostics)
      );
    } else {
      console.log("skillset: build projects source to generated output");
      printDiagnostics(preview.diagnostics);
      console.error("skillset: build is blocked; no generated files were written");
    }
    process.exitCode = 1;
    return;
  }
  const result = await buildSkillsetResult(rootPath, options);
  if (jsonOutput) {
    if (result.ok) {
      await rememberKnownSkillsetWorkspace(rootPath, options, true);
    }
    const writes =
      result.writes.backupManifestPath === undefined
        ? result.writes.paths
        : [...result.writes.paths, result.writes.backupManifestPath];
    printCliJsonData(
      "build.apply",
      {
        report: {
          ok: result.ok,
          operation: result.operation,
          outputState: result.outputState,
          renderResults: result.renderResults.length,
          renderedFiles: result.data.length,
          writes: result.writes,
        },
        state: result.ok ? (writes.length > 0 ? "written" : "planned") : "blocked",
        writes,
      },
      result.ok ? 0 : 1,
      "mutation",
      serializeDiagnostics(result.diagnostics)
    );
    if (!result.ok) {
      process.exitCode = 1;
    }
    return;
  }
  console.log("skillset: build projects source to generated output");
  printDiagnostics(result.diagnostics);
  if (!result.ok) {
    console.error("skillset: build is blocked; no generated files were written");
    process.exitCode = 1;
    return;
  }
  console.log(
    `skillset: wrote ${result.writes.writtenPaths.length} generated files`
  );
  if (result.writes.deletedPaths.length > 0) {
    console.log(
      `skillset: removed ${result.writes.deletedPaths.length} stale generated files`
    );
  }
  if (result.writes.backupManifestPath !== undefined) {
    console.log(
      `skillset: backed up ${result.writes.backupRecords?.length ?? 0} overwritten output file` +
        `${result.writes.backupRecords?.length === 1 ? "" : "s"} to ${result.writes.backupManifestPath}`
    );
  }
  await rememberKnownSkillsetWorkspace(rootPath, options);
  return;
}

export interface DiffCommandRequest {
  readonly jsonOutput: boolean;
  readonly options: SkillsetOptions;
  readonly rootPath: string;
}

export async function runDiffCommand({
  jsonOutput,
  options,
  rootPath,
}: DiffCommandRequest): Promise<void> {
  let result: Awaited<ReturnType<typeof diffSkillsetResult>>;
  try {
    result = await diffSkillsetResult(rootPath, options);
  } catch (error) {
    await reportBlockedDerivation("diff", rootPath, options, error, jsonOutput);
    return;
  }
  if (jsonOutput) {
    const exitCode = result.ok ? 0 : 1;
    printCliJsonData(
      "diff",
      { ...result.data, outputState: result.outputState },
      exitCode,
      "data",
      serializeDiagnostics(result.diagnostics)
    );
    return;
  }
  printDiagnostics(result.diagnostics);
  const { data: diff } = result;
  const total =
    diff.added.length +
    diff.changed.length +
    diff.missing.length +
    diff.removed.length;
  if (total === 0) {
    console.log("skillset: no generated changes");
    return;
  }
  for (const path of diff.added) {
    console.log(`  + ${path}`);
  }
  for (const path of diff.changed) {
    console.log(`  ~ ${path}`);
  }
  for (const path of diff.missing) {
    console.log(`  ! ${path}`);
  }
  for (const path of diff.removed) {
    console.log(`  - ${path}`);
  }
  const suffix = result.ok
    ? " (run skillset build --yes to apply)"
    : " (resolve the reported blockers before applying)";
  console.log(
    `skillset: ${diff.added.length} added, ${diff.changed.length} changed, ${diff.missing.length} missing, ${diff.removed.length} removed${suffix}`
  );
  if (!result.ok) process.exitCode = 1;
  printGeneratedChangelogDriftHint(diff);
  return;
}

async function reportBlockedDerivation(
  command: "build.apply" | "build.plan" | "diff",
  rootPath: string,
  options: SkillsetOptions,
  error: unknown,
  jsonOutput: boolean
): Promise<void> {
  const readiness = await checkSkillsetSourceReadiness(rootPath, options);
  const outputState = readiness.data.outputState.state === "blocked"
    ? readiness.data.outputState
    : classifySkillsetOutputFailure(error, readiness.data.outputState.hasBaseline);
  const diagnostics = failureDiagnostics(error, outputState);
  if (jsonOutput) {
    const data = command === "diff"
      ? { added: [], changed: [], missing: [], outputState, removed: [] }
      : command === "build.plan"
        ? { changes: { added: [], changed: [], missing: [], removed: [] }, outputState, state: "blocked", writes: [] }
        : {
            report: {
              ok: false,
              operation: "build",
              outputState,
              renderResults: 0,
              renderedFiles: 0,
              writes: { deletedPaths: [], mode: "read", paths: [], writtenPaths: [] },
            },
            state: "blocked",
            writes: [],
          };
    printCliJsonData(command, data, 1, "diagnostics", serializeDiagnostics(diagnostics));
  } else {
    printDiagnostics(diagnostics);
    console.error("skillset: output derivation is blocked");
  }
  process.exitCode = 1;
}

function failureDiagnostics(
  error: unknown,
  outputState: SkillsetOutputStateEvidence
): readonly SkillsetDiagnostic[] {
  const message = error instanceof Error ? error.message : String(error);
  return outputState.blockers.map((blocker) => ({
    code: blocker.code,
    message,
    ...(blocker.path === undefined ? {} : { path: blocker.path }),
    severity: "error",
  }));
}
