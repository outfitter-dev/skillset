import { compareStrings } from "./path";
import type { TargetName } from "./types";

export type SkillsetFeatureId = string;

export const FEATURE_STATUS_VALUES = [
  "deferred",
  "future",
  "implemented",
  "planned",
  "reserved",
  "unsupported",
] as const;

export type SkillsetFeatureStatus = (typeof FEATURE_STATUS_VALUES)[number];

export const TARGET_SUPPORT_STATUS_VALUES = [
  "degraded",
  "externally_managed",
  "future",
  "lossy",
  "metadata_only",
  "native",
  "not_applicable",
  "pass_through",
  "planned",
  "transformed",
  "unsupported",
] as const;

export type SkillsetTargetSupportStatus = (typeof TARGET_SUPPORT_STATUS_VALUES)[number];

export type SkillsetFeatureKind =
  | "adoption"
  | "change-management"
  | "metadata"
  | "plugin-component"
  | "source"
  | "target-native"
  | "workflow";

export type SkillsetEvidenceKind =
  | "assumption"
  | "docs"
  | "external-docs"
  | "fixture"
  | "source"
  | "test";

export interface SkillsetFeatureEvidence {
  readonly kind: SkillsetEvidenceKind;
  readonly note?: string;
  readonly ref: string;
  readonly verifiedAt?: string;
}

export interface SkillsetTargetSupport {
  readonly evidence?: readonly SkillsetFeatureEvidence[];
  readonly note?: string;
  readonly reason?: string;
  readonly status: SkillsetTargetSupportStatus;
}

export interface SkillsetFeatureEntry {
  readonly docs: readonly string[];
  readonly evidence: readonly SkillsetFeatureEvidence[];
  readonly id: SkillsetFeatureId;
  readonly kind: SkillsetFeatureKind;
  readonly loweringOwner: string;
  readonly sourceShape: string;
  readonly status: SkillsetFeatureStatus;
  readonly summary: string;
  readonly targetSupport: Readonly<Record<TargetName, SkillsetTargetSupport>>;
  readonly title: string;
  readonly validationOwner: string;
}

export type SkillsetFeatureRegistry = readonly SkillsetFeatureEntry[];

export const skillsetFeatureRegistry = defineFeatureRegistry([]);

export function defineFeatureRegistry(
  entries: readonly SkillsetFeatureEntry[]
): SkillsetFeatureRegistry {
  assertFeatureIdsUnique(entries);
  assertFeatureStatusVocabulary(entries);
  return [...entries].sort((left, right) => compareStrings(left.id, right.id));
}

export function listSkillsetFeatures(
  registry: SkillsetFeatureRegistry = skillsetFeatureRegistry
): SkillsetFeatureRegistry {
  return registry;
}

export function getSkillsetFeature(
  id: SkillsetFeatureId,
  registry: SkillsetFeatureRegistry = skillsetFeatureRegistry
): SkillsetFeatureEntry | undefined {
  return registry.find((entry) => entry.id === id);
}

export function listSkillsetFeaturesByTarget(
  target: TargetName,
  registry: SkillsetFeatureRegistry = skillsetFeatureRegistry
): SkillsetFeatureRegistry {
  return registry.filter((entry) => entry.targetSupport[target].status !== "not_applicable");
}

export function assertFeatureIdsUnique(entries: readonly SkillsetFeatureEntry[]): void {
  const seen = new Set<string>();
  for (const entry of entries) {
    if (seen.has(entry.id)) throw new Error(`skillset: duplicate feature registry id ${entry.id}`);
    seen.add(entry.id);
  }
}

function assertFeatureStatusVocabulary(entries: readonly SkillsetFeatureEntry[]): void {
  const featureStatuses = new Set<string>(FEATURE_STATUS_VALUES);
  const targetStatuses = new Set<string>(TARGET_SUPPORT_STATUS_VALUES);
  for (const entry of entries) {
    if (!featureStatuses.has(entry.status)) {
      throw new Error(`skillset: unknown feature registry status ${entry.status} for ${entry.id}`);
    }
    for (const target of ["claude", "codex"] as const satisfies readonly TargetName[]) {
      const support = entry.targetSupport[target];
      if (!targetStatuses.has(support.status)) {
        throw new Error(
          `skillset: unknown target support status ${support.status} for ${entry.id} ${target}`
        );
      }
      if ((support.status === "lossy" || support.status === "unsupported") && support.reason === undefined) {
        throw new Error(`skillset: ${entry.id} ${target} ${support.status} support requires a reason`);
      }
    }
  }
}
