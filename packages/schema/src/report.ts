import {
  REPORT_EXTERNAL_FIXTURE_PHASES,
  REPORT_KINDS,
  REPORT_RELATIVE_ID_PATTERN,
  REPORT_SCHEMA_VERSION,
  TARGET_NAMES,
} from "./contracts";
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
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const REPORT_CODE_PATTERN = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/;
const REPORT_FIELD_PATTERN = /^[A-Za-z_][A-Za-z0-9_.-]*$/;
const reportRelativeIdPattern = new RegExp(REPORT_RELATIVE_ID_PATTERN, "u");
const FIXTURE_NAME_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;
const REPORT_PHASE_STATUSES = [
  "failed",
  "not-run",
  "passed",
  "skipped",
] as const;
const REPORT_EXIT_CLASSES = [
  "command-failure",
  "not-run",
  "signal",
  "success",
  "timeout",
] as const;
const REPORT_IMPORT_KINDS = [
  "auto",
  "plugin",
  "plugins",
  "skill",
  "skills",
] as const;
const REPORT_IMPORT_PROVIDERS = [
  "agents",
  ...TARGET_NAMES,
  "skillset",
] as const;
const REPORT_TARGETS = TARGET_NAMES;
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
  if (value.kind === "external-fixture") {
    checkExternalFixtureWorkspace(
      value.workspace,
      `${root}.workspace`,
      diagnostics
    );
  }
  checkResult(value.result, `${root}.result`, diagnostics);
  checkKindCommand(value.kind, value.result, `${root}.result`, diagnostics);
  checkPayload(value.kind, value.payload, `${root}.payload`, diagnostics);
  return validation(diagnostics);
}

function checkExternalFixtureWorkspace(
  value: unknown,
  path: string,
  diagnostics: SkillsetSchemaDiagnostic[]
): void {
  if (!isSchemaRecord(value) || !isSchemaRecord(value.repository)) {
    diagnostics.push(
      diagnostic(
        `${path}.repository`,
        "schema/report/fixture-repository",
        "external-fixture reports require Skillset checkout repository evidence"
      )
    );
    return;
  }
  if (value.repository.commit === undefined) {
    diagnostics.push(
      diagnostic(
        `${path}.repository.commit`,
        "schema/report/required",
        "commit is required"
      )
    );
  }
  if (value.repository.dirty === undefined) {
    diagnostics.push(
      diagnostic(
        `${path}.repository.dirty`,
        "schema/report/required",
        "dirty is required"
      )
    );
  }
}

function checkKindCommand(
  kind: unknown,
  result: unknown,
  path: string,
  diagnostics: SkillsetSchemaDiagnostic[]
): void {
  if (!isSchemaRecord(result)) return;
  const requiredCommand =
    kind === "adoption"
      ? "init.adopt"
      : kind === "import"
        ? "import"
        : kind === "external-fixture"
          ? "conformance.external"
          : undefined;
  if (requiredCommand !== undefined && result.command !== requiredCommand) {
    diagnostics.push(
      diagnostic(
        `${path}.command`,
        "schema/report/kind-command",
        `${kind} reports must use command ${requiredCommand}`
      )
    );
  }
  if (
    requiredCommand !== undefined &&
    Number.isInteger(result.exitCode) &&
    Number(result.exitCode) > 4
  ) {
    diagnostics.push(
      diagnostic(
        `${path}.exitCode`,
        "schema/report/typed-exit-code",
        "typed report exitCode must be 0, 1, 2, 3, or 4"
      )
    );
  }
}

function checkPayload(
  kind: unknown,
  value: unknown,
  path: string,
  diagnostics: SkillsetSchemaDiagnostic[]
): void {
  switch (kind) {
    case "operation":
      checkOperationPayload(value, path, diagnostics);
      break;
    case "adoption":
      checkAdoptionPayload(value, path, diagnostics);
      break;
    case "import":
      checkImportPayload(value, path, diagnostics);
      break;
    case "external-fixture":
      checkExternalFixturePayload(value, path, diagnostics);
      break;
    default:
      if (!isSchemaRecord(value)) {
        diagnostics.push(
          diagnostic(path, "schema/report/payload", "payload must be an object")
        );
      }
  }
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

function checkAdoptionPayload(
  value: unknown,
  path: string,
  diagnostics: SkillsetSchemaDiagnostic[]
): void {
  if (!checkRecord(value, path, diagnostics)) return;
  checkShape(
    value,
    [
      "alreadyAdopted",
      "candidateIds",
      "destinations",
      "diagnosticCodes",
      "importedUnitIds",
      "isolatedOutput",
      "migrationFlagCodes",
      "phases",
      "renderResults",
    ],
    [
      "alreadyAdopted",
      "candidateIds",
      "destinations",
      "diagnosticCodes",
      "importedUnitIds",
      "migrationFlagCodes",
      "phases",
      "renderResults",
    ],
    path,
    diagnostics
  );
  checkBoolean(value.alreadyAdopted, `${path}.alreadyAdopted`, diagnostics);
  checkRelativeIdList(value.candidateIds, `${path}.candidateIds`, diagnostics);
  checkRelativeIdList(value.destinations, `${path}.destinations`, diagnostics);
  checkCodeList(value.diagnosticCodes, `${path}.diagnosticCodes`, diagnostics);
  checkRelativeIdList(
    value.importedUnitIds,
    `${path}.importedUnitIds`,
    diagnostics
  );
  if (value.isolatedOutput !== undefined) {
    checkEvidenceDescriptor(
      value.isolatedOutput,
      `${path}.isolatedOutput`,
      diagnostics
    );
  }
  checkCodeList(
    value.migrationFlagCodes,
    `${path}.migrationFlagCodes`,
    diagnostics
  );
  checkAdoptionPhases(value.phases, `${path}.phases`, diagnostics);
  checkRenderResultCounts(
    value.renderResults,
    `${path}.renderResults`,
    diagnostics
  );
}

function checkImportPayload(
  value: unknown,
  path: string,
  diagnostics: SkillsetSchemaDiagnostic[]
): void {
  if (!checkRecord(value, path, diagnostics)) return;
  checkShape(
    value,
    [
      "destinations",
      "diagnosticCodes",
      "fields",
      "fileCount",
      "importedUnitIds",
      "partial",
      "requestedKind",
      "requestedProvider",
      "renderResults",
      "warningCodes",
    ],
    [
      "destinations",
      "diagnosticCodes",
      "fields",
      "fileCount",
      "importedUnitIds",
      "partial",
      "requestedKind",
      "renderResults",
      "warningCodes",
    ],
    path,
    diagnostics
  );
  checkRelativeIdList(value.destinations, `${path}.destinations`, diagnostics);
  checkCodeList(value.diagnosticCodes, `${path}.diagnosticCodes`, diagnostics);
  checkFieldClassifications(value.fields, `${path}.fields`, diagnostics);
  checkBoundedCount(value.fileCount, `${path}.fileCount`, diagnostics);
  checkRelativeIdList(
    value.importedUnitIds,
    `${path}.importedUnitIds`,
    diagnostics
  );
  checkBoolean(value.partial, `${path}.partial`, diagnostics);
  checkEnum(
    value.requestedKind,
    REPORT_IMPORT_KINDS,
    `${path}.requestedKind`,
    diagnostics
  );
  if (value.requestedProvider !== undefined) {
    checkEnum(
      value.requestedProvider,
      REPORT_IMPORT_PROVIDERS,
      `${path}.requestedProvider`,
      diagnostics
    );
  }
  checkRenderResultCounts(
    value.renderResults,
    `${path}.renderResults`,
    diagnostics
  );
  checkCodeList(value.warningCodes, `${path}.warningCodes`, diagnostics);
}

function checkExternalFixturePayload(
  value: unknown,
  path: string,
  diagnostics: SkillsetSchemaDiagnostic[]
): void {
  if (!checkRecord(value, path, diagnostics)) return;
  checkShape(
    value,
    ["evidence", "fixture", "phases", "pipelinePassed", "runtime", "summaries"],
    ["evidence", "fixture", "phases", "pipelinePassed", "runtime", "summaries"],
    path,
    diagnostics
  );
  checkEvidenceList(value.evidence, `${path}.evidence`, diagnostics);
  checkFixtureIdentity(value.fixture, `${path}.fixture`, diagnostics);
  checkBoolean(value.pipelinePassed, `${path}.pipelinePassed`, diagnostics);
  checkFixtureRuntime(value.runtime, `${path}.runtime`, diagnostics);
  const allPhasesPassed = checkFixturePhases(
    value.phases,
    `${path}.phases`,
    diagnostics
  );
  if (
    allPhasesPassed !== undefined &&
    typeof value.pipelinePassed === "boolean" &&
    value.pipelinePassed !== allPhasesPassed
  ) {
    diagnostics.push(
      diagnostic(
        `${path}.pipelinePassed`,
        "schema/report/pipeline-state",
        "pipelinePassed must be true exactly when every required phase passed"
      )
    );
  }
  checkFixtureSummaries(value.summaries, `${path}.summaries`, diagnostics);
}

function checkAdoptionPhases(
  value: unknown,
  path: string,
  diagnostics: SkillsetSchemaDiagnostic[]
): void {
  if (!checkRecord(value, path, diagnostics)) return;
  const keys = ["build", "import", "lint", "setup"] as const;
  checkShape(value, keys, keys, path, diagnostics);
  for (const key of keys) {
    checkPhaseSummary(value[key], `${path}.${key}`, diagnostics);
  }
}

function checkPhaseSummary(
  value: unknown,
  path: string,
  diagnostics: SkillsetSchemaDiagnostic[]
): void {
  if (!checkRecord(value, path, diagnostics)) return;
  const keys = ["count", "status"] as const;
  checkShape(value, keys, keys, path, diagnostics);
  checkBoundedCount(value.count, `${path}.count`, diagnostics);
  checkEnum(value.status, REPORT_PHASE_STATUSES, `${path}.status`, diagnostics);
}

function checkFieldClassifications(
  value: unknown,
  path: string,
  diagnostics: SkillsetSchemaDiagnostic[]
): void {
  if (!checkRecord(value, path, diagnostics)) return;
  const keys = ["inferred", "preserved", "unsupported"] as const;
  checkShape(value, keys, keys, path, diagnostics);
  for (const key of keys) {
    checkStringList(
      value[key],
      `${path}.${key}`,
      REPORT_FIELD_PATTERN,
      96,
      diagnostics
    );
  }
}

function checkRenderResultCounts(
  value: unknown,
  path: string,
  diagnostics: SkillsetSchemaDiagnostic[]
): void {
  if (!checkRecord(value, path, diagnostics)) return;
  const keys = ["failed", "rendered", "skipped", "unsupported"] as const;
  checkShape(value, keys, keys, path, diagnostics);
  for (const key of keys) {
    checkBoundedCount(value[key], `${path}.${key}`, diagnostics);
  }
}

function checkEvidenceDescriptor(
  value: unknown,
  path: string,
  diagnostics: SkillsetSchemaDiagnostic[]
): void {
  if (!checkRecord(value, path, diagnostics)) return;
  const keys = ["available", "bytes", "entries", "id", "sha256"] as const;
  checkShape(value, keys, keys, path, diagnostics);
  checkBoolean(value.available, `${path}.available`, diagnostics);
  if (!Number.isSafeInteger(value.bytes) || Number(value.bytes) < 0) {
    diagnostics.push(
      diagnostic(
        `${path}.bytes`,
        "schema/report/count",
        "bytes must be a non-negative safe integer"
      )
    );
  }
  checkBoundedCount(value.entries, `${path}.entries`, diagnostics);
  checkRelativeId(value.id, `${path}.id`, diagnostics);
  checkPattern(
    value.sha256,
    SHA256_PATTERN,
    `${path}.sha256`,
    "sha256",
    diagnostics
  );
}

function checkEvidenceList(
  value: unknown,
  path: string,
  diagnostics: SkillsetSchemaDiagnostic[]
): void {
  if (!Array.isArray(value) || value.length > 40) {
    diagnostics.push(
      diagnostic(
        path,
        "schema/report/list",
        "evidence must be an array with at most 40 items"
      )
    );
    return;
  }
  value.forEach((item, index) =>
    checkEvidenceDescriptor(item, `${path}[${index}]`, diagnostics)
  );
}

function checkFixtureIdentity(
  value: unknown,
  path: string,
  diagnostics: SkillsetSchemaDiagnostic[]
): void {
  if (!checkRecord(value, path, diagnostics)) return;
  const keys = [
    "manifestEntryCount",
    "manifestSha256",
    "name",
    "pinnedCommit",
    "repository",
    "targets",
  ] as const;
  checkShape(value, keys, keys, path, diagnostics);
  checkBoundedCount(
    value.manifestEntryCount,
    `${path}.manifestEntryCount`,
    diagnostics
  );
  checkPattern(
    value.manifestSha256,
    SHA256_PATTERN,
    `${path}.manifestSha256`,
    "sha256",
    diagnostics
  );
  checkPattern(
    value.name,
    FIXTURE_NAME_PATTERN,
    `${path}.name`,
    "fixture name",
    diagnostics,
    160
  );
  checkPattern(
    value.pinnedCommit,
    FULL_GIT_SHA_PATTERN,
    `${path}.pinnedCommit`,
    "repository commit",
    diagnostics
  );
  checkPattern(
    value.repository,
    REPOSITORY_IDENTITY_PATTERN,
    `${path}.repository`,
    "repository identity",
    diagnostics,
    512
  );
  checkEnumList(
    value.targets,
    REPORT_TARGETS,
    `${path}.targets`,
    diagnostics,
    3,
    true
  );
}

function checkFixtureRuntime(
  value: unknown,
  path: string,
  diagnostics: SkillsetSchemaDiagnostic[]
): void {
  if (!checkRecord(value, path, diagnostics)) return;
  const keys = ["bunVersion"] as const;
  checkShape(value, keys, keys, path, diagnostics);
  checkPattern(
    value.bunVersion,
    semverPattern,
    `${path}.bunVersion`,
    "version",
    diagnostics
  );
}

function checkFixturePhases(
  value: unknown,
  path: string,
  diagnostics: SkillsetSchemaDiagnostic[]
): boolean | undefined {
  if (!checkRecord(value, path, diagnostics)) return undefined;
  checkShape(
    value,
    REPORT_EXTERNAL_FIXTURE_PHASES,
    REPORT_EXTERNAL_FIXTURE_PHASES,
    path,
    diagnostics
  );
  let complete = true;
  let allPassed = true;
  for (const phase of REPORT_EXTERNAL_FIXTURE_PHASES) {
    const phaseValue = value[phase];
    const phasePath = `${path}.${phase}`;
    if (!checkRecord(phaseValue, phasePath, diagnostics)) {
      complete = false;
      continue;
    }
    const keys = ["exitClass", "status"] as const;
    checkShape(phaseValue, keys, keys, phasePath, diagnostics);
    checkEnum(
      phaseValue.exitClass,
      REPORT_EXIT_CLASSES,
      `${phasePath}.exitClass`,
      diagnostics
    );
    checkEnum(
      phaseValue.status,
      REPORT_PHASE_STATUSES,
      `${phasePath}.status`,
      diagnostics
    );
    if (
      typeof phaseValue.exitClass === "string" &&
      typeof phaseValue.status === "string" &&
      !phaseStateMatches(phaseValue.status, phaseValue.exitClass)
    ) {
      diagnostics.push(
        diagnostic(
          phasePath,
          "schema/report/phase-state",
          "phase status and exitClass disagree"
        )
      );
    }
    allPassed &&= phaseValue.status === "passed";
  }
  return complete ? allPassed : undefined;
}

function phaseStateMatches(status: string, exitClass: string): boolean {
  if (status === "passed") return exitClass === "success";
  if (status === "not-run" || status === "skipped") {
    return exitClass === "not-run";
  }
  if (status === "failed") {
    return ["command-failure", "signal", "timeout"].includes(exitClass);
  }
  return false;
}

function checkFixtureSummaries(
  value: unknown,
  path: string,
  diagnostics: SkillsetSchemaDiagnostic[]
): void {
  if (!checkRecord(value, path, diagnostics)) return;
  const keys = [
    "comparisonDifferences",
    "importedUnits",
    "migrationFlags",
    "renderResults",
    "surveyCandidates",
  ] as const;
  checkShape(value, keys, keys, path, diagnostics);
  for (const key of [
    "comparisonDifferences",
    "importedUnits",
    "migrationFlags",
    "surveyCandidates",
  ] as const) {
    checkBoundedCount(value[key], `${path}.${key}`, diagnostics);
  }
  checkRenderResultCounts(
    value.renderResults,
    `${path}.renderResults`,
    diagnostics
  );
}

function checkRecord(
  value: unknown,
  path: string,
  diagnostics: SkillsetSchemaDiagnostic[]
): value is SchemaJsonRecord {
  if (isSchemaRecord(value)) return true;
  diagnostics.push(
    diagnostic(path, "schema/report/payload", "payload value must be an object")
  );
  return false;
}

function checkBoolean(
  value: unknown,
  path: string,
  diagnostics: SkillsetSchemaDiagnostic[]
): void {
  if (typeof value !== "boolean")
    diagnostics.push(
      diagnostic(path, "schema/report/boolean", "value must be a boolean")
    );
}

function checkBoundedCount(
  value: unknown,
  path: string,
  diagnostics: SkillsetSchemaDiagnostic[]
): void {
  if (
    !Number.isInteger(value) ||
    Number(value) < 0 ||
    Number(value) > 1_000_000
  ) {
    diagnostics.push(
      diagnostic(
        path,
        "schema/report/count",
        "count must be an integer from 0 through 1000000"
      )
    );
  }
}

function checkRelativeId(
  value: unknown,
  path: string,
  diagnostics: SkillsetSchemaDiagnostic[]
): void {
  if (
    typeof value !== "string" ||
    value.length > 256 ||
    !reportRelativeIdPattern.test(value)
  ) {
    diagnostics.push(
      diagnostic(
        path,
        "schema/report/relative-id",
        "relative identity is invalid"
      )
    );
  }
}

function checkRelativeIdList(
  value: unknown,
  path: string,
  diagnostics: SkillsetSchemaDiagnostic[]
): void {
  if (!Array.isArray(value) || value.length > 200) {
    diagnostics.push(
      diagnostic(
        path,
        "schema/report/list",
        "value must be an array with at most 200 items"
      )
    );
    return;
  }
  const seen = new Set<string>();
  value.forEach((item, index) => {
    checkRelativeId(item, `${path}[${index}]`, diagnostics);
    checkUniqueString(item, seen, `${path}[${index}]`, diagnostics);
  });
}

function checkCodeList(
  value: unknown,
  path: string,
  diagnostics: SkillsetSchemaDiagnostic[]
): void {
  checkStringList(value, path, REPORT_CODE_PATTERN, 96, diagnostics);
}

function checkStringList(
  value: unknown,
  path: string,
  pattern: RegExp,
  maxLength: number,
  diagnostics: SkillsetSchemaDiagnostic[]
): void {
  if (!Array.isArray(value) || value.length > 200) {
    diagnostics.push(
      diagnostic(
        path,
        "schema/report/list",
        "value must be an array with at most 200 items"
      )
    );
    return;
  }
  const seen = new Set<string>();
  value.forEach((item, index) => {
    checkPattern(
      item,
      pattern,
      `${path}[${index}]`,
      "bounded identifier",
      diagnostics,
      maxLength
    );
    checkUniqueString(item, seen, `${path}[${index}]`, diagnostics);
  });
}

function checkEnumList<T extends string>(
  value: unknown,
  allowed: readonly T[],
  path: string,
  diagnostics: SkillsetSchemaDiagnostic[],
  maxItems: number,
  nonEmpty = false
): void {
  if (
    !Array.isArray(value) ||
    value.length > maxItems ||
    (nonEmpty && value.length === 0)
  ) {
    diagnostics.push(
      diagnostic(path, "schema/report/list", "value has an invalid item count")
    );
    return;
  }
  const seen = new Set<string>();
  value.forEach((item, index) => {
    checkEnum(item, allowed, `${path}[${index}]`, diagnostics);
    checkUniqueString(item, seen, `${path}[${index}]`, diagnostics);
  });
}

function checkEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  path: string,
  diagnostics: SkillsetSchemaDiagnostic[]
): void {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    diagnostics.push(
      diagnostic(path, "schema/report/enum", "value is not allowed")
    );
  }
}

function checkUniqueString(
  value: unknown,
  seen: Set<string>,
  path: string,
  diagnostics: SkillsetSchemaDiagnostic[]
): void {
  if (typeof value !== "string") return;
  if (seen.has(value))
    diagnostics.push(
      diagnostic(path, "schema/report/unique", "list items must be unique")
    );
  seen.add(value);
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
