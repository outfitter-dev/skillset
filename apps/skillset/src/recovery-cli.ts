import { inspectOutputBackups, restoreOutputBackup } from "@skillset/core";
import type { OutputBackupRestoreReport } from "@skillset/core";
import type { SkillsetOptions } from "@skillset/core/internal/types";

import { printCliJsonData } from "./cli-output";
import { reconcileManagedPath, renderReconcileReport } from "./reconcile";
import type { ReconcileChoice } from "./reconcile";

export interface RestoreCommandRequest {
  readonly backupId: string | undefined;
  readonly jsonOutput: boolean;
  readonly list: boolean;
  readonly options: SkillsetOptions;
  readonly rootPath: string;
  readonly yes: boolean;
}

export async function runRestoreCommand({
  backupId,
  jsonOutput,
  list,
  options,
  rootPath,
  yes,
}: RestoreCommandRequest): Promise<void> {
  if (list) {
    const report = await inspectOutputBackups(rootPath);
    if (jsonOutput) {
      printCliJsonData("restore", { report, state: "planned", writes: [] });
    } else {
      printOutputBackupInspection(report);
    }
    return;
  }
  if (backupId === undefined) {
    throw new Error("skillset: expected backup id to restore");
  }
  const report = await restoreOutputBackup(rootPath, backupId, {
    write: yes,
  });
  if (jsonOutput) {
    printCliJsonData("restore", {
      report,
      state: report.write ? "written" : "planned",
      writes: report.write ? report.restoredPaths : [],
    });
  } else {
    printRestoreReport(report);
    if (!yes) {
      console.log("skillset: rerun restore with --yes to write restored files");
    }
  }
  return;
}

function printOutputBackupInspection(
  report: Awaited<ReturnType<typeof inspectOutputBackups>>
): void {
  if (report.runs.length === 0) {
    console.log("skillset: no output backups found");
    return;
  }
  console.log(
    `skillset: ${report.runs.length} output backup run${report.runs.length === 1 ? "" : "s"}`
  );
  for (const run of report.runs) {
    console.log(`  ${run.state}: ${run.runId}`);
    console.log(`    manifest: ${run.manifestPath}`);
    if (run.detail !== undefined) {
      console.log(`    detail: ${run.detail}`);
    }
    for (const record of run.records) {
      const metadata = [record.action, record.reason, record.targetPath]
        .filter((value): value is string => value !== undefined)
        .join(" ");
      console.log(`    ${record.state}: ${metadata}`);
      if (record.sourcePath !== undefined) {
        console.log(`      source: ${record.sourcePath}`);
      }
      if (record.detail !== undefined) {
        console.log(`      detail: ${record.detail}`);
      }
    }
    if (run.state === "restorable-now") {
      console.log(`    restore: skillset restore ${run.runId} --yes`);
    }
  }
}

export interface ReconcileCommandRequest {
  readonly managedPath: string | undefined;
  readonly jsonOutput: boolean;
  readonly options: SkillsetOptions;
  readonly reconcileChoice: ReconcileChoice | undefined;
  readonly rootPath: string;
  readonly yes: boolean;
}

export async function runReconcileCommand({
  managedPath,
  jsonOutput,
  options,
  reconcileChoice,
  rootPath,
  yes,
}: ReconcileCommandRequest): Promise<void> {
  if (managedPath === undefined) {
    throw new Error("skillset: expected a managed path to reconcile");
  }
  const report = await reconcileManagedPath(rootPath, managedPath, {
    ...options,
    ...(reconcileChoice === undefined ? {} : { choice: reconcileChoice }),
    write: reconcileChoice !== undefined && yes,
  });
  if (jsonOutput) {
    printCliJsonData("reconcile", {
      report,
      state: report.applied ? "written" : "planned",
      writes: report.writtenPaths,
    });
  } else {
    process.stdout.write(renderReconcileReport(report));
  }
  return;
}

function printRestoreReport(report: OutputBackupRestoreReport): void {
  const mode = report.write ? "restored" : "restore preview";
  console.log(
    `skillset: ${mode} ${report.restoredPaths.length} file${report.restoredPaths.length === 1 ? "" : "s"} from backup ${report.runId}`
  );
  console.log(`  manifest: ${report.manifestPath}`);
  for (const path of report.restoredPaths) {
    console.log(`  restore: ${path}`);
  }
}
