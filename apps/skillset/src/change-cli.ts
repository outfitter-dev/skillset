import {
  sourceUnitDisplay,
  sourceUnitDisplays,
} from "@skillset/core/internal/source-unit-selector";
import type { SkillsetOptions } from "@skillset/core/internal/types";

import { changeCheck } from "./change-entries";
import type { ChangeBump, ChangeCheckReport } from "./change-entries";
import { changeStatus } from "./change-status";
import type { ChangeStatusReport } from "./change-status";
import {
  addChangeEntry,
  amendAppliedChange,
  groupRef,
  listChangeEntries,
  migratePendingChangeEntries,
  readChangeHistory,
  showChangeEntry,
  updateChangeReason,
} from "./change-workflow";
import type {
  ChangeEntryView,
  ChangeMigrationReport,
  ChangeReasonInput,
  ChangeSubcommand,
} from "./change-workflow";
import { printCliJsonData } from "./cli-output";
import { printGeneratedChangelogDriftHint } from "./cli-renderers";

export interface ChangeCommandRequest {
  readonly changeAppend: boolean;
  readonly changeBump: ChangeBump | undefined;
  readonly changeGroup: string | undefined;
  readonly changeReason: ChangeReasonInput | undefined;
  readonly changeRef: string | undefined;
  readonly changeScopes: readonly string[] | undefined;
  readonly changeSince: string | undefined;
  readonly changeStaged: boolean;
  readonly changeSubcommand: ChangeSubcommand | undefined;
  readonly jsonOutput: boolean;
  readonly options: SkillsetOptions;
  readonly rootPath: string;
  readonly yes: boolean;
}

export async function runChangeCommand({
  changeAppend,
  changeBump,
  changeGroup,
  changeReason,
  changeRef,
  changeScopes,
  changeSince,
  changeStaged,
  changeSubcommand,
  jsonOutput,
  options,
  rootPath,
  yes,
}: ChangeCommandRequest): Promise<void> {
  const changeOptions = {
    ...options,
    ...(changeSince === undefined ? {} : { since: changeSince }),
  };
  if (changeSubcommand === "status") {
    const report = await changeStatus(rootPath, {
      ...changeOptions,
      ...(changeStaged ? { staged: true } : {}),
    });
    if (jsonOutput) {
      printCliJsonData("change.status", report);
    } else {
      printChangeStatus(report);
    }
    return;
  }
  if (changeSubcommand === "check") {
    const report = await changeCheck(rootPath, {
      ...changeOptions,
      ...(changeRef === undefined ? {} : { ref: changeRef }),
      ...(changeStaged ? { staged: true } : {}),
    });
    if (jsonOutput) {
      printCliJsonData(
        "change.check",
        {
          ...report,
          entries: report.entries.map(serializeChangeEntry),
        },
        report.ok ? 0 : 1,
        report.ok ? "data" : "diagnostics",
        report.issues.map((issue) => ({
          code: issue.code,
          message: issue.message,
          ...(issue.path === undefined ? {} : { path: issue.path }),
          severity: issue.severity,
        }))
      );
    } else {
      printChangeCheck(report);
    }
    return;
  }
  if (changeSubcommand === "add") {
    const report = await addChangeEntry(rootPath, {
      ...changeOptions,
      ...(changeBump === undefined ? {} : { bump: changeBump }),
      ...(changeGroup === undefined ? {} : { group: changeGroup }),
      reason: changeReason ?? { kind: "auto" },
      scopes: changeScopes ?? [],
    });
    if (jsonOutput) {
      printCliJsonData("change.add", {
        report: { ...report, entry: serializeChangeEntry(report.entry) },
        state: "written",
        writes: [report.entry.path, report.ledgerPath],
      });
    } else {
      printChangeEntry("added", report.entry);
    }
    return;
  }
  if (changeSubcommand === "reason") {
    if (changeRef === undefined) {
      throw new Error("skillset: change reason requires @ref");
    }
    const report = await updateChangeReason(rootPath, {
      ...changeOptions,
      append: changeAppend,
      reason: changeReason ?? { kind: "auto" },
      ref: changeRef,
    });
    if (jsonOutput) {
      printCliJsonData("change.reason", {
        report: { ...report, entry: serializeChangeEntry(report.entry) },
        state: "written",
        writes: [
          report.entry.path,
          ...(report.ledgerPath === undefined ? [] : [report.ledgerPath]),
        ],
      });
    } else {
      printChangeEntry("updated", report.entry);
    }
    return;
  }
  if (changeSubcommand === "amend") {
    if (changeRef === undefined) {
      throw new Error("skillset: change amend requires @ref");
    }
    const report = await amendAppliedChange(rootPath, {
      ...changeOptions,
      reason: changeReason ?? { kind: "auto" },
      ref: changeRef,
    });
    if (jsonOutput) {
      printCliJsonData("change.amend", {
        report: { ...report, entry: serializeChangeEntry(report.entry) },
        state: "written",
        writes: [report.path],
      });
    } else {
      printChangeEntry("amended", report.entry);
      console.log(`  amendment: ${report.path}`);
    }
    return;
  }
  if (changeSubcommand === "show") {
    if (changeRef === undefined) {
      throw new Error("skillset: change show requires @ref");
    }
    const report = await showChangeEntry(rootPath, {
      ...changeOptions,
      ref: changeRef,
    });
    if (jsonOutput) {
      printCliJsonData("change.show", {
        ...report,
        entry: serializeChangeEntry(report.entry),
      });
    } else {
      printChangeEntry("show", report.entry);
    }
    return;
  }
  if (changeSubcommand === "list") {
    const report = await listChangeEntries(rootPath, {
      ...changeOptions,
      ...(changeGroup === undefined ? {} : { group: changeGroup }),
    });
    if (jsonOutput) {
      printCliJsonData("change.list", {
        ...report,
        entries: report.entries.map(serializeChangeEntry),
      });
    } else {
      printChangeList(report.entries);
    }
    return;
  }
  if (changeSubcommand === "history") {
    const report = await readChangeHistory(rootPath, {
      ...changeOptions,
      ...(changeRef === undefined ? {} : { ref: changeRef }),
    });
    if (jsonOutput) {
      printCliJsonData("change.history", {
        ...report,
        entries: report.entries.map(serializeChangeEntry),
      });
    } else {
      printChangeHistory(report.entries);
    }
    return;
  }
  if (changeSubcommand === "migrate") {
    const report = await migratePendingChangeEntries(rootPath, {
      ...changeOptions,
      write: yes,
    });
    if (jsonOutput) {
      const writes =
        report.written && report.entries.length > 0
          ? [
              ...new Set([
                ...report.entries.flatMap((entry) =>
                  entry.fromPath === entry.toPath
                    ? [entry.toPath]
                    : [entry.fromPath, entry.toPath]
                ),
                report.ledgerPath,
              ]),
            ].toSorted()
          : [];
      printCliJsonData("change.migrate", {
        report: {
          ...report,
          entries: report.entries.map(serializeChangeEntry),
        },
        state: writes.length > 0 ? "written" : "planned",
        writes,
      });
    } else {
      printChangeMigration(report);
      if (!yes && report.entries.length > 0) {
        console.log(
          "skillset: rerun change migrate with --yes to rewrite pending entries"
        );
      }
    }
    return;
  }
  throw new Error(
    "skillset: expected change subcommand add, amend, check, history, list, migrate, reason, show, or status"
  );
}

function serializeChangeEntry<
  T extends { readonly sourceHashes: ReadonlyMap<string, readonly string[]> },
>(
  entry: T
): Omit<T, "sourceHashes"> & {
  readonly sourceHashes: Readonly<Record<string, readonly string[]>>;
} {
  return {
    ...entry,
    sourceHashes: Object.fromEntries(
      [...entry.sourceHashes].toSorted(([left], [right]) =>
        left.localeCompare(right)
      )
    ),
  };
}

function printChangeEntry(verb: string, entry: ChangeEntryView): void {
  if (verb === "show") {
    console.log(`skillset: change ${entry.ref}`);
  } else {
    console.log(`skillset: ${verb} change ${entry.ref} ${entry.path}`);
  }
  console.log(`  status: ${entry.status}`);
  console.log(`  id: ${entry.id}`);
  if (entry.bump !== undefined) {
    console.log(`  bump: ${entry.bump}`);
  }
  const group = groupRef(entry.group);
  if (group !== undefined) {
    console.log(`  group: ${group}`);
  }
  if (entry.scopes.length > 0) {
    console.log(`  scopes: ${sourceUnitDisplays(entry.scopes)}`);
  }
  for (const [scope, hashes] of entry.sourceHashes) {
    for (const hash of hashes) {
      console.log(`  source hash: ${sourceUnitDisplay(scope)} ${hash}`);
    }
  }
  if (entry.reason.length > 0) {
    console.log("  reason:");
    for (const line of entry.reason.split("\n")) {
      console.log(`    ${line}`);
    }
  }
}

function printChangeList(entries: readonly ChangeEntryView[]): void {
  for (const entry of entries) {
    const group = groupRef(entry.group) ?? "-";
    const bump = entry.bump ?? "-";
    console.log(
      `${entry.ref} ${entry.status} ${bump} ${group} ${sourceUnitDisplays(entry.scopes)} ${entry.path}`
    );
  }
  console.log(
    `skillset: listed ${entries.length} pending change entr${entries.length === 1 ? "y" : "ies"}`
  );
}

function printChangeHistory(entries: readonly ChangeEntryView[]): void {
  for (const entry of entries) {
    printChangeEntry("show", entry);
  }
  console.log(
    `skillset: listed ${entries.length} history entr${entries.length === 1 ? "y" : "ies"}`
  );
}

function printChangeMigration(report: ChangeMigrationReport): void {
  for (const entry of report.entries) {
    const action = report.written ? "migrated" : "would migrate";
    console.log(`${action}: ${entry.fromPath} -> ${entry.toPath}`);
  }
  if (report.written && report.entries.length > 0) {
    console.log(`  ledger: ${report.ledgerPath}`);
  }
  console.log(
    `skillset: ${report.written ? "migrated" : "previewed"} ${report.entries.length} frontmatter pending entr${report.entries.length === 1 ? "y" : "ies"}`
  );
}

function printChangeCheck(report: ChangeCheckReport): void {
  for (const issue of report.issues) {
    const path = issue.path === undefined ? "" : `${issue.path}: `;
    console.log(`  ${issue.severity}: ${path}${issue.code}: ${issue.message}`);
  }
  for (const group of report.stackedEvidence) {
    console.log(
      `  stacked evidence: ${sourceUnitDisplay(group.scope)} ${group.sourceHash} shared by ${group.paths.length} pending entries: ${group.paths.join(", ")}`
    );
  }
  const errors = report.issues.filter(
    (issue) => issue.severity === "error"
  ).length;
  const warnings = report.issues.length - errors;
  if (errors === 0) {
    console.log(
      `skillset: change check passed (${report.entries.length} pending entr${report.entries.length === 1 ? "y" : "ies"}, ${warnings} warning${warnings === 1 ? "" : "s"})`
    );
    return;
  }
  console.log(
    `skillset: change check found ${errors} error${errors === 1 ? "" : "s"} and ${warnings} warning${warnings === 1 ? "" : "s"}`
  );
  process.exitCode = 1;
}

function printChangeStatus(report: ChangeStatusReport): void {
  const baseline =
    report.baseline.kind === "git-ref"
      ? `git ref ${report.baseline.ref}${report.baseline.resolvedRef === undefined ? "" : ` (${report.baseline.resolvedRef.slice(0, 12)})`}`
      : `${report.baseline.label} (${report.baseline.hashSchema})`;
  console.log(`skillset: source hash schema ${report.hashSchema}`);
  console.log(`skillset: baseline ${baseline}`);

  if (report.sourceChanges.length === 0) {
    console.log("skillset: no source changes needing entries");
  } else {
    for (const change of report.sourceChanges) {
      const marker =
        change.status === "added"
          ? "+"
          : change.status === "removed"
            ? "-"
            : "~";
      console.log(
        `  ${marker} ${sourceUnitDisplay(change.id)} ${change.sourcePath}`
      );
    }
    console.log(
      `skillset: ${report.sourceChanges.length} source change(s) needing entries`
    );
  }

  const drift = report.generatedDrift;
  const driftCount =
    drift.added.length +
    drift.changed.length +
    drift.missing.length +
    drift.removed.length;
  if (driftCount === 0) {
    console.log("skillset: no generated-output drift");
    return;
  }
  for (const path of drift.added) {
    console.log(`  generated + ${path}`);
  }
  for (const path of drift.changed) {
    console.log(`  generated ~ ${path}`);
  }
  for (const path of drift.missing) {
    console.log(`  generated ! ${path}`);
  }
  for (const path of drift.removed) {
    console.log(`  generated - ${path}`);
  }
  console.log(
    `skillset: generated-output drift ${drift.added.length} added, ${drift.changed.length} changed, ${drift.missing.length} missing, ${drift.removed.length} removed`
  );
  printGeneratedChangelogDriftHint(drift);
}
