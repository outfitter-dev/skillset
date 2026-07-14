import { auditVersions } from "@skillset/core";
import type { VersionAuditReport } from "@skillset/core";
import {
  sourceUnitDisplay,
  sourceUnitDisplays,
} from "@skillset/core/internal/source-unit-selector";
import type { SkillsetOptions } from "@skillset/core/internal/types";

import type { ChangeReasonInput } from "./change-workflow";
import { printCliJsonData } from "./cli-output";
import { amendReleaseRecord, applyRelease, planRelease } from "./release";
import type {
  ReleaseAmendReport,
  ReleasePlanReport,
  ReleaseSubcommand,
} from "./release";

export interface ReleaseCommandRequest {
  readonly jsonOutput: boolean;
  readonly options: SkillsetOptions;
  readonly releaseReason: ChangeReasonInput | undefined;
  readonly releaseRef: string | undefined;
  readonly releaseSubcommand: ReleaseSubcommand | undefined;
  readonly rootPath: string;
  readonly yes: boolean;
}

export async function runReleaseCommand({
  jsonOutput,
  options,
  releaseReason,
  releaseRef,
  releaseSubcommand,
  rootPath,
  yes,
}: ReleaseCommandRequest): Promise<void> {
  if (releaseSubcommand === "audit") {
    const report = await auditVersions(rootPath, options);
    if (jsonOutput) {
      printCliJsonData(
        "release.audit",
        report,
        report.issues.length > 0 ? 1 : 0
      );
    } else {
      printVersionAudit(report);
      if (report.issues.length > 0) {
        process.exitCode = 1;
      }
    }
    return;
  }
  if (releaseSubcommand === "plan") {
    const report = await planRelease(rootPath, options);
    if (jsonOutput) {
      printCliJsonData("release.plan", report);
    } else {
      printReleasePlan(report);
    }
    return;
  }
  if (releaseSubcommand === "apply") {
    if (!yes) {
      const plan = await planRelease(rootPath, options);
      if (jsonOutput) {
        printCliJsonData("release.apply", {
          plan,
          state: "planned",
          writes: [],
        });
        return;
      }
      printReleasePlan(plan);
      console.log(
        "skillset: rerun release apply with --yes to write release state"
      );
      return;
    }
    const result = await applyRelease(rootPath, options);
    if (jsonOutput) {
      printCliJsonData("release.apply", {
        result,
        state: result.files.length > 0 ? "written" : "planned",
        writes: result.files,
      });
    } else {
      printReleaseApply(result.plan, result.files, result.renderedFiles);
    }
    return;
  }
  if (releaseSubcommand === "amend") {
    if (releaseRef === undefined) {
      throw new Error("skillset: release amend requires @ref");
    }
    const report = await amendReleaseRecord(rootPath, {
      ...options,
      reason: releaseReason ?? { kind: "auto" },
      ref: releaseRef,
    });
    if (jsonOutput) {
      printCliJsonData("release.amend", {
        report,
        state: "written",
        writes: [report.amendmentPath],
      });
    } else {
      printReleaseAmend(report);
    }
    return;
  }
  throw new Error(
    "skillset: expected release subcommand amend, apply, audit, or plan"
  );
}

function printReleasePlan(report: ReleasePlanReport): void {
  if (report.entries.length === 0) {
    console.log("skillset: no pending changes to release");
    return;
  }
  for (const entry of report.entries) {
    const marker = entry.ignored ? "ignored" : "pending";
    console.log(
      `${entry.ref} ${marker} ${entry.bump} ${sourceUnitDisplays(entry.scopes)} ${entry.path}`
    );
  }
  if (report.scopes.length === 0) {
    console.log(
      `skillset: release plan has ${report.entries.length} pending entr${report.entries.length === 1 ? "y" : "ies"} and no release scopes`
    );
    return;
  }
  if (report.releaseId !== undefined) {
    console.log(`skillset: release ${report.releaseId}`);
  }
  for (const scope of report.scopes) {
    const sourceHash =
      scope.sourceHash === undefined ? "" : ` ${scope.sourceHash}`;
    console.log(
      `  ${sourceUnitDisplay(scope.scope)}: ${scope.currentVersion} -> ${scope.nextVersion} (${scope.bump}) entries ${scope.entries.join(",")}${sourceHash}`
    );
  }
  console.log(
    `skillset: release plan has ${report.entries.length} pending entr${report.entries.length === 1 ? "y" : "ies"} and ${report.scopes.length} release scope${report.scopes.length === 1 ? "" : "s"}`
  );
}

function printVersionAudit(report: VersionAuditReport): void {
  for (const locus of report.loci) {
    const target = locus.target === undefined ? "" : ` [${locus.target}]`;
    const actual = locus.actualVersion ?? "missing";
    const expected = locus.expectedVersion ?? "n/a";
    console.log(
      `${locus.status}:${target} ${locus.scope} ${locus.path} ${locus.field} actual ${actual} expected ${expected} authority ${locus.authority}`
    );
  }
  if (report.issues.length === 0) {
    console.log(`skillset: version audit passed (${report.loci.length} loci)`);
  } else {
    console.log(
      `skillset: version audit found ${report.issues.length} issue${report.issues.length === 1 ? "" : "s"} across ${report.loci.length} loci`
    );
  }
}

function printReleaseApply(
  plan: ReleasePlanReport,
  files: readonly string[],
  renderedFiles: number
): void {
  if (plan.entries.length === 0) {
    console.log("skillset: no pending changes to release");
    return;
  }
  console.log(
    `skillset: applied release ${plan.releaseId ?? "audit-only"} (${renderedFiles} generated files refreshed)`
  );
  for (const file of files) {
    console.log(`  ${file}`);
  }
}

function printReleaseAmend(report: ReleaseAmendReport): void {
  console.log(
    `skillset: amended release ${report.release.ref} ${report.release.path}`
  );
  console.log(`  id: ${report.release.id}`);
  console.log(`  amendment: ${report.amendmentPath}`);
  if (report.release.appliedAt !== undefined) {
    console.log(`  applied: ${report.release.appliedAt}`);
  }
  if (report.release.entries.length > 0) {
    console.log(`  entries: ${report.release.entries.join(",")}`);
  }
  for (const scope of report.release.scopes) {
    const version =
      scope.previousVersion === undefined || scope.nextVersion === undefined
        ? ""
        : ` ${scope.previousVersion} -> ${scope.nextVersion}`;
    const bump = scope.bump === undefined ? "" : ` (${scope.bump})`;
    console.log(`  scope: ${sourceUnitDisplay(scope.scope)}${version}${bump}`);
  }
  if (report.release.notes !== undefined) {
    console.log("  notes:");
    for (const line of report.release.notes.split("\n")) {
      console.log(`    ${line}`);
    }
  }
}
