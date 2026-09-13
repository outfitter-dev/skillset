import {
  listStandardProfiles,
  type StandardProfile,
  type StandardProfileId,
} from "@skillset/registry";

import {
  getSkillsetFeature,
  skillsetFeatureRegistry,
  type SkillsetFeatureRegistry,
  type SkillsetTargetSupportStatus,
} from "./feature-registry";
import type { SkillsetRenderResult, SkillsetRenderResultStatus } from "./render-result";
import { compareStrings } from "./path";
import type { TargetName } from "./types";

export type AdapterConformanceIssueCode =
  | "feature-not-found"
  | "missing-outcome"
  | "missing-outcome-evidence"
  | "missing-outcome-reason"
  | "reason-mismatch"
  | "standard-profile-evidence-mismatch"
  | "standard-profile-not-adopted"
  | "status-mismatch"
  | "support-not-applicable"
  | "support-reason-missing";

interface AdapterConformanceCaseBase {
  readonly featureId: string;
  readonly fixtureRef?: string;
  readonly sourceUnit?: string;
}

export type AdapterConformanceIdentity =
  | { readonly standardProfile: StandardProfileId }
  | { readonly target: TargetName };

export type AdapterConformanceCase = AdapterConformanceCaseBase &
  AdapterConformanceIdentity;

interface AdapterConformanceIssueBase {
  readonly code: AdapterConformanceIssueCode;
  readonly expected?: readonly string[];
  readonly featureId: string;
  readonly message: string;
  readonly observed?: readonly string[];
  readonly sourceUnit?: string;
}

export type AdapterConformanceIssue = AdapterConformanceIssueBase &
  AdapterConformanceIdentity;

export interface AdapterConformanceReport {
  readonly issues: readonly AdapterConformanceIssue[];
  readonly ok: boolean;
}

export function checkAdapterConformance(
  outcomes: readonly SkillsetRenderResult[],
  cases: readonly AdapterConformanceCase[],
  registry: SkillsetFeatureRegistry = skillsetFeatureRegistry,
  profiles: readonly StandardProfile[] = listStandardProfiles()
): AdapterConformanceReport {
  const issues = cases.flatMap((item) =>
    checkConformanceCase(outcomes, item, registry, profiles)
  );
  return {
    issues: issues.sort(compareIssues),
    ok: issues.length === 0,
  };
}

export function assertAdapterConformance(
  outcomes: readonly SkillsetRenderResult[],
  cases: readonly AdapterConformanceCase[],
  registry: SkillsetFeatureRegistry = skillsetFeatureRegistry,
  profiles: readonly StandardProfile[] = listStandardProfiles()
): void {
  const report = checkAdapterConformance(outcomes, cases, registry, profiles);
  if (report.ok) return;
  throw new Error(formatAdapterConformanceReport(report));
}

export function formatAdapterConformanceReport(report: AdapterConformanceReport): string {
  return [
    `skillset: adapter conformance failed with ${report.issues.length} ${report.issues.length === 1 ? "issue" : "issues"}`,
    ...report.issues.map(
      (issue) =>
        `- ${issue.featureId} ${adapterConformanceIdentityLabel(issue)}: ${issue.message}`
    ),
  ].join("\n");
}

function checkConformanceCase(
  outcomes: readonly SkillsetRenderResult[],
  item: AdapterConformanceCase,
  registry: SkillsetFeatureRegistry,
  profiles: readonly StandardProfile[]
): readonly AdapterConformanceIssue[] {
  const feature = getSkillsetFeature(item.featureId, registry);
  if (feature === undefined) {
    return [issue(item, "feature-not-found", `feature registry id ${item.featureId} does not exist`)];
  }
  const standardProfile =
    "standardProfile" in item
      ? profiles.find((profile) => profile.id === item.standardProfile)
      : undefined;
  if ("standardProfile" in item && standardProfile?.lifecycle !== "adopted") {
    return [
      issue(
        item,
        "standard-profile-not-adopted",
        `standard profile ${item.standardProfile} is ${standardProfile?.lifecycle ?? "missing"}; normal conformance requires adopted registry evidence`
      ),
    ];
  }
  const standardEnvelope =
    "standardProfile" in item
      ? standardProfile?.envelopes.find(
          (envelope) => envelope.featureId === item.featureId
        )
      : undefined;
  const providerSupport =
    "target" in item ? feature.targetSupport[item.target] : undefined;
  const supportStatus =
    standardEnvelope?.expectation ?? providerSupport?.status ?? "unsupported";
  const supportReason =
    "standardProfile" in item
      ? (standardEnvelope?.note ??
        `${item.standardProfile} does not declare ${item.featureId} in its support envelope`)
      : providerSupport?.reason;
  const expectedStatuses =
    "standardProfile" in item
      ? standardExpectedOutcomeStatuses(
          standardEnvelope?.expectation ?? "unsupported"
        )
      : expectedOutcomeStatuses(providerSupport?.status ?? "not_applicable");
  if (expectedStatuses.length === 0) {
    return [
      issue(
        item,
        "support-not-applicable",
        `${adapterConformanceIdentityLabel(item)} support status ${supportStatus} does not render into conformance outcomes`
      ),
    ];
  }

  const matching = outcomes.filter((outcome) =>
    outcome.featureId === item.featureId &&
    matchesIdentity(outcome, item) &&
    (item.sourceUnit === undefined || outcome.sourceUnit === item.sourceUnit)
  );
  if (matching.length === 0) {
    return [
      issue(item, "missing-outcome", `${adapterConformanceIdentityLabel(item)} ${supportStatus} support has no matching render result`, {
        expected: expectedStatuses,
      }),
    ];
  }

  const observedStatuses = sortedUnique(matching.map((outcome) => outcome.status));
  const conforming = matching.filter((outcome) =>
    expectedStatuses.includes(outcome.status)
  );
  const unexpectedStatuses = observedStatuses.filter((status) => !expectedStatuses.includes(status as SkillsetRenderResultStatus));
  if (conforming.length === 0 || unexpectedStatuses.length > 0) {
    return [
      issue(
        item,
        "status-mismatch",
        `${adapterConformanceIdentityLabel(item)} ${supportStatus} support rendered with ${observedStatuses.join(", ")}`,
        { expected: expectedStatuses, observed: observedStatuses }
      ),
    ];
  }

  const issues: AdapterConformanceIssue[] = [];
  for (const outcome of conforming) {
    if ((outcome.evidence?.length ?? 0) === 0) {
      issues.push(issue(item, "missing-outcome-evidence", `${outcome.sourceUnit} has no render evidence`));
    }
    if (reasonRequired(supportStatus)) {
      if (supportReason === undefined) {
        issues.push(issue(item, "support-reason-missing", `${supportStatus} support has no registry reason`));
      }
      if (outcome.reason === undefined) {
        issues.push(issue(item, "missing-outcome-reason", `${outcome.sourceUnit} has no render reason`));
      }
      if (supportReason !== undefined && outcome.reason !== undefined && supportReason !== outcome.reason) {
        issues.push(issue(item, "reason-mismatch", `${outcome.sourceUnit} reason does not match registry support reason`));
      }
    }
    if (
      standardProfile !== undefined &&
      !hasStandardProfileEvidence(outcome, standardProfile)
    ) {
      issues.push(
        issue(
          item,
          "standard-profile-evidence-mismatch",
          `${outcome.sourceUnit} does not cite pinned ${standardProfile.id} profile evidence`
        )
      );
    }
  }
  return issues;
}

function standardExpectedOutcomeStatuses(
  expectation: "required" | "unsupported"
): readonly SkillsetRenderResultStatus[] {
  return expectation === "required" ? ["rendered"] : ["unsupported"];
}

function expectedOutcomeStatuses(
  status: SkillsetTargetSupportStatus
): readonly SkillsetRenderResultStatus[] {
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
      return ["rendered", "target_native"];
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

function reasonRequired(status: SkillsetTargetSupportStatus | "required"): boolean {
  return status === "degraded" || status === "lossy" || status === "unsupported";
}

function matchesIdentity(
  outcome: SkillsetRenderResult,
  identity: AdapterConformanceIdentity
): boolean {
  return "standardProfile" in identity
    ? outcome.standardProfile === identity.standardProfile &&
        outcome.target === undefined
    : outcome.target === identity.target &&
        outcome.standardProfile === undefined;
}

function hasStandardProfileEvidence(
  outcome: SkillsetRenderResult,
  profile: StandardProfile
): boolean {
  const pinned = new Set(
    profile.provenance.snapshots.map((snapshot) => snapshot.url)
  );
  return (
    outcome.evidence?.some(
      (evidence) =>
        pinned.has(evidence.ref) &&
        evidence.verifiedAt === profile.provenance.observedAt
    ) ?? false
  );
}

export function adapterConformanceIdentityLabel(
  identity: AdapterConformanceIdentity
): string {
  return "standardProfile" in identity
    ? `standard:${identity.standardProfile}`
    : identity.target;
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
    ...("standardProfile" in item
      ? { standardProfile: item.standardProfile }
      : { target: item.target }),
  };
}

function sortedUnique(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort(compareStrings);
}

function compareIssues(left: AdapterConformanceIssue, right: AdapterConformanceIssue): number {
  return compareStrings(
    `${left.featureId}\0${adapterConformanceIdentityLabel(left)}\0${left.sourceUnit ?? ""}\0${left.code}`,
    `${right.featureId}\0${adapterConformanceIdentityLabel(right)}\0${right.sourceUnit ?? ""}\0${right.code}`
  );
}
