import { REPORT_KINDS, REPORT_SCHEMA_VERSION } from "./contracts";
import { isSchemaRecord } from "./json";
import type {
  SchemaJsonRecord,
  SkillsetReport,
  SkillsetSchemaDiagnostic,
  SkillsetSchemaValidationResult,
} from "./types";
import {
  createSemverRegExp,
  REPORT_REPOSITORY_IDENTITY_PATTERN,
  REPORT_WORKSPACE_NAME_PATTERN,
  WORKSPACE_ID_MAX_LENGTH,
  WORKSPACE_ID_PATTERN,
} from "./value-contracts";

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const TIMESTAMP_PATTERN =
  /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$/;
const workspaceIdPattern = new RegExp(WORKSPACE_ID_PATTERN, "u");
const workspaceNamePattern = new RegExp(REPORT_WORKSPACE_NAME_PATTERN, "u");
const COMMAND_PATTERN = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/;
const repositoryIdentityPattern = new RegExp(
  REPORT_REPOSITORY_IDENTITY_PATTERN,
  "u"
);
const FULL_GIT_SHA_PATTERN = /^[0-9a-f]{40}$/;
const semverPattern = createSemverRegExp();

export function isSkillsetReport(value: unknown): value is SkillsetReport {
  return validateSkillsetReport(value).ok;
}

export function validateSkillsetReport(
  value: unknown,
  root = "$"
): SkillsetSchemaValidationResult {
  const diagnostics: SkillsetSchemaDiagnostic[] = [];
  if (!isSchemaRecord(value)) {
    return validation([
      diagnostic(root, "schema/report/type", "report must be an object"),
    ]);
  }

  checkShape(
    value,
    [
      "createdAt",
      "id",
      "kind",
      "payload",
      "result",
      "schemaVersion",
      "skillset",
      "workspace",
    ],
    [
      "createdAt",
      "id",
      "kind",
      "payload",
      "result",
      "schemaVersion",
      "skillset",
      "workspace",
    ],
    root,
    diagnostics
  );
  if (value.schemaVersion !== REPORT_SCHEMA_VERSION) {
    diagnostics.push(
      diagnostic(
        `${root}.schemaVersion`,
        "schema/report/version",
        `schemaVersion must be ${REPORT_SCHEMA_VERSION}`
      )
    );
  }
  checkPattern(value.id, UUID_V4_PATTERN, `${root}.id`, "id", diagnostics);
  checkTimestamp(value.createdAt, `${root}.createdAt`, diagnostics);
  if (!REPORT_KINDS.includes(value.kind as (typeof REPORT_KINDS)[number])) {
    diagnostics.push(
      diagnostic(`${root}.kind`, "schema/report/kind", "kind is not registered")
    );
  }
  checkSkillset(value.skillset, `${root}.skillset`, diagnostics);
  checkWorkspace(value.workspace, `${root}.workspace`, diagnostics);
  checkResult(value.result, `${root}.result`, diagnostics);
  checkOperationPayload(value.payload, `${root}.payload`, diagnostics);
  return validation(diagnostics);
}

function checkSkillset(
  value: unknown,
  path: string,
  diagnostics: SkillsetSchemaDiagnostic[]
): void {
  if (!isSchemaRecord(value)) {
    diagnostics.push(
      diagnostic(path, "schema/report/skillset", "skillset must be an object")
    );
    return;
  }
  checkShape(value, ["version"], ["version"], path, diagnostics);
  checkPattern(
    value.version,
    semverPattern,
    `${path}.version`,
    "version",
    diagnostics
  );
}

function checkWorkspace(
  value: unknown,
  path: string,
  diagnostics: SkillsetSchemaDiagnostic[]
): void {
  if (!isSchemaRecord(value)) {
    diagnostics.push(
      diagnostic(path, "schema/report/workspace", "workspace must be an object")
    );
    return;
  }
  checkShape(value, ["id", "name", "repository"], ["id"], path, diagnostics);
  checkPattern(
    value.id,
    workspaceIdPattern,
    `${path}.id`,
    "workspace id",
    diagnostics,
    WORKSPACE_ID_MAX_LENGTH
  );
  if (value.name !== undefined) {
    checkBoundedString(
      value.name,
      `${path}.name`,
      "workspace name",
      diagnostics,
      160
    );
    if (typeof value.name === "string" && /[\r\n]/.test(value.name)) {
      diagnostics.push(
        diagnostic(
          `${path}.name`,
          "schema/report/workspace-name",
          "workspace name must be one line"
        )
      );
    }
    if (
      typeof value.name === "string" &&
      !workspaceNamePattern.test(value.name)
    ) {
      diagnostics.push(
        diagnostic(
          `${path}.name`,
          "schema/report/workspace-name",
          "workspace name must be a human-readable display name without path syntax, control characters, or Unicode line separators"
        )
      );
    }
  }
  if (value.repository !== undefined) {
    checkRepository(value.repository, `${path}.repository`, diagnostics);
  }
}

function checkRepository(
  value: unknown,
  path: string,
  diagnostics: SkillsetSchemaDiagnostic[]
): void {
  if (!isSchemaRecord(value)) {
    diagnostics.push(
      diagnostic(
        path,
        "schema/report/repository",
        "repository must be an object"
      )
    );
    return;
  }
  checkShape(
    value,
    ["commit", "dirty", "identity"],
    ["identity"],
    path,
    diagnostics
  );
  checkPattern(
    value.identity,
    repositoryIdentityPattern,
    `${path}.identity`,
    "repository identity",
    diagnostics,
    512
  );
  if (value.commit !== undefined) {
    checkPattern(
      value.commit,
      FULL_GIT_SHA_PATTERN,
      `${path}.commit`,
      "repository commit",
      diagnostics
    );
  }
  if (value.dirty !== undefined && typeof value.dirty !== "boolean") {
    diagnostics.push(
      diagnostic(
        `${path}.dirty`,
        "schema/report/repository-dirty",
        "repository dirty must be a boolean"
      )
    );
  }
}

function checkResult(
  value: unknown,
  path: string,
  diagnostics: SkillsetSchemaDiagnostic[]
): void {
  if (!isSchemaRecord(value)) {
    diagnostics.push(
      diagnostic(path, "schema/report/result", "result must be an object")
    );
    return;
  }
  checkShape(
    value,
    ["command", "exitCode", "ok"],
    ["command", "exitCode", "ok"],
    path,
    diagnostics
  );
  checkPattern(
    value.command,
    COMMAND_PATTERN,
    `${path}.command`,
    "command",
    diagnostics
  );
  if (!Number.isInteger(value.exitCode) || Number(value.exitCode) < 0) {
    diagnostics.push(
      diagnostic(
        `${path}.exitCode`,
        "schema/report/exit-code",
        "exitCode must be a non-negative integer"
      )
    );
  }
  if (typeof value.ok !== "boolean") {
    diagnostics.push(
      diagnostic(`${path}.ok`, "schema/report/ok", "ok must be a boolean")
    );
  } else if (
    Number.isInteger(value.exitCode) &&
    value.ok !== (value.exitCode === 0)
  ) {
    diagnostics.push(
      diagnostic(
        path,
        "schema/report/result-state",
        "ok must be true exactly when exitCode is zero"
      )
    );
  }
}

function checkOperationPayload(
  value: unknown,
  path: string,
  diagnostics: SkillsetSchemaDiagnostic[]
): void {
  if (!isSchemaRecord(value)) {
    diagnostics.push(
      diagnostic(path, "schema/report/payload", "payload must be an object")
    );
    return;
  }
  if (Object.keys(value).length > 0) {
    diagnostics.push(
      diagnostic(
        path,
        "schema/report/payload-key",
        "operation payload must be empty"
      )
    );
  }
}

function checkTimestamp(
  value: unknown,
  path: string,
  diagnostics: SkillsetSchemaDiagnostic[]
): void {
  if (typeof value !== "string" || !TIMESTAMP_PATTERN.test(value)) {
    diagnostics.push(
      diagnostic(
        path,
        "schema/report/timestamp",
        "createdAt must be a canonical UTC timestamp"
      )
    );
    return;
  }
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== value) {
    diagnostics.push(
      diagnostic(
        path,
        "schema/report/timestamp",
        "createdAt must be a real canonical UTC timestamp"
      )
    );
  }
}

function checkPattern(
  value: unknown,
  pattern: RegExp,
  path: string,
  label: string,
  diagnostics: SkillsetSchemaDiagnostic[],
  maxLength?: number
): void {
  if (
    typeof value !== "string" ||
    !pattern.test(value) ||
    (maxLength !== undefined && value.length > maxLength)
  ) {
    diagnostics.push(
      diagnostic(
        path,
        `schema/report/${label.replaceAll(" ", "-")}`,
        `${label} is invalid`
      )
    );
  }
}

function checkBoundedString(
  value: unknown,
  path: string,
  label: string,
  diagnostics: SkillsetSchemaDiagnostic[],
  maxLength: number
): void {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    Array.from(value).length > maxLength
  ) {
    diagnostics.push(
      diagnostic(
        path,
        `schema/report/${label.replaceAll(" ", "-")}`,
        `${label} must be a non-empty string no longer than ${maxLength} characters`
      )
    );
  }
}

function checkShape(
  value: SchemaJsonRecord,
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
          "schema/report/key",
          `unsupported report key ${key}`
        )
      );
    }
  }
  for (const key of required) {
    if (!(key in value)) {
      diagnostics.push(
        diagnostic(
          `${path}.${key}`,
          "schema/report/required",
          `${key} is required`
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
