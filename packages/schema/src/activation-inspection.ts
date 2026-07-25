import { isSchemaRecord } from "./json";
import type {
  ActivationCapability,
  ActivationObservationEffect,
  ActivationReadinessReport,
  ActivationTarget,
} from "./activation-readiness";
import {
  ACTIVATION_CAPABILITIES,
  ACTIVATION_OBSERVATION_EFFECTS,
  validateActivationReadinessReport,
} from "./activation-readiness";
import { TARGET_NAMES } from "./contracts";
import type {
  SkillsetSchemaDiagnostic,
  SkillsetSchemaValidationResult,
} from "./types";

export const ACTIVATION_INSPECTION_SCHEMA =
  "skillset.activation-inspection@1";

export const ACTIVATION_INSPECTION_OUTCOMES = [
  "malformed",
  "ran",
  "skipped",
  "timed_out",
  "unavailable",
] as const;

export type ActivationInspectionOutcome =
  (typeof ACTIVATION_INSPECTION_OUTCOMES)[number];

export interface ActivationInspectorReceipt {
  readonly binaryVersion?: string;
  readonly capability: ActivationCapability;
  readonly effect: ActivationObservationEffect;
  readonly inspectorId: string;
  readonly outcome: ActivationInspectionOutcome;
  readonly stderrBytes?: number;
  readonly stderrTruncated?: boolean;
  readonly stdoutBytes?: number;
  readonly stdoutTruncated?: boolean;
  readonly subjects: readonly string[];
  readonly summary: string;
  readonly target: ActivationTarget;
}

export interface ActivationInspectionReport {
  readonly inspections: readonly ActivationInspectorReceipt[];
  readonly readiness: ActivationReadinessReport;
  readonly schema: typeof ACTIVATION_INSPECTION_SCHEMA;
}

export function validateActivationInspectionReport(
  value: unknown,
  root = "$"
): SkillsetSchemaValidationResult {
  const diagnostics: SkillsetSchemaDiagnostic[] = [];
  if (!isSchemaRecord(value)) {
    return validation([
      diagnostic(
        root,
        "schema/activation-inspection/type",
        "activation inspection report must be an object"
      ),
    ]);
  }
  checkKeys(value, ["inspections", "readiness", "schema"], root, diagnostics);
  checkRequiredKeys(
    value,
    ["inspections", "readiness", "schema"],
    root,
    diagnostics
  );
  if (value.schema !== ACTIVATION_INSPECTION_SCHEMA) {
    diagnostics.push(
      diagnostic(
        `${root}.schema`,
        "schema/activation-inspection/version",
        `schema must be ${ACTIVATION_INSPECTION_SCHEMA}`
      )
    );
  }
  if (!Array.isArray(value.inspections)) {
    diagnostics.push(
      diagnostic(
        `${root}.inspections`,
        "schema/activation-inspection/inspections",
        "inspections must be an array"
      )
    );
  } else {
    for (const [index, receipt] of value.inspections.entries()) {
      checkReceipt(receipt, `${root}.inspections[${index}]`, diagnostics);
    }
  }
  diagnostics.push(
    ...validateActivationReadinessReport(
      value.readiness,
      `${root}.readiness`
    ).diagnostics
  );
  return validation(diagnostics);
}

function checkReceipt(
  value: unknown,
  path: string,
  diagnostics: SkillsetSchemaDiagnostic[]
): void {
  if (!isSchemaRecord(value)) {
    diagnostics.push(
      diagnostic(
        path,
        "schema/activation-inspection/receipt",
        "inspection receipt must be an object"
      )
    );
    return;
  }
  checkKeys(
    value,
    [
      "binaryVersion",
      "capability",
      "effect",
      "inspectorId",
      "outcome",
      "stderrBytes",
      "stderrTruncated",
      "stdoutBytes",
      "stdoutTruncated",
      "subjects",
      "summary",
      "target",
    ],
    path,
    diagnostics
  );
  checkRequiredKeys(
    value,
    [
      "capability",
      "effect",
      "inspectorId",
      "outcome",
      "subjects",
      "summary",
      "target",
    ],
    path,
    diagnostics
  );
  for (const key of ["inspectorId", "summary"] as const) {
    if (typeof value[key] !== "string" || value[key].length === 0) {
      diagnostics.push(
        diagnostic(
          `${path}.${key}`,
          "schema/activation-inspection/string",
          `${key} must be a non-empty string`
        )
      );
    }
  }
  if (
    value.binaryVersion !== undefined &&
    (typeof value.binaryVersion !== "string" ||
      value.binaryVersion.length === 0)
  ) {
    diagnostics.push(
      diagnostic(
        `${path}.binaryVersion`,
        "schema/activation-inspection/binary-version",
        "binaryVersion must be a non-empty string"
      )
    );
  }
  if (
    !ACTIVATION_INSPECTION_OUTCOMES.includes(
      value.outcome as ActivationInspectionOutcome
    )
  ) {
    diagnostics.push(
      diagnostic(
        `${path}.outcome`,
        "schema/activation-inspection/outcome",
        "outcome is not recognized"
      )
    );
  }
  for (const [key, values] of [
    ["capability", ACTIVATION_CAPABILITIES],
    ["effect", ACTIVATION_OBSERVATION_EFFECTS],
    ["target", TARGET_NAMES],
  ] as const) {
    if (!(values as readonly unknown[]).includes(value[key])) {
      diagnostics.push(
        diagnostic(
          `${path}.${key}`,
          `schema/activation-inspection/${key}`,
          `${key} is not recognized`
        )
      );
    }
  }
  if (
    !Array.isArray(value.subjects) ||
    value.subjects.some(
      (subject) => typeof subject !== "string" || subject.length === 0
    )
  ) {
    diagnostics.push(
      diagnostic(
        `${path}.subjects`,
        "schema/activation-inspection/subjects",
        "subjects must be non-empty strings"
      )
    );
  }
  if (
    Array.isArray(value.subjects) &&
    new Set(value.subjects).size !== value.subjects.length
  ) {
    diagnostics.push(
      diagnostic(
        `${path}.subjects`,
        "schema/activation-inspection/subjects-unique",
        "subjects must not contain duplicates"
      )
    );
  }
  for (const key of ["stderrBytes", "stdoutBytes"] as const) {
    if (
      value[key] !== undefined &&
      (!Number.isSafeInteger(value[key]) || Number(value[key]) < 0)
    ) {
      diagnostics.push(
        diagnostic(
          `${path}.${key}`,
          "schema/activation-inspection/bytes",
          `${key} must be a non-negative safe integer`
        )
      );
    }
  }
  for (const key of ["stderrTruncated", "stdoutTruncated"] as const) {
    if (value[key] !== undefined && typeof value[key] !== "boolean") {
      diagnostics.push(
        diagnostic(
          `${path}.${key}`,
          "schema/activation-inspection/truncated",
          `${key} must be a boolean`
        )
      );
    }
  }
}

function checkKeys(
  value: Readonly<Record<string, unknown>>,
  allowed: readonly string[],
  path: string,
  diagnostics: SkillsetSchemaDiagnostic[]
): void {
  const keys = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!keys.has(key)) {
      diagnostics.push(
        diagnostic(
          `${path}.${key}`,
          "schema/activation-inspection/key",
          `unknown activation inspection key ${key}`
        )
      );
    }
  }
}

function checkRequiredKeys(
  value: Readonly<Record<string, unknown>>,
  required: readonly string[],
  path: string,
  diagnostics: SkillsetSchemaDiagnostic[]
): void {
  for (const key of required) {
    if (value[key] === undefined) {
      diagnostics.push(
        diagnostic(
          `${path}.${key}`,
          "schema/activation-inspection/required",
          `${key} is required`
        )
      );
    }
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
