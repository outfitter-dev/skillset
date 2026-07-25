import { TARGET_NAMES } from "./contracts";
import { isSchemaRecord } from "./json";
import type {
  SkillsetSchemaDiagnostic,
  SkillsetSchemaValidationResult,
} from "./types";

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

export function validateActivationReadinessReport(
  value: unknown,
  root = "$"
): SkillsetSchemaValidationResult {
  const diagnostics: SkillsetSchemaDiagnostic[] = [];
  if (!isSchemaRecord(value)) {
    return validation([
      diagnostic(
        root,
        "schema/activation-readiness/type",
        "activation readiness report must be an object"
      ),
    ]);
  }
  checkObjectKeys(
    value,
    ["counts", "enabledTargets", "requirements", "schema", "summary"],
    ["counts", "enabledTargets", "requirements", "schema", "summary"],
    root,
    diagnostics
  );
  if (value.schema !== ACTIVATION_READINESS_SCHEMA) {
    diagnostics.push(
      diagnostic(
        `${root}.schema`,
        "schema/activation-readiness/version",
        `schema must be ${ACTIVATION_READINESS_SCHEMA}`
      )
    );
  }
  checkEnum(
    value.summary,
    ACTIVATION_READINESS_SUMMARIES,
    `${root}.summary`,
    "summary",
    diagnostics
  );
  checkCounts(value.counts, `${root}.counts`, diagnostics);
  checkUniqueStrings(
    value.enabledTargets,
    `${root}.enabledTargets`,
    "enabledTargets",
    diagnostics,
    TARGET_NAMES
  );
  if (!Array.isArray(value.requirements)) {
    diagnostics.push(
      diagnostic(
        `${root}.requirements`,
        "schema/activation-readiness/requirements",
        "requirements must be an array"
      )
    );
  } else {
    for (const [index, requirement] of value.requirements.entries()) {
      checkRequirement(
        requirement,
        `${root}.requirements[${index}]`,
        diagnostics
      );
    }
  }
  return validation(diagnostics);
}

function checkCounts(
  value: unknown,
  path: string,
  diagnostics: SkillsetSchemaDiagnostic[]
): void {
  const keys = [
    "blocked",
    "missing",
    "notApplicable",
    "satisfied",
    "stale",
    "unverified",
  ] as const;
  if (!isSchemaRecord(value)) {
    diagnostics.push(
      diagnostic(
        path,
        "schema/activation-readiness/counts",
        "counts must be an object"
      )
    );
    return;
  }
  checkObjectKeys(value, keys, keys, path, diagnostics);
  for (const key of keys) {
    if (!Number.isSafeInteger(value[key]) || Number(value[key]) < 0) {
      diagnostics.push(
        diagnostic(
          `${path}.${key}`,
          "schema/activation-readiness/count",
          `${key} must be a non-negative safe integer`
        )
      );
    }
  }
}

function checkRequirement(
  value: unknown,
  path: string,
  diagnostics: SkillsetSchemaDiagnostic[]
): void {
  const keys = [
    "capability",
    "id",
    "nextActions",
    "observationEffect",
    "origin",
    "reason",
    "required",
    "sourcePaths",
    "sourceUnits",
    "stage",
    "state",
    "subject",
    "target",
  ] as const;
  if (!isSchemaRecord(value)) {
    diagnostics.push(
      diagnostic(
        path,
        "schema/activation-readiness/requirement",
        "requirement must be an object"
      )
    );
    return;
  }
  checkObjectKeys(value, keys, keys, path, diagnostics);
  checkEnum(
    value.capability,
    ACTIVATION_CAPABILITIES,
    `${path}.capability`,
    "capability",
    diagnostics
  );
  checkEnum(
    value.observationEffect,
    ACTIVATION_OBSERVATION_EFFECTS,
    `${path}.observationEffect`,
    "observationEffect",
    diagnostics
  );
  checkEnum(
    value.origin,
    ACTIVATION_EVIDENCE_ORIGINS,
    `${path}.origin`,
    "origin",
    diagnostics
  );
  checkEnum(
    value.stage,
    ACTIVATION_REQUIREMENT_STAGES,
    `${path}.stage`,
    "stage",
    diagnostics
  );
  checkEnum(
    value.state,
    ACTIVATION_REQUIREMENT_STATES,
    `${path}.state`,
    "state",
    diagnostics
  );
  checkEnum(
    value.target,
    TARGET_NAMES,
    `${path}.target`,
    "target",
    diagnostics
  );
  for (const key of ["id", "reason", "subject"] as const) {
    checkNonEmptyString(value[key], `${path}.${key}`, key, diagnostics);
  }
  if (typeof value.required !== "boolean") {
    diagnostics.push(
      diagnostic(
        `${path}.required`,
        "schema/activation-readiness/required",
        "required must be a boolean"
      )
    );
  }
  checkUniqueStrings(
    value.sourcePaths,
    `${path}.sourcePaths`,
    "sourcePaths",
    diagnostics
  );
  checkUniqueStrings(
    value.sourceUnits,
    `${path}.sourceUnits`,
    "sourceUnits",
    diagnostics
  );
  if (!Array.isArray(value.nextActions)) {
    diagnostics.push(
      diagnostic(
        `${path}.nextActions`,
        "schema/activation-readiness/actions",
        "nextActions must be an array"
      )
    );
  } else {
    for (const [index, action] of value.nextActions.entries()) {
      checkAction(action, `${path}.nextActions[${index}]`, diagnostics);
    }
  }
}

function checkAction(
  value: unknown,
  path: string,
  diagnostics: SkillsetSchemaDiagnostic[]
): void {
  const keys = ["id", "label", "mutates", "url"] as const;
  if (!isSchemaRecord(value)) {
    diagnostics.push(
      diagnostic(
        path,
        "schema/activation-readiness/action",
        "next action must be an object"
      )
    );
    return;
  }
  checkObjectKeys(value, keys, keys, path, diagnostics);
  for (const key of ["id", "label", "url"] as const) {
    checkNonEmptyString(value[key], `${path}.${key}`, key, diagnostics);
  }
  if (typeof value.mutates !== "boolean") {
    diagnostics.push(
      diagnostic(
        `${path}.mutates`,
        "schema/activation-readiness/mutates",
        "mutates must be a boolean"
      )
    );
  }
}

function checkObjectKeys(
  value: Readonly<Record<string, unknown>>,
  allowed: readonly string[],
  required: readonly string[],
  path: string,
  diagnostics: SkillsetSchemaDiagnostic[]
): void {
  const allowedKeys = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      diagnostics.push(
        diagnostic(
          `${path}.${key}`,
          "schema/activation-readiness/key",
          `unknown activation readiness key ${key}`
        )
      );
    }
  }
  for (const key of required) {
    if (value[key] === undefined) {
      diagnostics.push(
        diagnostic(
          `${path}.${key}`,
          "schema/activation-readiness/required-key",
          `${key} is required`
        )
      );
    }
  }
}

function checkEnum(
  value: unknown,
  values: readonly unknown[],
  path: string,
  label: string,
  diagnostics: SkillsetSchemaDiagnostic[]
): void {
  if (!values.includes(value)) {
    diagnostics.push(
      diagnostic(
        path,
        `schema/activation-readiness/${label}`,
        `${label} is not recognized`
      )
    );
  }
}

function checkUniqueStrings(
  value: unknown,
  path: string,
  label: string,
  diagnostics: SkillsetSchemaDiagnostic[],
  allowed?: readonly string[]
): void {
  if (
    !Array.isArray(value) ||
    value.some((item) => typeof item !== "string" || item.length === 0)
  ) {
    diagnostics.push(
      diagnostic(
        path,
        `schema/activation-readiness/${label}`,
        `${label} must contain non-empty strings`
      )
    );
    return;
  }
  if (new Set(value).size !== value.length) {
    diagnostics.push(
      diagnostic(
        path,
        `schema/activation-readiness/${label}-unique`,
        `${label} must not contain duplicates`
      )
    );
  }
  if (
    allowed !== undefined &&
    value.some((item) => !allowed.includes(item))
  ) {
    diagnostics.push(
      diagnostic(
        path,
        `schema/activation-readiness/${label}-value`,
        `${label} contains an unrecognized value`
      )
    );
  }
}

function checkNonEmptyString(
  value: unknown,
  path: string,
  label: string,
  diagnostics: SkillsetSchemaDiagnostic[]
): void {
  if (typeof value !== "string" || value.length === 0) {
    diagnostics.push(
      diagnostic(
        path,
        `schema/activation-readiness/${label}`,
        `${label} must be a non-empty string`
      )
    );
  }
}

function validation(
  diagnostics: readonly SkillsetSchemaDiagnostic[]
): SkillsetSchemaValidationResult {
  return { diagnostics, ok: diagnostics.length === 0 };
}

function diagnostic(
  path: string,
  code: string,
  message: string
): SkillsetSchemaDiagnostic {
  return { code, message, path };
}
