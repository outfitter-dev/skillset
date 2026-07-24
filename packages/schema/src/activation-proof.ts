import {
  type ActivationCapability,
  type ActivationTarget,
} from "./activation-readiness";
import { TARGET_NAMES } from "./contracts";
import { isSchemaRecord } from "./json";
import type {
  SkillsetSchemaDiagnostic,
  SkillsetSchemaValidationResult,
} from "./types";

export const ACTIVATION_PROOF_RECEIPT_SCHEMA =
  "skillset.activation-proof-receipt@2";

export const ACTIVATION_PROOF_RECEIPT_OUTCOMES = [
  "cancelled",
  "failed",
  "passed",
  "timed_out",
] as const;

export type ActivationProofReceiptOutcome =
  (typeof ACTIVATION_PROOF_RECEIPT_OUTCOMES)[number];

/** An authored declaration of the activation capability a runtime run exercises. */
export interface ActivationProofClaim {
  readonly capability: ActivationCapability;
  readonly subject: string;
}

/** Deterministic freshness facts derived from canonical source and rendered locks. */
export interface ActivationProofIdentity {
  readonly adapterId: string;
  readonly declarationHash: string;
  readonly projectionHash: string;
  readonly sourceHash: string;
  readonly target: ActivationTarget;
}

/** App-owned retained runtime evidence that Core can evaluate without reading cache paths. */
export interface ActivationProofReceipt {
  readonly claimIds: readonly string[];
  readonly identity: ActivationProofIdentity;
  readonly outcome: ActivationProofReceiptOutcome;
  readonly runtimeVersion?: string;
  readonly schema: typeof ACTIVATION_PROOF_RECEIPT_SCHEMA;
}

export function validateActivationProofReceipt(
  value: unknown,
  root = "$"
): SkillsetSchemaValidationResult {
  const diagnostics: SkillsetSchemaDiagnostic[] = [];
  if (!isSchemaRecord(value)) {
    return validation([
      diagnostic(
        root,
        "schema/activation-proof-receipt/type",
        "activation proof receipt must be an object"
      ),
    ]);
  }

  checkKeys(
    value,
    ["claimIds", "identity", "outcome", "runtimeVersion", "schema"],
    root,
    diagnostics
  );
  checkRequiredKeys(
    value,
    ["claimIds", "identity", "outcome", "schema"],
    root,
    diagnostics
  );
  if (value.schema !== ACTIVATION_PROOF_RECEIPT_SCHEMA) {
    diagnostics.push(
      diagnostic(
        `${root}.schema`,
        "schema/activation-proof-receipt/version",
        `schema must be ${ACTIVATION_PROOF_RECEIPT_SCHEMA}`
      )
    );
  }
  checkUniqueStrings(value.claimIds, `${root}.claimIds`, diagnostics);
  checkIdentity(value.identity, `${root}.identity`, diagnostics);
  if (
    !ACTIVATION_PROOF_RECEIPT_OUTCOMES.includes(
      value.outcome as ActivationProofReceiptOutcome
    )
  ) {
    diagnostics.push(
      diagnostic(
        `${root}.outcome`,
        "schema/activation-proof-receipt/outcome",
        "outcome is not recognized"
      )
    );
  }
  if (
    value.runtimeVersion !== undefined &&
    (typeof value.runtimeVersion !== "string" ||
      value.runtimeVersion.length === 0)
  ) {
    diagnostics.push(
      diagnostic(
        `${root}.runtimeVersion`,
        "schema/activation-proof-receipt/runtime-version",
        "runtimeVersion must be a non-empty string when present"
      )
    );
  }
  return validation(diagnostics);
}

function checkIdentity(
  value: unknown,
  path: string,
  diagnostics: SkillsetSchemaDiagnostic[]
): void {
  if (!isSchemaRecord(value)) {
    diagnostics.push(
      diagnostic(
        path,
        "schema/activation-proof-receipt/identity",
        "identity must be an object"
      )
    );
    return;
  }
  checkKeys(
    value,
    [
      "adapterId",
      "declarationHash",
      "projectionHash",
      "sourceHash",
      "target",
    ],
    path,
    diagnostics
  );
  checkRequiredKeys(
    value,
    [
      "adapterId",
      "declarationHash",
      "projectionHash",
      "sourceHash",
      "target",
    ],
    path,
    diagnostics
  );
  for (const key of [
    "adapterId",
    "declarationHash",
    "projectionHash",
    "sourceHash",
  ] as const) {
    if (typeof value[key] !== "string" || value[key].length === 0) {
      diagnostics.push(
        diagnostic(
          `${path}.${key}`,
          "schema/activation-proof-receipt/identity",
          `${key} must be a non-empty string`
        )
      );
    }
  }
  if (!TARGET_NAMES.includes(value.target as ActivationTarget)) {
    diagnostics.push(
      diagnostic(
        `${path}.target`,
        "schema/activation-proof-receipt/target",
        "target is not recognized"
      )
    );
  }
}

function checkUniqueStrings(
  value: unknown,
  path: string,
  diagnostics: SkillsetSchemaDiagnostic[]
): void {
  if (!Array.isArray(value) || value.length === 0) {
    diagnostics.push(
      diagnostic(
        path,
        "schema/activation-proof-receipt/claim-ids",
        "claimIds must be a non-empty string array"
      )
    );
    return;
  }
  const strings = value.filter(
    (item): item is string => typeof item === "string" && item.length > 0
  );
  if (strings.length !== value.length) {
    diagnostics.push(
      diagnostic(
        path,
        "schema/activation-proof-receipt/claim-ids",
        "claimIds entries must be non-empty strings"
      )
    );
    return;
  }
  if (new Set(strings).size !== strings.length) {
    diagnostics.push(
      diagnostic(
        path,
        "schema/activation-proof-receipt/claim-ids-duplicate",
        "claimIds must be unique"
      )
    );
  }
}

function checkKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
  diagnostics: SkillsetSchemaDiagnostic[]
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      diagnostics.push(
        diagnostic(
          `${path}.${key}`,
          "schema/activation-proof-receipt/key",
          `unsupported key ${key}`
        )
      );
    }
  }
}

function checkRequiredKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  path: string,
  diagnostics: SkillsetSchemaDiagnostic[]
): void {
  for (const key of required) {
    if (!(key in value)) {
      diagnostics.push(
        diagnostic(
          path,
          "schema/activation-proof-receipt/required",
          `missing required key ${key}`
        )
      );
    }
  }
}

function diagnostic(
  path: string,
  code: string,
  message: string
): SkillsetSchemaDiagnostic {
  return { code, message, path };
}

function validation(
  diagnostics: readonly SkillsetSchemaDiagnostic[]
): SkillsetSchemaValidationResult {
  return { diagnostics, ok: diagnostics.length === 0 };
}
