import { buildSkillsetResult, diffSkillsetResult } from "@skillset/core";
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
    const result = await diffSkillsetResult(rootPath, options);
    if (jsonOutput) {
      if (result.ok) {
        await rememberKnownSkillsetWorkspace(rootPath, options, true);
      }
      printCliJsonData(
        "build.plan",
        { changes: result.data, state: "planned", writes: [] },
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
    console.log("skillset: rerun with --yes to write generated files");
    await rememberKnownSkillsetWorkspace(rootPath, options);
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
          renderResults: result.renderResults.length,
          renderedFiles: result.data.length,
          writes: result.writes,
        },
        state: writes.length > 0 ? "written" : "planned",
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
  const result = await diffSkillsetResult(rootPath, options);
  if (jsonOutput) {
    const exitCode = result.ok ? 0 : 1;
    printCliJsonData(
      "diff",
      result.data,
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
  console.log(
    `skillset: ${diff.added.length} added, ${diff.changed.length} changed, ${diff.missing.length} missing, ${diff.removed.length} removed (run skillset build --yes to apply)`
  );
  printGeneratedChangelogDriftHint(diff);
  return;
}
