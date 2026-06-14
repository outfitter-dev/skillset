import type { AdapterConformanceCase } from "./adapter-conformance";
import {
  skillsetFeatureRegistry,
  type SkillsetFeatureEntry,
  type SkillsetFeatureRegistry,
  type SkillsetFeatureStatus,
  type SkillsetTargetSupportStatus,
} from "./feature-registry";
import { compareStrings } from "./path";
import type { TargetName } from "./types";

export type AdapterConformanceCoverageStatus =
  | "covered"
  | "deferred"
  | "future"
  | "invalid_fixture"
  | "missing_fixture"
  | "not_applicable"
  | "planned"
  | "stale_fixture"
  | "unsupported_without_fixture";

export interface AdapterConformanceCoverageEntry {
  readonly coverage: AdapterConformanceCoverageStatus;
  readonly featureId: string;
  readonly featureStatus?: SkillsetFeatureStatus;
  readonly fixtureRefs: readonly string[];
  readonly reason?: string;
  readonly supportStatus?: SkillsetTargetSupportStatus;
  readonly target: TargetName;
  readonly title?: string;
}

export interface AdapterConformanceCoverageReport {
  readonly entries: readonly AdapterConformanceCoverageEntry[];
  readonly gaps: readonly AdapterConformanceCoverageEntry[];
  readonly ok: boolean;
}

export function createAdapterConformanceCoverageReport(
  cases: readonly AdapterConformanceCase[],
  registry: SkillsetFeatureRegistry = skillsetFeatureRegistry
): AdapterConformanceCoverageReport {
  const entries = [
    ...registry.flatMap((feature) =>
      (["claude", "codex"] as const satisfies readonly TargetName[]).map((target) =>
        coverageEntry(feature, target, fixtureRefsFor(cases, feature.id, target))
      )
    ),
    ...staleFixtureEntries(cases, registry),
  ].sort(compareEntries);
  const gaps = entries.filter((entry) => isGap(entry.coverage));
  return {
    entries,
    gaps,
    ok: gaps.length === 0,
  };
}

export function formatAdapterConformanceCoverageReport(
  report: AdapterConformanceCoverageReport
): string {
  if (report.gaps.length === 0) {
    return `skillset: adapter conformance coverage has no gaps across ${report.entries.length} target claims`;
  }
  return [
    `skillset: adapter conformance coverage found ${report.gaps.length} ${report.gaps.length === 1 ? "gap" : "gaps"}`,
    ...report.gaps.map((entry) => {
      const reason = entry.reason === undefined ? "" : ` (${entry.reason})`;
      const support = entry.supportStatus ?? "unknown support";
      return `- ${entry.featureId} ${entry.target}: ${entry.coverage} for ${support}${reason}`;
    }),
  ].join("\n");
}

function coverageEntry(
  feature: SkillsetFeatureEntry,
  target: TargetName,
  fixtureRefs: readonly string[]
): AdapterConformanceCoverageEntry {
  const support = feature.targetSupport[target];
  const coverage = coverageStatus(feature.status, support.status, fixtureRefs.length > 0);
  return {
    coverage,
    featureId: feature.id,
    featureStatus: feature.status,
    fixtureRefs,
    ...(support.reason === undefined ? {} : { reason: support.reason }),
    supportStatus: support.status,
    target,
    title: feature.title,
  };
}

function coverageStatus(
  featureStatus: SkillsetFeatureStatus,
  supportStatus: SkillsetTargetSupportStatus,
  hasFixture: boolean
): AdapterConformanceCoverageStatus {
  if (hasFixture && !supportCanHaveFixture(featureStatus, supportStatus)) return "invalid_fixture";
  if (hasFixture) return "covered";
  if (supportStatus === "not_applicable") return "not_applicable";
  if (featureStatus === "deferred") return "deferred";
  if (featureStatus === "future" || supportStatus === "future") return "future";
  if (featureStatus === "planned" || supportStatus === "planned") return "planned";
  if (supportStatus === "unsupported") return "unsupported_without_fixture";
  return "missing_fixture";
}

function supportCanHaveFixture(
  featureStatus: SkillsetFeatureStatus,
  supportStatus: SkillsetTargetSupportStatus
): boolean {
  if (featureStatus === "deferred" || featureStatus === "future" || featureStatus === "planned") return false;
  return supportStatus !== "future" && supportStatus !== "not_applicable" && supportStatus !== "planned";
}

function fixtureRefsFor(
  cases: readonly AdapterConformanceCase[],
  featureId: string,
  target: TargetName
): readonly string[] {
  return [...new Set(
    cases
      .filter((item) => item.featureId === featureId && item.target === target)
      .map((item) => item.fixtureRef ?? item.sourceUnit ?? `${item.featureId}:${item.target}`)
  )].sort(compareStrings);
}

function staleFixtureEntries(
  cases: readonly AdapterConformanceCase[],
  registry: SkillsetFeatureRegistry
): readonly AdapterConformanceCoverageEntry[] {
  const registryIds = new Set(registry.map((feature) => feature.id));
  const grouped = new Map<string, AdapterConformanceCase[]>();
  for (const item of cases) {
    if (registryIds.has(item.featureId)) continue;
    const key = `${item.featureId}\0${item.target}`;
    grouped.set(key, [...(grouped.get(key) ?? []), item]);
  }
  return [...grouped.values()].map((items) => {
    const [first] = items;
    if (first === undefined) throw new Error("skillset: internal stale fixture group is empty");
    return {
      coverage: "stale_fixture",
      featureId: first.featureId,
      fixtureRefs: sortedUnique(items.map((item) => item.fixtureRef ?? item.sourceUnit ?? `${item.featureId}:${item.target}`)),
      reason: "feature id is not present in registry",
      target: first.target,
    };
  });
}

function isGap(status: AdapterConformanceCoverageStatus): boolean {
  return status === "invalid_fixture" || status === "missing_fixture" || status === "stale_fixture" || status === "unsupported_without_fixture";
}

function compareEntries(
  left: AdapterConformanceCoverageEntry,
  right: AdapterConformanceCoverageEntry
): number {
  return compareStrings(`${left.featureId}\0${left.target}`, `${right.featureId}\0${right.target}`);
}

function sortedUnique(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort(compareStrings);
}
