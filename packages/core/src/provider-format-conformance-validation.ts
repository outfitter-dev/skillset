import {
  getProviderSchemaSnapshot,
  providerSchemaManualOverlays,
  type ProviderDestinationFormatSnapshotId,
  type ProviderJsonSchemaSummary,
  type ProviderSchemaManualOverlayId,
  type ProviderSchemaSnapshotId,
} from "@skillset/registry";

import { compareStrings } from "./path";
import type { JsonRecord, TargetName } from "./types";
import { isJsonRecord } from "./yaml";

const textDecoder = new TextDecoder();

export type ProviderFormatConformanceIssueCode =
  | "invalid-json"
  | "invalid-markdown"
  | "invalid-toml"
  | "invalid-shape"
  | "invalid-field-type"
  | "missing-required-field"
  | "unknown-destination-field";

export interface ProviderFormatConformanceIssue {
  readonly code: ProviderFormatConformanceIssueCode;
  readonly message: string;
  readonly outputPath: string;
  readonly providerRef: ProviderDestinationFormatSnapshotId | ProviderSchemaManualOverlayId | ProviderSchemaSnapshotId;
  readonly sourcePath?: string;
  readonly target: TargetName;
}

export interface ProviderFormatConformanceFile {
  readonly content: Uint8Array;
  readonly destination?: string;
  readonly featureId?: string;
  readonly path: string;
  readonly sourcePath?: string;
  readonly target?: TargetName;
}

export function parseJsonRecord(
  file: ProviderFormatConformanceFile,
  target: TargetName,
  providerRef: ProviderFormatConformanceIssue["providerRef"]
): { readonly issues: readonly ProviderFormatConformanceIssue[]; readonly ok: false } | { readonly ok: true; readonly value: JsonRecord } {
  try {
    const parsed = JSON.parse(textDecoder.decode(file.content)) as unknown;
    if (!isJsonRecord(parsed)) {
      return {
        issues: [issue(file, target, providerRef, "invalid-shape", "JSON content must be an object")],
        ok: false,
      };
    }
    return { ok: true, value: parsed };
  } catch (error) {
    return {
      issues: [issue(file, target, providerRef, "invalid-json", errorMessage(error))],
      ok: false,
    };
  }
}

export function parseTomlRecord(
  file: ProviderFormatConformanceFile,
  target: TargetName,
  providerRef: ProviderFormatConformanceIssue["providerRef"]
): { readonly issues: readonly ProviderFormatConformanceIssue[]; readonly ok: false } | { readonly ok: true; readonly value: JsonRecord } {
  try {
    const parsed = Bun.TOML.parse(textDecoder.decode(file.content)) as unknown;
    if (!isJsonRecord(parsed)) {
      return {
        issues: [issue(file, target, providerRef, "invalid-shape", "TOML content must be an object")],
        ok: false,
      };
    }
    return { ok: true, value: parsed };
  } catch (error) {
    return {
      issues: [issue(file, target, providerRef, "invalid-toml", errorMessage(error))],
      ok: false,
    };
  }
}

export function checkRequiredFields(
  file: ProviderFormatConformanceFile,
  value: JsonRecord,
  target: TargetName,
  providerRef: ProviderFormatConformanceIssue["providerRef"],
  requiredFields: readonly string[],
  prefix?: string
): readonly ProviderFormatConformanceIssue[] {
  return requiredFields
    .filter((field) => value[field] === undefined)
    .map((field) =>
      issue(
        file,
        target,
        providerRef,
        "missing-required-field",
        `missing required destination field ${prefix === undefined ? field : `${prefix}.${field}`}`
      )
    );
}

export function checkUnknownFields(
  file: ProviderFormatConformanceFile,
  value: JsonRecord,
  target: TargetName,
  providerRef: ProviderFormatConformanceIssue["providerRef"],
  allowedFields: readonly string[],
  prefix?: string
): readonly ProviderFormatConformanceIssue[] {
  const allowed = new Set(allowedFields);
  return Object.keys(value)
    .filter((field) => !allowed.has(field))
    .sort(compareStrings)
    .map((field) => {
      const label = prefix === undefined ? field : `${prefix}.${field}`;
      return issue(
        file,
        target,
        providerRef,
        "unknown-destination-field",
        `unknown destination field ${label}; allowed fields are ${[...allowed].sort(compareStrings).join(", ")}`
      );
    });
}

export type FieldType =
  | "array"
  | "boolean"
  | "number"
  | "object"
  | "string"
  | "string-array"
  | "string-object-or-array"
  | "string-or-array"
  | "string-or-string-array";

export function checkFieldTypes(
  file: ProviderFormatConformanceFile,
  value: JsonRecord,
  target: TargetName,
  providerRef: ProviderFormatConformanceIssue["providerRef"],
  fields: Readonly<Record<string, FieldType>>,
  prefix?: string
): readonly ProviderFormatConformanceIssue[] {
  const issues: ProviderFormatConformanceIssue[] = [];
  for (const [field, expected] of Object.entries(fields).sort(([left], [right]) => compareStrings(left, right))) {
    const actual = value[field];
    if (actual === undefined || matchesFieldType(actual, expected)) continue;
    const label = prefix === undefined ? field : `${prefix}.${field}`;
    issues.push(issue(
      file,
      target,
      providerRef,
      "invalid-field-type",
      `destination field ${label} must be ${fieldTypeLabel(expected)}`
    ));
  }
  return issues;
}

function matchesFieldType(value: unknown, expected: FieldType): boolean {
  if (expected === "array") return Array.isArray(value);
  if (expected === "boolean") return typeof value === "boolean";
  if (expected === "number") return typeof value === "number";
  if (expected === "object") return isJsonRecord(value);
  if (expected === "string") return typeof value === "string";
  if (expected === "string-array") {
    return Array.isArray(value) && value.every((entry) => typeof entry === "string");
  }
  if (expected === "string-or-array") {
    return typeof value === "string" || Array.isArray(value);
  }
  if (expected === "string-or-string-array") {
    return typeof value === "string" || (
      Array.isArray(value) && value.every((entry) => typeof entry === "string")
    );
  }
  return typeof value === "string" || isJsonRecord(value) || Array.isArray(value);
}

function fieldTypeLabel(expected: FieldType): string {
  if (expected === "array") return "an array";
  if (expected === "boolean") return "a boolean";
  if (expected === "number") return "a number";
  if (expected === "object") return "an object";
  if (expected === "string-array") return "an array of strings";
  if (expected === "string-or-array") return "a string or an array";
  if (expected === "string-or-string-array") return "a string or an array of strings";
  if (expected === "string-object-or-array") return "a string, an object, or an array";
  return "a string";
}

export function jsonSchemaSummary(id: ProviderSchemaSnapshotId): ProviderJsonSchemaSummary {
  const summary = getProviderSchemaSnapshot(id)?.summary;
  if (isJsonSchemaSummary(summary)) return summary;
  return { schemaUri: "", properties: [], required: [] };
}

function isJsonSchemaSummary(value: unknown): value is ProviderJsonSchemaSummary {
  return isJsonRecord(value) && typeof value.schemaUri === "string";
}

export function issue(
  file: ProviderFormatConformanceFile,
  target: TargetName,
  providerRef: ProviderFormatConformanceIssue["providerRef"],
  code: ProviderFormatConformanceIssueCode,
  message: string
): ProviderFormatConformanceIssue {
  const overlay = providerSchemaManualOverlays.find((item) => item.id === providerRef);
  return {
    code,
    message: overlay === undefined ? message : `${message} (${overlay.note})`,
    outputPath: file.path,
    providerRef,
    ...(file.sourcePath === undefined ? {} : { sourcePath: file.sourcePath }),
    target,
  };
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
