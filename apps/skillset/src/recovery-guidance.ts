import type { SkillsetDiagnostic, SkillsetDiff } from "@skillset/core";
import type { SourceSuggestionReport } from "@skillset/core/internal/authoring";
import { compareStrings } from "@skillset/core/internal/path";

import type { ChangeCheckIssue, ChangeCheckReport, ChangeCheckSeverity, PendingChangeEntry } from "./change-entries";
import type { LintIssue } from "@skillset/core/internal/types";
import type { ProviderFormatUpdateReport } from "./provider-format-updates";

export const RECOVERY_ACTIONS = [
  "change-add",
  "change-refresh",
  "change-migrate",
  "reconcile",
  "update",
  "rebuild-generated-output",
  "manual-review",
] as const;

export type RecoveryAction = (typeof RECOVERY_ACTIONS)[number];

export interface RecoveryGuidance {
  readonly action: RecoveryAction;
  readonly blocked?: boolean;
  readonly commands: readonly string[];
  readonly path?: string;
  readonly reason: string;
  readonly ref?: string;
  readonly scope?: string;
}

export interface MechanicalFixEligibility {
  readonly blockers: readonly string[];
  readonly eligible: boolean;
}

export interface RecoveryGuidanceInput {
  readonly buildError?: string;
  readonly changeError?: string;
  readonly changeReport?: ChangeCheckReport;
  readonly changesetError?: string;
  readonly changesetIssues: readonly string[];
  readonly drift: SkillsetDiff;
  readonly lintIssues: readonly LintIssue[];
  readonly mode: "ci" | "local";
  readonly outputDiagnostics: readonly SkillsetDiagnostic[];
  readonly outputEditedPaths: readonly string[];
  readonly providerAnalysisError?: string;
  readonly providerReport?: ProviderFormatUpdateReport;
  readonly providerUpdatePaths: readonly string[];
  readonly sourceSuggestions: readonly SourceSuggestionReport[];
  readonly unmanagedOutputCollisions: boolean;
}

export function mechanicalFixEligibility(input: RecoveryGuidanceInput): MechanicalFixEligibility {
  const blockers: string[] = [];
  if (input.buildError !== undefined) blockers.push("build error");
  if (input.changeError !== undefined) blockers.push("change check error");
  if (input.changesetError !== undefined) blockers.push("Changesets check error");
  if (input.changesetIssues.length > 0) blockers.push("Changesets issues");
  if (input.lintIssues.some((issue) => issue.severity === "error")) blockers.push("lint errors");
  if (input.changeReport?.issues.some((issue) => issue.severity === "error") === true) blockers.push("change entry errors");
  if (input.outputDiagnostics.some((diagnostic) => diagnostic.severity === "error")) blockers.push("generated-output diagnostics");
  if (input.outputEditedPaths.length > 0) blockers.push("target-side generated edits");
  if (input.unmanagedOutputCollisions) blockers.push("unmanaged output collisions");
  if (input.providerAnalysisError !== undefined) blockers.push("provider-format analysis unavailable");
  if (input.providerUpdatePaths.length > 0) {
    blockers.push("provider-format migration or unplanned drift");
  }
  return { blockers: blockers.toSorted(), eligible: hasDrift(input.drift) && blockers.length === 0 };
}

export function classifyRecoveryGuidance(input: RecoveryGuidanceInput): readonly RecoveryGuidance[] {
  const guidance: RecoveryGuidance[] = [];
  const baselineRef = input.changeReport?.status.baseline.kind === "git-ref"
    ? input.changeReport.status.baseline.ref
    : undefined;

  if (input.changeReport !== undefined) {
    guidance.push(...classifyChangeRecovery(input.changeReport, baselineRef));
  }
  const suggestions = new Map(input.sourceSuggestions.map((suggestion) => [suggestion.generatedPath, suggestion]));
  for (const path of input.outputEditedPaths.toSorted()) {
    const suggestion = suggestions.get(path);
    if (suggestion?.status === "suggestible") {
      guidance.push({
        action: "reconcile",
        commands: [`skillset reconcile ${quoteShellArgument(path)}`],
        path,
        reason: "managed generated output differs from its recorded generated state; preview reconciliation before choosing source or output authority",
      });
    } else {
      guidance.push({
        action: "manual-review",
        blocked: true,
        commands: [],
        path,
        reason: suggestion?.message ?? "reconciliation could not prove a safe recovery for this target-side edit",
      });
    }
  }
  if (input.providerAnalysisError !== undefined) {
    guidance.push({
      action: "manual-review",
      blocked: true,
      commands: [],
      reason: "provider-format analysis was unavailable, so no generated-output repair can be classified safely",
    });
  } else if (input.providerReport !== undefined) {
    guidance.push(...classifyProviderRecovery(
      input.providerReport,
      new Set(input.outputEditedPaths),
      new Set(input.providerUpdatePaths)
    ));
  }

  const fix = mechanicalFixEligibility(input);
  if (hasDrift(input.drift)) {
    if (fix.eligible) {
      const command = input.mode === "ci"
        ? `skillset check --ci --fix${baselineRef === undefined ? "" : ` --since ${quoteShellArgument(baselineRef)}`}`
        : "skillset check --write";
      guidance.push({
        action: "rebuild-generated-output",
        commands: [command],
        reason: "generated output is the sole blocking condition and can be rebuilt from current source",
      });
    } else {
      guidance.push({
        action: "manual-review",
        blocked: true,
        commands: [],
        reason: `generated output cannot be rebuilt mechanically until other blockers are resolved: ${fix.blockers.join(", ")}`,
      });
    }
  }
  return dedupeGuidance(guidance);
}

function classifyChangeRecovery(
  report: ChangeCheckReport,
  baselineRef: string | undefined
): readonly RecoveryGuidance[] {
  const guidance: RecoveryGuidance[] = [];
  const issuesByRef = new Map<string, ChangeCheckIssue[]>();
  for (const issue of report.issues) {
    if (issue.ref === undefined) continue;
    const issues = issuesByRef.get(issue.ref) ?? [];
    issues.push(issue);
    issuesByRef.set(issue.ref, issues);
  }
  for (const issue of report.issues) {
    if (issue.code !== "change-uncovered" || issue.scope === undefined) continue;
    const command = [
      "skillset change add",
      `--scope ${quoteShellArgument(issue.scope)}`,
      "--bump <major|minor|patch|none>",
      '--reason "<reason>"',
      ...(baselineRef === undefined ? [] : [`--since ${quoteShellArgument(baselineRef)}`]),
    ].join(" ");
    guidance.push({
      action: "change-add",
      commands: [command],
      reason: "source change has no pending change entry; choose the release impact and reason before recording it",
      scope: issue.scope,
    });
  }
  for (const entry of report.entries) {
    const ref = entry.id === undefined ? undefined : `@${entry.id}`;
    if (ref === undefined) continue;
    const entryIssues = issuesByRef.get(ref) ?? [];
    const evidenceIssues = entryIssues.filter((issue) =>
      issue.code === "change-evidence-missing" || issue.code === "change-evidence-stale"
    );
    const nonRefreshErrors = entryIssues.filter((issue) =>
      issue.severity === "error" && issue.code !== "change-evidence-missing" && issue.code !== "change-evidence-stale"
    );
    if (evidenceIssues.length > 0 && entry.format === "reason" && nonRefreshErrors.length === 0) {
      const command = [
        "skillset change refresh",
        quoteShellArgument(ref),
        ...(baselineRef === undefined ? [] : [`--since ${quoteShellArgument(baselineRef)}`]),
      ].join(" ");
      guidance.push({
        action: "change-refresh",
        commands: [command, `${command} --yes`],
        path: entry.path,
        reason: "pending change evidence is stale or missing; refresh previews the exact ledger evidence before append",
        ref,
      });
    }
  }
  const legacyEntries = report.entries.filter((entry) => entry.format === "frontmatter");
  if (legacyEntries.length > 0) {
    const confirmationSafe = legacyEntries.every((entry) => isLegacyMigrationSafe(entry, issuesByRef));
    for (const entry of legacyEntries.toSorted((left, right) => compareStrings(left.path, right.path))) {
      guidance.push({
        action: "change-migrate",
        ...(confirmationSafe ? {} : { blocked: true }),
        commands: confirmationSafe
          ? ["skillset change migrate", "skillset change migrate --yes"]
          : [],
        path: entry.path,
        ...(entry.id === undefined ? {} : { ref: `@${entry.id}` }),
        reason: confirmationSafe
          ? "legacy frontmatter pending entries are otherwise valid and can be previewed before migration"
          : "legacy frontmatter pending entries need migration, but other entry errors prevent the workspace-wide migration preview from succeeding",
      });
    }
  }
  return guidance;
}

function isLegacyMigrationSafe(
  entry: PendingChangeEntry,
  issuesByRef: ReadonlyMap<string, readonly { readonly severity: ChangeCheckSeverity }[]>
): boolean {
  if (entry.id === undefined) return false;
  return !(issuesByRef.get(`@${entry.id}`) ?? []).some((issue) => issue.severity === "error");
}

function classifyProviderRecovery(
  report: ProviderFormatUpdateReport,
  targetEditedPaths: ReadonlySet<string>,
  providerUpdatePaths: ReadonlySet<string>
): readonly RecoveryGuidance[] {
  const guidance: RecoveryGuidance[] = [];
  for (const action of report.safeUpdates) {
    const overlapsTargetEdit = action.affectedPaths.some((path) => targetEditedPaths.has(path));
    for (const path of action.affectedPaths.toSorted()) {
      if (!providerUpdatePaths.has(path)) continue;
      if (!report.blocked && !overlapsTargetEdit) {
        guidance.push({
          action: "update",
          commands: ["skillset update", "skillset update --yes"],
          path,
          reason: `${action.provider} ${action.surface} has a registered source-preserving provider-format update (${action.id})`,
          scope: action.sourceUnit,
        });
      } else if (!targetEditedPaths.has(path)) {
        guidance.push({
          action: "manual-review",
          blocked: true,
          commands: [],
          path,
          reason: `${action.provider} ${action.surface} has a safe update that cannot be applied until other provider or target-edit blockers are resolved`,
          scope: action.sourceUnit,
        });
      }
    }
  }
  for (const action of report.manualReviews) {
    for (const path of action.affectedPaths.toSorted()) {
      if (!providerUpdatePaths.has(path)) continue;
      if (targetEditedPaths.has(path)) continue;
      guidance.push({
        action: "manual-review",
        blocked: true,
        commands: [],
        path,
        reason: `${action.provider} ${action.surface} requires manual provider-format review: ${action.description}`,
        scope: action.sourceUnit,
      });
    }
  }
  for (const path of report.unplannedDriftPaths) {
    if (!providerUpdatePaths.has(path)) continue;
    if (targetEditedPaths.has(path)) continue;
    guidance.push({
      action: "manual-review",
      blocked: true,
      commands: [],
      path,
      reason: "generated destination drift has no registered safe provider-format update",
    });
  }
  return guidance;
}

function hasDrift(drift: SkillsetDiff): boolean {
  return drift.added.length > 0 || drift.changed.length > 0 || drift.missing.length > 0 || drift.removed.length > 0;
}

export function quoteShellArgument(value: string): string {
  if (/^[%+,./:=@A-Z_a-z0-9-]+$/.test(value)) return value;
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function dedupeGuidance(guidance: readonly RecoveryGuidance[]): readonly RecoveryGuidance[] {
  const unique = new Map<string, RecoveryGuidance>();
  for (const item of guidance) {
    const key = [item.action, item.path ?? "", item.ref ?? "", item.scope ?? "", item.reason].join("\0");
    if (!unique.has(key)) unique.set(key, item);
  }
  return [...unique.values()].toSorted((left, right) =>
    compareStrings(
      [left.action, left.path ?? "", left.ref ?? "", left.scope ?? "", left.reason].join("\0"),
      [right.action, right.path ?? "", right.ref ?? "", right.scope ?? "", right.reason].join("\0")
    )
  );
}
