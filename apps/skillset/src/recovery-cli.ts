import { restoreOutputBackup } from "@skillset/core";
import type { OutputBackupRestoreReport } from "@skillset/core";
import type { SkillsetOptions } from "@skillset/core/internal/types";

import { printCliJsonData } from "./cli-output";
import { reconcileManagedPath, renderReconcileReport } from "./reconcile";
import type { ReconcileChoice } from "./reconcile";

export interface RestoreCommandRequest {
  readonly backupId: string | undefined;
  readonly jsonOutput: boolean;
  readonly options: SkillsetOptions;
  readonly rootPath: string;
  readonly yes: boolean;
}

export async function runRestoreCommand({
  backupId,
  jsonOutput,
  options,
  rootPath,
  yes,
}: RestoreCommandRequest): Promise<void> {
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
