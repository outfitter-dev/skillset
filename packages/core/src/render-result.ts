import { compareStrings } from "./path";
import type { SkillsetFeatureEvidence } from "./feature-registry";
import type { TargetName } from "./types";

export const RENDER_RESULT_SCHEMA = "skillset-render-result@1";

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

export type SkillsetRenderResultStatus = (typeof RENDER_RESULT_STATUS_VALUES)[number];

export type SkillsetRenderResultPolicy =
  | "default"
  | "scope:excluded"
  | "target:disabled"
  | "unsupported:error"
  | "unsupported:force"
  | "unsupported:skip"
  | "unsupported:warn";

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
  readonly diagnostics?: readonly SkillsetRenderResultDiagnosticRef[];
  readonly evidence?: readonly SkillsetFeatureEvidence[];
  readonly featureId: string;
  readonly outputs?: readonly SkillsetRenderResultOutput[];
  readonly policy?: SkillsetRenderResultPolicy;
  readonly reason?: string;
  readonly schema: typeof RENDER_RESULT_SCHEMA;
  readonly sourcePath?: string;
  readonly sourceUnit: string;
  readonly status: SkillsetRenderResultStatus;
  readonly target?: TargetName;
}

export type SkillsetRenderResultInput = Omit<SkillsetRenderResult, "schema"> & {
  readonly schema?: typeof RENDER_RESULT_SCHEMA;
};

export class SkillsetRenderResultError extends Error {
  readonly renderResults: readonly SkillsetRenderResult[];

  constructor(message: string, renderResults: readonly SkillsetRenderResult[]) {
    super(message);
    this.name = "SkillsetRenderResultError";
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

export function normalizeRenderResult(
  outcome: SkillsetRenderResult
): SkillsetRenderResult {
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

export function serializeRenderResult(outcome: SkillsetRenderResult): string {
  return `${JSON.stringify(normalizeRenderResult(outcome), null, 2)}\n`;
}

export function assertRenderResult(outcome: SkillsetRenderResult): void {
  if (outcome.schema !== RENDER_RESULT_SCHEMA) {
    throw new Error(`skillset: unsupported render result schema ${outcome.schema}`);
  }
  if (outcome.sourceUnit.trim().length === 0) {
    throw new Error("skillset: render result sourceUnit is required");
  }
  if (outcome.featureId.trim().length === 0) {
    throw new Error("skillset: render result featureId is required");
  }
  if (!new Set<string>(RENDER_RESULT_STATUS_VALUES).has(outcome.status)) {
    throw new Error(`skillset: unknown render result status ${outcome.status}`);
  }
  if ((outcome.status === "degraded" || outcome.status === "failed" || outcome.status === "lossy" || outcome.status === "unsupported") && outcome.reason === undefined) {
    throw new Error(`skillset: render result ${outcome.status} status requires a reason`);
  }
  for (const output of outcome.outputs ?? []) {
    if (output.path.trim().length === 0) {
      throw new Error("skillset: render result output path is required");
    }
  }
  for (const diagnostic of outcome.diagnostics ?? []) {
    if (diagnostic.code.trim().length === 0) {
      throw new Error("skillset: render result diagnostic code is required");
    }
  }
  for (const evidence of outcome.evidence ?? []) {
    if (evidence.ref.trim().length === 0) {
      throw new Error("skillset: render result evidence ref is required");
    }
    if (evidence.kind === "external-docs" && evidence.verifiedAt === undefined) {
      throw new Error("skillset: render result external docs evidence requires verifiedAt");
    }
  }
}

function normalizeOutputs(outputs: readonly SkillsetRenderResultOutput[]): readonly SkillsetRenderResultOutput[] {
  return [...outputs]
    .map((output) => ({
      ...(output.kind === undefined ? {} : { kind: output.kind }),
      path: output.path,
    }))
    .sort((left, right) => compareStrings(`${left.path}\0${left.kind ?? ""}`, `${right.path}\0${right.kind ?? ""}`));
}

function normalizeDiagnostics(
  diagnostics: readonly SkillsetRenderResultDiagnosticRef[]
): readonly SkillsetRenderResultDiagnosticRef[] {
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
