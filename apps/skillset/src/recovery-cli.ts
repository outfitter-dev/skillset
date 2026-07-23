import { inspectOutputBackups, restoreOutputBackup } from "@skillset/core";
import type { OutputBackupRestoreReport } from "@skillset/core";
import type { SkillsetOptions } from "@skillset/core/internal/types";

import { printCliJsonData } from "./cli-output";
import {
  confirmProceed,
  createInteractiveSession,
  type InteractiveSession,
} from "./interactive-session";
import { reconcileManagedPath, renderReconcileReport } from "./reconcile";
import type { ReconcileChoice } from "./reconcile";
import {
  reconcileChoiceAvailable,
  reconcileDirectionChoices,
} from "./reconcile-interactive";

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

export interface ReconcileCommandContext {
  readonly interactiveSession?: InteractiveSession;
  readonly reconcile?: typeof reconcileManagedPath;
  readonly write?: (value: string) => void;
}

export async function runReconcileCommand(
  request: ReconcileCommandRequest,
  context: ReconcileCommandContext = {}
): Promise<void> {
  const interactiveSession =
    context.interactiveSession ??
    createInteractiveSession({ machineMode: request.jsonOutput });
  if (
    interactiveSession !== undefined &&
    !request.yes &&
    !request.jsonOutput
  ) {
    return runInteractiveReconcile(request, interactiveSession, context);
  }
  return runExplicitReconcile(request, context);
}

async function runExplicitReconcile(
  {
    managedPath,
    jsonOutput,
    options,
    reconcileChoice,
    rootPath,
    yes,
  }: ReconcileCommandRequest,
  context: ReconcileCommandContext
): Promise<void> {
  if (managedPath === undefined) {
    throw new Error("skillset: expected a managed path to reconcile");
  }
  const report = await (context.reconcile ?? reconcileManagedPath)(
    rootPath,
    managedPath,
    {
      ...options,
      ...(reconcileChoice === undefined ? {} : { choice: reconcileChoice }),
      write: reconcileChoice !== undefined && yes,
    }
  );
  if (jsonOutput) {
    printCliJsonData("reconcile", {
      report,
      state: report.applied ? "written" : "planned",
      writes: report.writtenPaths,
    });
  } else {
    (context.write ?? process.stdout.write.bind(process.stdout))(
      renderReconcileReport(report)
    );
  }
  return;
}

async function runInteractiveReconcile(
  request: ReconcileCommandRequest,
  session: InteractiveSession,
  context: ReconcileCommandContext
): Promise<void> {
  const reconcile = context.reconcile ?? reconcileManagedPath;
  const write = context.write ?? process.stdout.write.bind(process.stdout);
  session.banner();
  const managedPath =
    request.managedPath ??
    (await session.prompts.input({ message: "Managed path:" }));
  const preview = await reconcile(request.rootPath, managedPath, {
    ...request.options,
    write: false,
  });
  write(renderReconcileReport(preview));
  const choices = reconcileDirectionChoices(preview);
  const selected =
    request.reconcileChoice ??
    (choices.some((choice) => choice.disabled === undefined)
      ? await session.prompts.select({
          choices,
          message: "Resolution:",
        })
      : undefined);
  if (
    selected === undefined ||
    !reconcileChoiceAvailable(preview, selected)
  ) {
    return;
  }
  const selectedPreview = await reconcile(request.rootPath, managedPath, {
    ...request.options,
    choice: selected,
    write: false,
  });
  write(renderReconcileReport(selectedPreview));
  if (
    !reconcileChoiceAvailable(selectedPreview, selected) ||
    !(await confirmProceed(session))
  ) {
    return;
  }
  const applied = await reconcile(request.rootPath, managedPath, {
    ...request.options,
    choice: selected,
    write: true,
  });
  write(renderReconcileReport(applied));
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
