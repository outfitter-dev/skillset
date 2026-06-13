import { compareStrings } from "./path";
import type { SkillsetFeatureEvidence } from "./feature-registry";
import type { TargetName } from "./types";

export const LOWERING_OUTCOME_SCHEMA = "skillset-lowering-outcome@1";

export const LOWERING_OUTCOME_STATUS_VALUES = [
  "degraded",
  "emitted",
  "externally_managed",
  "failed",
  "intentionally_skipped",
  "lossy",
  "metadata_only",
  "target_native",
  "transformed",
  "unsupported",
] as const;

export type SkillsetLoweringOutcomeStatus = (typeof LOWERING_OUTCOME_STATUS_VALUES)[number];

export type SkillsetLoweringPolicy =
  | "default"
  | "scope:excluded"
  | "target:disabled"
  | "unsupported:error"
  | "unsupported:force"
  | "unsupported:skip"
  | "unsupported:warn";

export interface SkillsetLoweringOutput {
  readonly kind?: string;
  readonly path: string;
}

export interface SkillsetLoweringDiagnosticRef {
  readonly code: string;
  readonly message?: string;
  readonly path?: string;
}

export interface SkillsetLoweringOutcome {
  readonly diagnostics?: readonly SkillsetLoweringDiagnosticRef[];
  readonly evidence?: readonly SkillsetFeatureEvidence[];
  readonly featureId: string;
  readonly outputs?: readonly SkillsetLoweringOutput[];
  readonly policy?: SkillsetLoweringPolicy;
  readonly reason?: string;
  readonly schema: typeof LOWERING_OUTCOME_SCHEMA;
  readonly sourcePath?: string;
  readonly sourceUnit: string;
  readonly status: SkillsetLoweringOutcomeStatus;
  readonly target?: TargetName;
}

export type SkillsetLoweringOutcomeInput = Omit<SkillsetLoweringOutcome, "schema"> & {
  readonly schema?: typeof LOWERING_OUTCOME_SCHEMA;
};

export function defineLoweringOutcome(
  input: SkillsetLoweringOutcomeInput
): SkillsetLoweringOutcome {
  const outcome = normalizeLoweringOutcome({
    ...input,
    schema: input.schema ?? LOWERING_OUTCOME_SCHEMA,
  });
  assertLoweringOutcome(outcome);
  return outcome;
}

export function normalizeLoweringOutcome(
  outcome: SkillsetLoweringOutcome
): SkillsetLoweringOutcome {
  return {
    schema: outcome.schema,
    sourceUnit: outcome.sourceUnit,
    ...(outcome.sourcePath === undefined ? {} : { sourcePath: outcome.sourcePath }),
    featureId: outcome.featureId,
    ...(outcome.target === undefined ? {} : { target: outcome.target }),
    status: outcome.status,
    ...(outcome.reason === undefined ? {} : { reason: outcome.reason }),
    ...(outcome.policy === undefined ? {} : { policy: outcome.policy }),
    ...(outcome.outputs === undefined ? {} : { outputs: normalizeOutputs(outcome.outputs) }),
    ...(outcome.diagnostics === undefined ? {} : { diagnostics: normalizeDiagnostics(outcome.diagnostics) }),
    ...(outcome.evidence === undefined ? {} : { evidence: normalizeEvidence(outcome.evidence) }),
  };
}

export function serializeLoweringOutcome(outcome: SkillsetLoweringOutcome): string {
  return `${JSON.stringify(normalizeLoweringOutcome(outcome), null, 2)}\n`;
}

export function assertLoweringOutcome(outcome: SkillsetLoweringOutcome): void {
  if (outcome.schema !== LOWERING_OUTCOME_SCHEMA) {
    throw new Error(`skillset: unsupported lowering outcome schema ${outcome.schema}`);
  }
  if (outcome.sourceUnit.trim().length === 0) {
    throw new Error("skillset: lowering outcome sourceUnit is required");
  }
  if (outcome.featureId.trim().length === 0) {
    throw new Error("skillset: lowering outcome featureId is required");
  }
  if (!new Set<string>(LOWERING_OUTCOME_STATUS_VALUES).has(outcome.status)) {
    throw new Error(`skillset: unknown lowering outcome status ${outcome.status}`);
  }
  if ((outcome.status === "degraded" || outcome.status === "failed" || outcome.status === "lossy" || outcome.status === "unsupported") && outcome.reason === undefined) {
    throw new Error(`skillset: lowering outcome ${outcome.status} status requires a reason`);
  }
  for (const output of outcome.outputs ?? []) {
    if (output.path.trim().length === 0) {
      throw new Error("skillset: lowering outcome output path is required");
    }
  }
  for (const diagnostic of outcome.diagnostics ?? []) {
    if (diagnostic.code.trim().length === 0) {
      throw new Error("skillset: lowering outcome diagnostic code is required");
    }
  }
  for (const evidence of outcome.evidence ?? []) {
    if (evidence.ref.trim().length === 0) {
      throw new Error("skillset: lowering outcome evidence ref is required");
    }
    if (evidence.kind === "external-docs" && evidence.verifiedAt === undefined) {
      throw new Error("skillset: lowering outcome external docs evidence requires verifiedAt");
    }
  }
}

function normalizeOutputs(outputs: readonly SkillsetLoweringOutput[]): readonly SkillsetLoweringOutput[] {
  return [...outputs]
    .map((output) => ({
      ...(output.kind === undefined ? {} : { kind: output.kind }),
      path: output.path,
    }))
    .sort((left, right) => compareStrings(`${left.path}\0${left.kind ?? ""}`, `${right.path}\0${right.kind ?? ""}`));
}

function normalizeDiagnostics(
  diagnostics: readonly SkillsetLoweringDiagnosticRef[]
): readonly SkillsetLoweringDiagnosticRef[] {
  return [...diagnostics]
    .map((diagnostic) => ({
      code: diagnostic.code,
      ...(diagnostic.message === undefined ? {} : { message: diagnostic.message }),
      ...(diagnostic.path === undefined ? {} : { path: diagnostic.path }),
    }))
    .sort((left, right) =>
      compareStrings(
        `${left.code}\0${left.path ?? ""}\0${left.message ?? ""}`,
        `${right.code}\0${right.path ?? ""}\0${right.message ?? ""}`
      )
    );
}

function normalizeEvidence(evidence: readonly SkillsetFeatureEvidence[]): readonly SkillsetFeatureEvidence[] {
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
