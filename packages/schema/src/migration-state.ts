import {
  MIGRATION_CODE_PATTERN, MIGRATION_FINGERPRINT_PATTERN, MIGRATION_FLAG_DISPOSITIONS,
  MIGRATION_FLAG_ID_PATTERN, MIGRATION_FLAG_SEVERITIES, MIGRATION_FLAG_STATES,
  MIGRATION_LOCATION_PATTERN, MIGRATION_MARKER_LABELS, MIGRATION_REPORT_ID_PATTERN,
  MIGRATION_STATE_SCHEMA_VERSION, MIGRATION_TIMESTAMP_PATTERN,
  migrationDecisionSchema, migrationEvidenceSchema, migrationFingerprintsSchema,
  migrationFlagProperties, migrationFlagRequired, migrationInlinePlacementSchema,
  migrationLocationSchema, migrationResolutionSchema, migrationSidecarPlacementSchema, migrationStateSchema,
} from "./migration-state-contract";
import { isSchemaRecord } from "./json";
import type { MigrationState } from "./migration-state-types";
import type { SchemaJsonRecord, SkillsetSchemaDiagnostic, SkillsetSchemaValidationResult } from "./types";

type Diagnostics = SkillsetSchemaDiagnostic[];

export function isMigrationState(value: unknown): value is MigrationState {
  return validateMigrationState(value).ok;
}

export function validateMigrationState(value: unknown, root = "$"): SkillsetSchemaValidationResult {
  const diagnostics: Diagnostics = [];
  if (shape(value, migrationStateSchema, root, diagnostics)) {
    if (value.schemaVersion !== MIGRATION_STATE_SCHEMA_VERSION) {
      invalid(diagnostics, `${root}.schemaVersion`, "version", `must be ${MIGRATION_STATE_SCHEMA_VERSION}`);
    }
    array(value.flags, `${root}.flags`, diagnostics, (flag, path) => checkFlag(flag, path, diagnostics));
  }
  return { ok: diagnostics.length === 0, diagnostics };
}

function checkFlag(value: unknown, path: string, diagnostics: Diagnostics): void {
  const schema = {
    properties: { ...migrationFlagProperties, resolution: migrationResolutionSchema },
    required: migrationFlagRequired,
  };
  if (!shape(value, schema, path, diagnostics)) return;
  pattern(value.id, MIGRATION_FLAG_ID_PATTERN, `${path}.id`, diagnostics);
  pattern(value.code, MIGRATION_CODE_PATTERN, `${path}.code`, diagnostics);
  oneOf(value.severity, MIGRATION_FLAG_SEVERITIES, `${path}.severity`, diagnostics);
  oneOf(value.state, MIGRATION_FLAG_STATES, `${path}.state`, diagnostics);
  oneOf(value.disposition, MIGRATION_FLAG_DISPOSITIONS, `${path}.disposition`, diagnostics);
  text(value.message, `${path}.message`, diagnostics);
  location(value.source, `${path}.source`, diagnostics);
  if (value.origin !== undefined) location(value.origin, `${path}.origin`, diagnostics);
  if (shape(value.fingerprints, migrationFingerprintsSchema, `${path}.fingerprints`, diagnostics)) {
    pattern(value.fingerprints.content, MIGRATION_FINGERPRINT_PATTERN, `${path}.fingerprints.content`, diagnostics);
    pattern(value.fingerprints.context, MIGRATION_FINGERPRINT_PATTERN, `${path}.fingerprints.context`, diagnostics);
  }
  placement(value.placement, `${path}.placement`, diagnostics);
  array(value.evidence, `${path}.evidence`, diagnostics, (entry, at) => {
    if (!shape(entry, migrationEvidenceSchema, at, diagnostics)) return;
    text(entry.summary, `${at}.summary`, diagnostics);
    if (entry.reference !== undefined) text(entry.reference, `${at}.reference`, diagnostics);
  });
  if (Array.isArray(value.evidence) && value.evidence.length === 0) {
    invalid(diagnostics, `${path}.evidence`, "evidence", "must retain at least one evidence item");
  }
  array(value.relatedReportIds, `${path}.relatedReportIds`, diagnostics, (entry, at) => pattern(entry, MIGRATION_REPORT_ID_PATTERN, at, diagnostics));
  if (Array.isArray(value.relatedReportIds) && new Set(value.relatedReportIds).size !== value.relatedReportIds.length) {
    invalid(diagnostics, `${path}.relatedReportIds`, "duplicate-report", "report IDs must be unique");
  }
  array(value.history, `${path}.history`, diagnostics, (entry, at) => {
    if (!shape(entry, migrationDecisionSchema, at, diagnostics)) return;
    oneOf(entry.state, ["accepted", "resolved"], `${at}.state`, diagnostics);
    resolutionFields(entry, at, diagnostics);
  });
  if (value.state === "open") {
    if (value.resolution !== undefined) invalid(diagnostics, `${path}.resolution`, "resolution", "an open flag must not carry a current resolution");
  } else if (value.state === "accepted" || value.state === "resolved") {
    if (shape(value.resolution, migrationResolutionSchema, `${path}.resolution`, diagnostics)) {
      resolutionFields(value.resolution, `${path}.resolution`, diagnostics);
    }
  }
}

function location(value: unknown, path: string, diagnostics: Diagnostics): void {
  if (!shape(value, migrationLocationSchema, path, diagnostics)) return;
  pattern(value.path, MIGRATION_LOCATION_PATTERN, `${path}.path`, diagnostics);
  for (const key of ["line", "column"]) {
    if (value[key] !== undefined) positiveInteger(value[key], `${path}.${key}`, diagnostics);
  }
}

function placement(value: unknown, path: string, diagnostics: Diagnostics): void {
  if (isSchemaRecord(value) && value.kind === "inline") {
    if (!shape(value, migrationInlinePlacementSchema, path, diagnostics)) return;
    oneOf(value.label, MIGRATION_MARKER_LABELS, `${path}.label`, diagnostics);
    positiveInteger(value.line, `${path}.line`, diagnostics);
  } else if (isSchemaRecord(value) && value.kind === "sidecar") {
    if (shape(value, migrationSidecarPlacementSchema, path, diagnostics)) text(value.reason, `${path}.reason`, diagnostics);
  } else invalid(diagnostics, path, "placement", "placement must be inline or sidecar with its required metadata");
}

function resolutionFields(value: SchemaJsonRecord, path: string, diagnostics: Diagnostics): void {
  text(value.reason, `${path}.reason`, diagnostics);
  pattern(value.at, MIGRATION_TIMESTAMP_PATTERN, `${path}.at`, diagnostics);
}

function shape(value: unknown, schema: SchemaJsonRecord, path: string, diagnostics: Diagnostics): value is SchemaJsonRecord {
  if (!isSchemaRecord(value)) {
    invalid(diagnostics, path, "type", "must be an object");
    return false;
  }
  const properties = schema.properties as SchemaJsonRecord;
  for (const key of Object.keys(value)) {
    if (!Object.hasOwn(properties, key)) invalid(diagnostics, `${path}.${key}`, "key", "unknown migration-state field");
  }
  for (const key of schema.required as string[]) {
    if (value[key] === undefined) invalid(diagnostics, `${path}.${key}`, "required", "required migration-state field is missing");
  }
  return true;
}

function array(value: unknown, path: string, diagnostics: Diagnostics, check: (entry: unknown, at: string) => void): void {
  if (!Array.isArray(value)) return invalid(diagnostics, path, "type", "must be an array");
  value.forEach((entry, index) => check(entry, `${path}[${index}]`));
}
function text(value: unknown, path: string, diagnostics: Diagnostics): void {
  if (typeof value !== "string" || value.trim().length === 0) invalid(diagnostics, path, "text", "must be a non-empty string");
}
function pattern(value: unknown, expression: string, path: string, diagnostics: Diagnostics): void {
  if (typeof value !== "string" || !new RegExp(expression, "u").test(value)) invalid(diagnostics, path, "format", "has an invalid migration-state format");
}
function oneOf(value: unknown, values: readonly string[], path: string, diagnostics: Diagnostics): void {
  if (typeof value !== "string" || !values.includes(value)) invalid(diagnostics, path, "value", `must be one of ${values.join(", ")}`);
}
function positiveInteger(value: unknown, path: string, diagnostics: Diagnostics): void {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) invalid(diagnostics, path, "position", "must be a positive integer");
}
function invalid(diagnostics: Diagnostics, path: string, kind: string, message: string): void {
  diagnostics.push({ code: `schema/migration-state/${kind}`, message, path });
}
