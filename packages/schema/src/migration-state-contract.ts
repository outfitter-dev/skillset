import type { SchemaJsonRecord } from "./types";

export const MIGRATION_STATE_SCHEMA_VERSION = "skillset.migration-state@1";
export const MIGRATION_FLAG_STATES = ["open", "accepted", "resolved"] as const;
export const MIGRATION_FLAG_SEVERITIES = ["error", "warning", "info"] as const;
export const MIGRATION_FLAG_DISPOSITIONS = [
  "proven-normalization", "ambiguous", "provider-native", "lossy-unsupported", "omitted-dependency-scope",
] as const;
export const MIGRATION_MARKER_LABELS = ["todo", "fix"] as const;
export const MIGRATION_FLAG_ID_PATTERN = "^adopt-[a-z0-9][a-z0-9-]{3,63}$";
export const MIGRATION_FINGERPRINT_PATTERN = "^sha256:[a-f0-9]{64}$";
export const MIGRATION_LOCATION_PATTERN = "^(?!/)(?![A-Za-z]:)(?!.*\\\\)(?!.*//)(?!.*(?:^|/)\\.{1,2}(?:/|$))(?!.*(?:^|/)\\.git(?:/|$))[^\\u0000-\\u001f/]+(?:/[^\\u0000-\\u001f/]+)*$";
export const MIGRATION_REPORT_ID_PATTERN = "^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$";
// Canonical UTC milliseconds, including Gregorian month lengths and leap years.
const leapYear = "(?:[0-9]{2}(?:0[48]|[2468][048]|[13579][26])|(?:0[048]|[2468][048]|[13579][26])00)";
const calendarDate = `(?:[0-9]{4}-(?:(?:01|03|05|07|08|10|12)-(?:0[1-9]|[12][0-9]|3[01])|(?:04|06|09|11)-(?:0[1-9]|[12][0-9]|30)|02-(?:0[1-9]|1[0-9]|2[0-8]))|${leapYear}-02-29)`;
export const MIGRATION_TIMESTAMP_PATTERN = `^${calendarDate}T(?:[01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]\\.[0-9]{3}Z$`;
export const MIGRATION_CODE_PATTERN = "^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$";
const text = { type: "string", minLength: 1, pattern: "\\S" };
const line = { type: "integer", minimum: 1 };
const fingerprint = { type: "string", pattern: MIGRATION_FINGERPRINT_PATTERN };

export const migrationLocationSchema: SchemaJsonRecord = {
  type: "object", additionalProperties: false, required: ["path"],
  properties: { path: { type: "string", pattern: MIGRATION_LOCATION_PATTERN }, line, column: line },
};
export const migrationFingerprintsSchema: SchemaJsonRecord = {
  type: "object", additionalProperties: false, required: ["content", "context"],
  properties: { content: fingerprint, context: fingerprint },
};
export const migrationResolutionSchema: SchemaJsonRecord = {
  type: "object", additionalProperties: false, required: ["reason", "at"],
  properties: { reason: text, at: { type: "string", pattern: MIGRATION_TIMESTAMP_PATTERN } },
};
export const migrationDecisionSchema: SchemaJsonRecord = {
  ...migrationResolutionSchema,
  required: ["state", "reason", "at"],
  properties: {
    ...(migrationResolutionSchema.properties as SchemaJsonRecord),
    state: { enum: ["accepted", "resolved"] },
  },
};
export const migrationEvidenceSchema: SchemaJsonRecord = {
  type: "object", additionalProperties: false, required: ["summary"],
  properties: { summary: text, reference: text },
};
export const migrationInlinePlacementSchema: SchemaJsonRecord = {
  type: "object", additionalProperties: false, required: ["kind", "label", "line"],
  properties: { kind: { const: "inline" }, label: { enum: [...MIGRATION_MARKER_LABELS] }, line },
};
export const migrationSidecarPlacementSchema: SchemaJsonRecord = {
  type: "object", additionalProperties: false, required: ["kind", "reason"],
  properties: { kind: { const: "sidecar" }, reason: text },
};
export const migrationFlagProperties: Record<string, SchemaJsonRecord> = {
  id: { type: "string", pattern: MIGRATION_FLAG_ID_PATTERN },
  code: { type: "string", pattern: MIGRATION_CODE_PATTERN },
  severity: { enum: [...MIGRATION_FLAG_SEVERITIES] },
  state: { enum: [...MIGRATION_FLAG_STATES] },
  disposition: { enum: [...MIGRATION_FLAG_DISPOSITIONS] },
  message: text,
  source: migrationLocationSchema,
  origin: migrationLocationSchema,
  fingerprints: migrationFingerprintsSchema,
  placement: { anyOf: [migrationInlinePlacementSchema, migrationSidecarPlacementSchema] },
  evidence: { type: "array", items: migrationEvidenceSchema, minItems: 1 },
  relatedReportIds: { type: "array", items: { type: "string", pattern: MIGRATION_REPORT_ID_PATTERN }, uniqueItems: true },
  history: { type: "array", items: migrationDecisionSchema },
};
export const migrationFlagRequired = Object.keys(migrationFlagProperties).filter((key) => key !== "origin");
export const migrationFlagSchema: SchemaJsonRecord = {
  anyOf: [
    { type: "object", additionalProperties: false, required: migrationFlagRequired,
      properties: { ...migrationFlagProperties, state: { const: "open" } } },
    { type: "object", additionalProperties: false, required: [...migrationFlagRequired, "resolution"],
      properties: { ...migrationFlagProperties, state: { enum: ["accepted", "resolved"] }, resolution: migrationResolutionSchema } },
  ],
};
export const migrationStateSchema: SchemaJsonRecord = {
  type: "object", additionalProperties: false, required: ["schemaVersion", "flags"],
  properties: {
    schemaVersion: { const: MIGRATION_STATE_SCHEMA_VERSION },
    flags: { type: "array", items: migrationFlagSchema },
  },
};
