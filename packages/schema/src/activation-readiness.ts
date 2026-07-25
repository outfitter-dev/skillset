import { TARGET_NAMES } from "./contracts";

export const ACTIVATION_READINESS_SCHEMA = "skillset.activation-readiness@1";

export const ACTIVATION_CAPABILITIES = [
  "app",
  "mcp-server",
  "plugin-dependency",
] as const;

export const ACTIVATION_REQUIREMENT_STAGES = [
  "declared",
  "rendered",
  "discoverable",
  "enabled",
  "authenticated",
  "connected",
  "proven",
] as const;

export const ACTIVATION_REQUIREMENT_STATES = [
  "satisfied",
  "missing",
  "blocked",
  "unverified",
  "stale",
  "not_applicable",
] as const;

export const ACTIVATION_READINESS_SUMMARIES = [
  "ready",
  "ready_unverified",
  "attention",
  "blocked",
] as const;

export const ACTIVATION_EVIDENCE_ORIGINS = [
  "declared",
  "derived",
  "observed",
  "proven",
] as const;

export const ACTIVATION_OBSERVATION_EFFECTS = [
  "active",
  "none",
  "passive",
] as const;

export type ActivationCapability = (typeof ACTIVATION_CAPABILITIES)[number];
export type ActivationEvidenceOrigin =
  (typeof ACTIVATION_EVIDENCE_ORIGINS)[number];
export type ActivationObservationEffect =
  (typeof ACTIVATION_OBSERVATION_EFFECTS)[number];
export type ActivationReadinessSummary =
  (typeof ACTIVATION_READINESS_SUMMARIES)[number];
export type ActivationRequirementStage =
  (typeof ACTIVATION_REQUIREMENT_STAGES)[number];
export type ActivationRequirementState =
  (typeof ACTIVATION_REQUIREMENT_STATES)[number];
export type ActivationTarget = (typeof TARGET_NAMES)[number];

export interface ActivationNextAction {
  readonly id: string;
  readonly label: string;
  readonly mutates: boolean;
  readonly url: string;
}

export interface ActivationRequirement {
  readonly capability: ActivationCapability;
  readonly id: string;
  readonly nextActions: readonly ActivationNextAction[];
  readonly observationEffect: ActivationObservationEffect;
  readonly origin: ActivationEvidenceOrigin;
  readonly reason: string;
  readonly required: boolean;
  readonly sourcePaths: readonly string[];
  readonly sourceUnits: readonly string[];
  readonly stage: ActivationRequirementStage;
  readonly state: ActivationRequirementState;
  readonly subject: string;
  readonly target: ActivationTarget;
}

export interface ActivationReadinessCounts {
  readonly blocked: number;
  readonly missing: number;
  readonly notApplicable: number;
  readonly satisfied: number;
  readonly stale: number;
  readonly unverified: number;
}

export interface ActivationReadinessReport {
  readonly counts: ActivationReadinessCounts;
  readonly enabledTargets: readonly ActivationTarget[];
  readonly requirements: readonly ActivationRequirement[];
  readonly schema: typeof ACTIVATION_READINESS_SCHEMA;
  readonly summary: ActivationReadinessSummary;
}
