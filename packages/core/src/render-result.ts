import {
  STANDARD_PROFILE_IDS,
  type StandardProfileId,
} from "@skillset/registry";

import type { SkillsetFeatureEvidence } from "./feature-registry";
import { compareStrings } from "./path";
import { isTargetName } from "./targets";
import type { TargetName } from "./types";
import { isJsonRecord } from "./yaml";

export const LEGACY_RENDER_RESULT_SCHEMA = "skillset-render-result@1";
export const RENDER_RESULT_SCHEMA = "skillset-render-result@2";

export const RENDER_RESULT_STATUS_VALUES = [
  "degraded",
  "externally_managed",
  "failed",
  "intentionally_skipped",
  "lossy",
  "metadata_only",
  "rendered",
  "target_native",
  "transformed",
  "unsupported",
] as const;

export type SkillsetRenderResultStatus =
  (typeof RENDER_RESULT_STATUS_VALUES)[number];

export type SkillsetRenderResultPolicy =
  | "default"
  | "scope:excluded"
  | "target:disabled"
  | "unsupported:error"
  | "unsupported:force"
  | "unsupported:skip"
  | "unsupported:warn";

const RENDER_RESULT_POLICY_VALUES = new Set<SkillsetRenderResultPolicy>([
  "default",
  "scope:excluded",
  "target:disabled",
  "unsupported:error",
  "unsupported:force",
  "unsupported:skip",
  "unsupported:warn",
]);

export interface SkillsetRenderResultOutput {
  readonly kind?: string;
  readonly path: string;
}

export interface SkillsetRenderResultDiagnosticRef {
  readonly code: string;
  readonly message?: string;
  readonly path?: string;
}

export interface SkillsetRenderResult {
  /**
   * Concrete output or scope under {@link target} that this result describes,
   * such as `skill`, `plugin-manifest`, `instruction`, `agent`,
   * `target-native-island`, `skill-frontmatter`, or a plugin feature artifact.
   * `target` is the provider adapter (`claude`, `codex`, or `cursor`); `destination`
   * is the concrete artifact rendered under it.
   */
  readonly destination?: string;
  readonly diagnostics?: readonly SkillsetRenderResultDiagnosticRef[];
  readonly evidence?: readonly SkillsetFeatureEvidence[];
  readonly featureId: string;
  readonly outputs?: readonly SkillsetRenderResultOutput[];
  readonly policy?: SkillsetRenderResultPolicy;
  readonly reason?: string;
  readonly schema: typeof RENDER_RESULT_SCHEMA;
  readonly sourcePath?: string;
  readonly sourceUnit: string;
  /** Standards identity stays separate from provider target identity. */
  readonly standardProfile?: StandardProfileId;
  readonly status: SkillsetRenderResultStatus;
  readonly target?: TargetName;
}

export type SkillsetRenderResultInput = Omit<SkillsetRenderResult, "schema"> & {
  readonly schema?: typeof RENDER_RESULT_SCHEMA;
};

/**
 * Why a render result set stopped a derivation.
 *
 * `policy-blocked` carries the results the configured unsupported-destination
 * policy rejected on their own merits. `no-usable-output` carries results a
 * soft policy softened individually, but whose projection left no usable
 * non-lock output; every carried result is blocking evidence in that case.
 */
export type SkillsetRenderResultErrorKind =
  | "no-usable-output"
  | "policy-blocked";

export class SkillsetRenderResultError extends Error {
  readonly kind: SkillsetRenderResultErrorKind;
  readonly renderResults: readonly SkillsetRenderResult[];

  constructor(
    message: string,
    renderResults: readonly SkillsetRenderResult[],
    kind: SkillsetRenderResultErrorKind = "policy-blocked"
  ) {
    super(message);
    this.name = "SkillsetRenderResultError";
    this.kind = kind;
    this.renderResults = renderResults.map(normalizeRenderResult);
  }
}

export function defineRenderResult(
  input: SkillsetRenderResultInput
): SkillsetRenderResult {
  const outcome = normalizeRenderResult({
    ...input,
    schema: input.schema ?? RENDER_RESULT_SCHEMA,
  });
  assertRenderResult(outcome);
  return outcome;
}

/**
 * Read persisted Render Results across the generated-state migration window.
 * Writers always emit the current schema; legacy input is validated before its
 * schema identity is advanced.
 */
export function parseRenderResult(value: unknown): SkillsetRenderResult {
  if (!isJsonRecord(value)) {
    throw new Error("skillset: render result must be an object");
  }
  if (value.schema === LEGACY_RENDER_RESULT_SCHEMA) {
    if (value.standardProfile !== undefined) {
      throw new Error(
        "skillset: legacy render result cannot name a standardProfile"
      );
    }
    const migrated = { ...value, schema: RENDER_RESULT_SCHEMA };
    assertRenderResult(migrated);
    return normalizeRenderResult(migrated);
  }
  assertRenderResult(value);
  return normalizeRenderResult(value);
}

export function normalizeRenderResult(
  outcome: SkillsetRenderResult
): SkillsetRenderResult {
  return {
    schema: outcome.schema,
    sourceUnit: outcome.sourceUnit,
    ...(outcome.sourcePath === undefined
      ? {}
      : { sourcePath: outcome.sourcePath }),
    featureId: outcome.featureId,
    ...(outcome.target === undefined ? {} : { target: outcome.target }),
    ...(outcome.standardProfile === undefined
      ? {}
      : { standardProfile: outcome.standardProfile }),
    ...(outcome.destination === undefined
      ? {}
      : { destination: outcome.destination }),
    status: outcome.status,
    ...(outcome.reason === undefined ? {} : { reason: outcome.reason }),
    ...(outcome.policy === undefined ? {} : { policy: outcome.policy }),
    ...(outcome.outputs === undefined
      ? {}
      : { outputs: normalizeOutputs(outcome.outputs) }),
    ...(outcome.diagnostics === undefined
      ? {}
      : { diagnostics: normalizeDiagnostics(outcome.diagnostics) }),
    ...(outcome.evidence === undefined
      ? {}
      : { evidence: normalizeEvidence(outcome.evidence) }),
  };
}

export function serializeRenderResult(outcome: SkillsetRenderResult): string {
  return `${JSON.stringify(normalizeRenderResult(outcome), null, 2)}\n`;
}

export function assertRenderResult(
  outcome: unknown
): asserts outcome is SkillsetRenderResult {
  if (!isJsonRecord(outcome)) {
    throw new Error("skillset: render result must be an object");
  }
  if (outcome.schema !== RENDER_RESULT_SCHEMA) {
    throw new Error(
      `skillset: unsupported render result schema ${String(outcome.schema)}`
    );
  }
  if (
    typeof outcome.sourceUnit !== "string" ||
    outcome.sourceUnit.trim().length === 0
  ) {
    throw new Error("skillset: render result sourceUnit is required");
  }
  if (
    typeof outcome.featureId !== "string" ||
    outcome.featureId.trim().length === 0
  ) {
    throw new Error("skillset: render result featureId is required");
  }
  if (
    outcome.target !== undefined &&
    (typeof outcome.target !== "string" || !isTargetName(outcome.target))
  ) {
    throw new Error("skillset: render result target must be a provider target");
  }
  if (
    outcome.standardProfile !== undefined &&
    (typeof outcome.standardProfile !== "string" ||
      !(STANDARD_PROFILE_IDS as readonly string[]).includes(
        outcome.standardProfile
      ))
  ) {
    throw new Error(
      "skillset: render result standardProfile must be a standard profile id"
    );
  }
  if (outcome.standardProfile !== undefined && outcome.target !== undefined) {
    throw new Error(
      "skillset: render result cannot name both a provider target and a standardProfile"
    );
  }
  if (
    outcome.sourcePath !== undefined &&
    typeof outcome.sourcePath !== "string"
  ) {
    throw new Error("skillset: render result sourcePath must be a string");
  }
  if (
    outcome.destination !== undefined &&
    (typeof outcome.destination !== "string" ||
      outcome.destination.trim().length === 0)
  ) {
    throw new Error(
      "skillset: render result destination must be non-empty when present"
    );
  }
  if (
    typeof outcome.status !== "string" ||
    !new Set<string>(RENDER_RESULT_STATUS_VALUES).has(outcome.status)
  ) {
    throw new Error(
      `skillset: unknown render result status ${String(outcome.status)}`
    );
  }
  if (outcome.reason !== undefined && typeof outcome.reason !== "string") {
    throw new Error("skillset: render result reason must be a string");
  }
  if (
    outcome.policy !== undefined &&
    (typeof outcome.policy !== "string" ||
      !RENDER_RESULT_POLICY_VALUES.has(
        outcome.policy as SkillsetRenderResultPolicy
      ))
  ) {
    throw new Error(
      `skillset: unknown render result policy ${String(outcome.policy)}`
    );
  }
  if (
    (outcome.status === "degraded" ||
      outcome.status === "failed" ||
      outcome.status === "lossy" ||
      outcome.status === "unsupported") &&
    typeof outcome.reason !== "string"
  ) {
    throw new Error(
      `skillset: render result ${outcome.status} status requires a reason`
    );
  }
  if (outcome.outputs !== undefined && !Array.isArray(outcome.outputs)) {
    throw new Error("skillset: render result outputs must be an array");
  }
  for (const output of outcome.outputs ?? []) {
    if (
      !isJsonRecord(output) ||
      typeof output.path !== "string" ||
      output.path.trim().length === 0
    ) {
      throw new Error("skillset: render result output path is required");
    }
    if (output.kind !== undefined && typeof output.kind !== "string") {
      throw new Error("skillset: render result output kind must be a string");
    }
  }
  if (
    outcome.diagnostics !== undefined &&
    !Array.isArray(outcome.diagnostics)
  ) {
    throw new Error("skillset: render result diagnostics must be an array");
  }
  for (const diagnostic of outcome.diagnostics ?? []) {
    if (
      !isJsonRecord(diagnostic) ||
      typeof diagnostic.code !== "string" ||
      diagnostic.code.trim().length === 0
    ) {
      throw new Error("skillset: render result diagnostic code is required");
    }
    if (
      diagnostic.message !== undefined &&
      typeof diagnostic.message !== "string"
    ) {
      throw new Error(
        "skillset: render result diagnostic message must be a string"
      );
    }
    if (diagnostic.path !== undefined && typeof diagnostic.path !== "string") {
      throw new Error(
        "skillset: render result diagnostic path must be a string"
      );
    }
  }
  if (outcome.evidence !== undefined && !Array.isArray(outcome.evidence)) {
    throw new Error("skillset: render result evidence must be an array");
  }
  for (const evidence of outcome.evidence ?? []) {
    if (
      !isJsonRecord(evidence) ||
      typeof evidence.kind !== "string" ||
      evidence.kind.trim().length === 0
    ) {
      throw new Error("skillset: render result evidence kind is required");
    }
    if (typeof evidence.ref !== "string" || evidence.ref.trim().length === 0) {
      throw new Error("skillset: render result evidence ref is required");
    }
    if (evidence.note !== undefined && typeof evidence.note !== "string") {
      throw new Error("skillset: render result evidence note must be a string");
    }
    if (
      evidence.verifiedAt !== undefined &&
      typeof evidence.verifiedAt !== "string"
    ) {
      throw new Error(
        "skillset: render result evidence verifiedAt must be a string"
      );
    }
    if (
      evidence.kind === "external-docs" &&
      evidence.verifiedAt === undefined
    ) {
      throw new Error(
        "skillset: render result external docs evidence requires verifiedAt"
      );
    }
  }
}

function normalizeOutputs(
  outputs: readonly SkillsetRenderResultOutput[]
): readonly SkillsetRenderResultOutput[] {
  return [...outputs]
    .map((output) => ({
      ...(output.kind === undefined ? {} : { kind: output.kind }),
      path: output.path,
    }))
    .sort((left, right) =>
      compareStrings(
        `${left.path}\0${left.kind ?? ""}`,
        `${right.path}\0${right.kind ?? ""}`
      )
    );
}

function normalizeDiagnostics(
  diagnostics: readonly SkillsetRenderResultDiagnosticRef[]
): readonly SkillsetRenderResultDiagnosticRef[] {
  return [...diagnostics]
    .map((diagnostic) => ({
      code: diagnostic.code,
      ...(diagnostic.message === undefined
        ? {}
        : { message: diagnostic.message }),
      ...(diagnostic.path === undefined ? {} : { path: diagnostic.path }),
    }))
    .sort((left, right) =>
      compareStrings(
        `${left.code}\0${left.path ?? ""}\0${left.message ?? ""}`,
        `${right.code}\0${right.path ?? ""}\0${right.message ?? ""}`
      )
    );
}

function normalizeEvidence(
  evidence: readonly SkillsetFeatureEvidence[]
): readonly SkillsetFeatureEvidence[] {
  return [...evidence]
    .map((item) => ({
      kind: item.kind,
      ref: item.ref,
      ...(item.verifiedAt === undefined ? {} : { verifiedAt: item.verifiedAt }),
      ...(item.note === undefined ? {} : { note: item.note }),
    }))
    .sort((left, right) =>
      compareStrings(
        `${left.kind}\0${left.ref}\0${left.verifiedAt ?? ""}\0${left.note ?? ""}`,
        `${right.kind}\0${right.ref}\0${right.verifiedAt ?? ""}\0${right.note ?? ""}`
      )
    );
}
