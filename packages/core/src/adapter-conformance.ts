import {
  getSkillsetFeature,
  skillsetFeatureRegistry,
  type SkillsetFeatureRegistry,
  type SkillsetTargetSupportStatus,
} from "./feature-registry";
import type { SkillsetLoweringOutcome, SkillsetLoweringOutcomeStatus } from "./lowering-outcome";
import { compareStrings } from "./path";
import type { TargetName } from "./types";

export type AdapterConformanceIssueCode =
  | "feature-not-found"
  | "missing-outcome"
  | "missing-outcome-evidence"
  | "missing-outcome-reason"
  | "reason-mismatch"
  | "status-mismatch"
  | "support-not-applicable"
  | "support-reason-missing";

export interface AdapterConformanceCase {
  readonly featureId: string;
  readonly fixtureRef?: string;
  readonly sourceUnit?: string;
  readonly target: TargetName;
}

export interface AdapterConformanceIssue {
  readonly code: AdapterConformanceIssueCode;
  readonly expected?: readonly string[];
  readonly featureId: string;
  readonly message: string;
  readonly observed?: readonly string[];
  readonly sourceUnit?: string;
  readonly target: TargetName;
}

export interface AdapterConformanceReport {
  readonly issues: readonly AdapterConformanceIssue[];
  readonly ok: boolean;
}

export function checkAdapterConformance(
  outcomes: readonly SkillsetLoweringOutcome[],
  cases: readonly AdapterConformanceCase[],
  registry: SkillsetFeatureRegistry = skillsetFeatureRegistry
): AdapterConformanceReport {
  const issues = cases.flatMap((item) => checkConformanceCase(outcomes, item, registry));
  return {
    issues: issues.sort(compareIssues),
    ok: issues.length === 0,
  };
}

export function assertAdapterConformance(
  outcomes: readonly SkillsetLoweringOutcome[],
  cases: readonly AdapterConformanceCase[],
  registry: SkillsetFeatureRegistry = skillsetFeatureRegistry
): void {
  const report = checkAdapterConformance(outcomes, cases, registry);
  if (report.ok) return;
  throw new Error(formatAdapterConformanceReport(report));
}

export function formatAdapterConformanceReport(report: AdapterConformanceReport): string {
  return [
    `skillset: adapter conformance failed with ${report.issues.length} ${report.issues.length === 1 ? "issue" : "issues"}`,
    ...report.issues.map((issue) => `- ${issue.featureId} ${issue.target}: ${issue.message}`),
  ].join("\n");
}

function checkConformanceCase(
  outcomes: readonly SkillsetLoweringOutcome[],
  item: AdapterConformanceCase,
  registry: SkillsetFeatureRegistry
): readonly AdapterConformanceIssue[] {
  const feature = getSkillsetFeature(item.featureId, registry);
  if (feature === undefined) {
    return [issue(item, "feature-not-found", `feature registry id ${item.featureId} does not exist`)];
  }
  const support = feature.targetSupport[item.target];
  const expectedStatuses = expectedOutcomeStatuses(support.status);
  if (expectedStatuses.length === 0) {
    return [
      issue(
        item,
        "support-not-applicable",
        `${item.target} support status ${support.status} does not lower into adapter outcomes`
      ),
    ];
  }

  const matching = outcomes.filter((outcome) =>
    outcome.featureId === item.featureId &&
    outcome.target === item.target &&
    (item.sourceUnit === undefined || outcome.sourceUnit === item.sourceUnit)
  );
  if (matching.length === 0) {
    return [
      issue(item, "missing-outcome", `${item.target} ${support.status} support has no matching lowering outcome`, {
        expected: expectedStatuses,
      }),
    ];
  }

  const observedStatuses = sortedUnique(matching.map((outcome) => outcome.status));
  const conforming = matching.filter((outcome) =>
    expectedStatuses.includes(outcome.status)
  );
  const unexpectedStatuses = observedStatuses.filter((status) => !expectedStatuses.includes(status as SkillsetLoweringOutcomeStatus));
  if (conforming.length === 0 || unexpectedStatuses.length > 0) {
    return [
      issue(
        item,
        "status-mismatch",
        `${item.target} ${support.status} support lowered with ${observedStatuses.join(", ")}`,
        { expected: expectedStatuses, observed: observedStatuses }
      ),
    ];
  }

  const issues: AdapterConformanceIssue[] = [];
  for (const outcome of conforming) {
    if ((outcome.evidence?.length ?? 0) === 0) {
      issues.push(issue(item, "missing-outcome-evidence", `${outcome.sourceUnit} has no lowering evidence`));
    }
    if (reasonRequired(support.status)) {
      if (support.reason === undefined) {
        issues.push(issue(item, "support-reason-missing", `${support.status} support has no registry reason`));
      }
      if (outcome.reason === undefined) {
        issues.push(issue(item, "missing-outcome-reason", `${outcome.sourceUnit} has no lowering reason`));
      }
      if (support.reason !== undefined && outcome.reason !== undefined && support.reason !== outcome.reason) {
        issues.push(issue(item, "reason-mismatch", `${outcome.sourceUnit} reason does not match registry support reason`));
      }
    }
  }
  return issues;
}

function expectedOutcomeStatuses(
  status: SkillsetTargetSupportStatus
): readonly SkillsetLoweringOutcomeStatus[] {
  switch (status) {
    case "degraded":
      return ["degraded"];
    case "externally_managed":
      return ["externally_managed"];
    case "lossy":
      return ["lossy"];
    case "metadata_only":
      return ["metadata_only"];
    case "native":
      return ["emitted", "target_native"];
    case "pass_through":
      return ["target_native"];
    case "shimmed":
      return ["degraded", "transformed"];
    case "transformed":
      return ["transformed"];
    case "unsupported":
      return ["unsupported"];
    case "future":
    case "not_applicable":
    case "planned":
      return [];
  }
}

function reasonRequired(status: SkillsetTargetSupportStatus): boolean {
  return status === "degraded" || status === "lossy" || status === "unsupported";
}

function issue(
  item: AdapterConformanceCase,
  code: AdapterConformanceIssueCode,
  message: string,
  options: {
    readonly expected?: readonly string[];
    readonly observed?: readonly string[];
  } = {}
): AdapterConformanceIssue {
  return {
    code,
    ...(options.expected === undefined ? {} : { expected: options.expected }),
    featureId: item.featureId,
    message,
    ...(options.observed === undefined ? {} : { observed: options.observed }),
    ...(item.sourceUnit === undefined ? {} : { sourceUnit: item.sourceUnit }),
    target: item.target,
  };
}

function sortedUnique(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort(compareStrings);
}

function compareIssues(left: AdapterConformanceIssue, right: AdapterConformanceIssue): number {
  return compareStrings(
    `${left.featureId}\0${left.target}\0${left.sourceUnit ?? ""}\0${left.code}`,
    `${right.featureId}\0${right.target}\0${right.sourceUnit ?? ""}\0${right.code}`
  );
}
