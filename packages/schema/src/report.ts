import { IMPORT_CAPABILITY_CONSTRUCTS, IMPORT_CAPABILITY_ELIGIBILITIES, importCapabilityAssessmentSchema } from "./import-capability-assessment";
import { IMPORT_NORMALIZATION_CODES, IMPORT_NORMALIZATION_POINTER_PATTERN, importNormalizationSchema, importManifestRoundTripSchema } from "./import-normalization";
import { MIGRATION_LOCATION_PATTERN } from "./migration-state-contract";
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
  if (value.capabilityAssessments !== undefined) checkImportCapabilityAssessments(value.capabilityAssessments, `${path}.capabilityAssessments`, diagnostics);
  if (value.normalizations !== undefined) checkImportNormalizations(value.normalizations, `${path}.normalizations`, diagnostics);
  checkShape(
    value,
    [
      "capabilityAssessments",
      "normalizations",
      "skillCoalescing",
      "alreadyAdopted",
      "candidateIds",
      "cutover",
      "destinations",
      "diagnosticCodes",
      "importedUnitIds",
      "guidancePaths",
      "isolatedOutput",
      "listCounts",
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
      "listCounts",
      "migrationFlagCodes",
      "phases",
      "renderResults",
    ],
    path,
    diagnostics
  );
  if (value.cutover !== undefined && checkRecord(value.cutover, `${path}.cutover`, diagnostics)) {
    checkShape(value.cutover, ["paths", "total"], ["paths", "total"], `${path}.cutover`, diagnostics);
    checkRelativeIdList(value.cutover.paths, `${path}.cutover.paths`, diagnostics);
    checkBoundedCount(value.cutover.total, `${path}.cutover.total`, diagnostics);
    checkRetainedListCounts({ paths: value.cutover.total }, { paths: value.cutover.paths }, `${path}.cutover`, diagnostics);
  }
  if (value.skillCoalescing !== undefined) {
    if (!Array.isArray(value.skillCoalescing)) diagnostics.push(diagnostic(`${path}.skillCoalescing`, "schema/report/list", "skillCoalescing must be an array"));
    else value.skillCoalescing.forEach((entry, index) => {
      const itemPath = `${path}.skillCoalescing[${index}]`;
      if (!checkRecord(entry, itemPath, diagnostics)) return;
      checkShape(entry, ["destination", "sources", "selectedSource", "status", "reason"], ["destination", "sources", "status", "reason"], itemPath, diagnostics);
      checkPattern(entry.destination, new RegExp(MIGRATION_LOCATION_PATTERN, "u"), `${itemPath}.destination`, "source path", diagnostics, 256);
      checkStringList(entry.sources, `${itemPath}.sources`, new RegExp(MIGRATION_LOCATION_PATTERN, "u"), 256, diagnostics);
      if (entry.selectedSource !== undefined) checkPattern(entry.selectedSource, new RegExp(MIGRATION_LOCATION_PATTERN, "u"), `${itemPath}.selectedSource`, "source path", diagnostics, 256);
      checkEnum(entry.status, ["compatible", "conflict"], `${itemPath}.status`, diagnostics);
      checkBoundedString(entry.reason, `${itemPath}.reason`, "reason", diagnostics, 1024);
    });
  }
  checkBoolean(value.alreadyAdopted, `${path}.alreadyAdopted`, diagnostics);
  checkRelativeIdList(value.candidateIds, `${path}.candidateIds`, diagnostics);
  checkRelativeIdList(value.destinations, `${path}.destinations`, diagnostics);
  checkCodeList(value.diagnosticCodes, `${path}.diagnosticCodes`, diagnostics);
  checkRelativeIdList(
    value.importedUnitIds,
    `${path}.importedUnitIds`,
    diagnostics
  );
  if (value.guidancePaths !== undefined) checkRelativeIdList(value.guidancePaths, `${path}.guidancePaths`, diagnostics);
  if (value.isolatedOutput !== undefined) {
    checkEvidenceDescriptor(
      value.isolatedOutput,
      `${path}.isolatedOutput`,
      diagnostics
    );
  }
  checkListCounts(
    value.listCounts,
    ["candidateIds", "destinations", "importedUnitIds"],
    `${path}.listCounts`,
    diagnostics
  );
  checkRetainedListCounts(
    value.listCounts,
    {
      candidateIds: value.candidateIds,
      destinations: value.destinations,
      importedUnitIds: value.importedUnitIds,
    },
    `${path}.listCounts`,
    diagnostics
  );
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
  if (value.capabilityAssessments !== undefined) checkImportCapabilityAssessments(value.capabilityAssessments, `${path}.capabilityAssessments`, diagnostics);
  if (value.normalizations !== undefined) checkImportNormalizations(value.normalizations, `${path}.normalizations`, diagnostics);
  checkShape(
    value,
    [
      "capabilityAssessments",
      "normalizations",
      "destinations",
      "diagnosticCodes",
      "fields",
      "fileCount",
      "importedUnitIds",
      "listCounts",
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
      "listCounts",
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
  checkListCounts(
    value.listCounts,
    ["destinations", "importedUnitIds"],
    `${path}.listCounts`,
    diagnostics
  );
  checkRetainedListCounts(
    value.listCounts,
    {
      destinations: value.destinations,
      importedUnitIds: value.importedUnitIds,
    },
    `${path}.listCounts`,
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
    checkBoundedCount(value[key], `${path}.${key}`, diagnostics);
  }
}

function checkListCounts(
  value: unknown,
  keys: readonly string[],
  path: string,
  diagnostics: SkillsetSchemaDiagnostic[]
): void {
  if (!checkRecord(value, path, diagnostics)) return;
  checkShape(value, keys, keys, path, diagnostics);
  for (const key of keys) {
    checkBoundedCount(value[key], `${path}.${key}`, diagnostics);
  }
}

function checkRetainedListCounts(
  value: unknown,
  lists: Readonly<Record<string, unknown>>,
  path: string,
  diagnostics: SkillsetSchemaDiagnostic[]
): void {
  if (!isSchemaRecord(value)) return;
  for (const [key, list] of Object.entries(lists)) {
    const count = value[key];
    if (!Array.isArray(list) || typeof count !== "number" || !Number.isInteger(count))
      continue;
    const countIsImpossible =
      count < list.length || (list.length < 200 && count !== list.length);
    if (countIsImpossible) {
      diagnostics.push(
        diagnostic(
          `${path}.${key}`,
          "schema/report/list-count",
          list.length < 200
            ? `${key} count must equal the retained list below the 200-item cap`
            : `${key} count cannot be smaller than the retained list`
        )
      );
    }
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
    "manifestEntrySha256",
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
    value.manifestEntrySha256,
    SHA256_PATTERN,
    `${path}.manifestEntrySha256`,
    "sha256",
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
    repositoryIdentityPattern,
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

export function validateImportNormalizations(value: unknown, root = "$"): SkillsetSchemaValidationResult {
  const diagnostics: SkillsetSchemaDiagnostic[] = [];
  checkImportNormalizations(value, root, diagnostics);
  return validation(diagnostics);
}

function checkImportNormalizations(value: unknown, path: string, diagnostics: SkillsetSchemaDiagnostic[]): void {
  if (!Array.isArray(value)) {
    diagnostics.push(diagnostic(path, "schema/report/normalizations", "normalizations must be an array"));
    return;
  }
  const schema = importNormalizationSchema(TARGET_NAMES);
  for (const [index, entry] of value.entries()) {
    const at = `${path}[${index}]`;
    if (!checkRecord(entry, at, diagnostics)) continue;
    checkShape(entry, Object.keys(schema.properties as SchemaJsonRecord), schema.required as string[], at, diagnostics);
    checkEnum(entry.code, IMPORT_NORMALIZATION_CODES, `${at}.code`, diagnostics);
    checkEnum(entry.dialect, [...TARGET_NAMES, "agent-plugins"], `${at}.dialect`, diagnostics);
    checkEnum(entry.fidelity, ["unknown"], `${at}.fidelity`, diagnostics);
    if (!Number.isSafeInteger(entry.occurrences) || Number(entry.occurrences) < 1) diagnostics.push(diagnostic(`${at}.occurrences`, "schema/report/normalization-count", "occurrences must be a positive safe integer"));
    for (const key of ["source", "destination"]) {
      const location = entry[key];
      if (!checkRecord(location, `${at}.${key}`, diagnostics)) continue;
      checkShape(location, ["path", "pointer"], ["path", "pointer"], `${at}.${key}`, diagnostics);
      checkPattern(location.path, new RegExp(MIGRATION_LOCATION_PATTERN, "u"), `${at}.${key}.path`, "normalization path", diagnostics);
      checkPattern(location.pointer, new RegExp(IMPORT_NORMALIZATION_POINTER_PATTERN, "u"), `${at}.${key}.pointer`, "normalization pointer", diagnostics);
    }
    if (!Array.isArray(entry.evidence) || entry.evidence.length === 0 || entry.evidence.some((item) => typeof item !== "string" || item.length === 0)) diagnostics.push(diagnostic(`${at}.evidence`, "schema/report/normalization-evidence", "evidence must be a nonempty array of nonempty strings"));
    if (entry.roundTrip !== undefined) checkManifestRoundTrip(entry, at, diagnostics);
    if (entry.providerVersion !== undefined) checkPattern(entry.providerVersion, /[\s\S]+/u, `${at}.providerVersion`, "provider version", diagnostics);
    if (entry.observedAt !== undefined) checkPattern(entry.observedAt, /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/u, `${at}.observedAt`, "observed date", diagnostics);
  }
}


function checkManifestRoundTrip(entry: SchemaJsonRecord, path: string, diagnostics: SkillsetSchemaDiagnostic[]): void {
  const at = `${path}.roundTrip`;
  const proof = entry.roundTrip;
  if (!checkRecord(proof, at, diagnostics)) return;
  checkShape(proof, Object.keys(importManifestRoundTripSchema.properties as SchemaJsonRecord), importManifestRoundTripSchema.required as string[], at, diagnostics);
  checkEnum(proof.scope, ["claude-manifest-identity"], `${at}.scope`, diagnostics);
  checkEnum(proof.target, ["claude"], `${at}.target`, diagnostics);
  checkEnum(proof.fidelity, ["exact"], `${at}.fidelity`, diagnostics);
  for (const key of ["outputHash", "authorityHash"]) checkPattern(proof[key], /^sha256:[a-f0-9]{64}$/u, `${at}.${key}`, "evidence hash", diagnostics);
  if (!Array.isArray(proof.evidence) || proof.evidence.length === 0 || proof.evidence.some((item) => typeof item !== "string" || item.length === 0)) diagnostics.push(diagnostic(`${at}.evidence`, "schema/report/normalization-evidence", "evidence must be a nonempty array of nonempty strings"));
  if (!checkRecord(proof.output, `${at}.output`, diagnostics)) return;
  checkShape(proof.output, ["path", "pointer"], ["path", "pointer"], `${at}.output`, diagnostics);
  checkPattern(proof.output.path, new RegExp(MIGRATION_LOCATION_PATTERN, "u"), `${at}.output.path`, "output path", diagnostics);
  checkEnum(proof.output.pointer, ["/name", "/description"], `${at}.output.pointer`, diagnostics);
  const field = proof.output.pointer === "/name" ? "name" : "description";
  const source = entry.source as SchemaJsonRecord | undefined;
  const destination = entry.destination as SchemaJsonRecord | undefined;
  if (entry.code !== `manifest.${field}` || entry.dialect !== "claude" || entry.occurrences !== 1 || source?.path !== ".claude-plugin/plugin.json" || source?.pointer !== `/${field}` || destination?.pointer !== `/skillset/${field}`) {
    diagnostics.push(diagnostic(at, "schema/report/normalization-roundtrip", "exact metadata proof requires the matching direct Claude identity observation"));
  }
}

export function validateImportCapabilityAssessments(value: unknown, root = "$"): SkillsetSchemaValidationResult {
  const diagnostics: SkillsetSchemaDiagnostic[] = [];
  checkImportCapabilityAssessments(value, root, diagnostics);
  return validation(diagnostics);
}

function checkImportCapabilityAssessments(value: unknown, path: string, diagnostics: SkillsetSchemaDiagnostic[]): void {
  if (!Array.isArray(value)) {
    diagnostics.push(diagnostic(path, "schema/report/capability-assessments", "capabilityAssessments must be an array"));
    return;
  }
  const schema = importCapabilityAssessmentSchema(TARGET_NAMES);
  for (const [index, entry] of value.entries()) {
    const at = `${path}[${index}]`;
    if (!checkRecord(entry, at, diagnostics)) continue;
    checkShape(entry, Object.keys(schema.properties as SchemaJsonRecord), schema.required as string[], at, diagnostics);
    checkEnum(entry.construct, IMPORT_CAPABILITY_CONSTRUCTS, `${at}.construct`, diagnostics);
    checkEnum(entry.eligibility, IMPORT_CAPABILITY_ELIGIBILITIES, `${at}.eligibility`, diagnostics);
    checkEnum(entry.fidelity, ["unknown"], `${at}.fidelity`, diagnostics);
    checkEnum(entry.candidateTarget, TARGET_NAMES, `${at}.candidateTarget`, diagnostics);
    if (entry.sourceProvider !== undefined) checkEnum(entry.sourceProvider, [...TARGET_NAMES, "agent-plugins"], `${at}.sourceProvider`, diagnostics);
    if (checkRecord(entry.source, `${at}.source`, diagnostics)) {
      checkShape(entry.source, ["path", "pointer"], ["path", "pointer"], `${at}.source`, diagnostics);
      checkPattern(entry.source.path, new RegExp(MIGRATION_LOCATION_PATTERN, "u"), `${at}.source.path`, "capability source path", diagnostics);
      checkPattern(entry.source.pointer, new RegExp(IMPORT_NORMALIZATION_POINTER_PATTERN, "u"), `${at}.source.pointer`, "capability source pointer", diagnostics);
    }
    for (const key of ["capabilityId", "featureId", "judgmentScope"]) if (entry[key] !== undefined) checkPattern(entry[key], /[\s\S]+/u, `${at}.${key}`, key, diagnostics);
    if (entry.authorityHash !== undefined) checkPattern(entry.authorityHash, /^sha256:[a-f0-9]{64}$/u, `${at}.authorityHash`, "authority hash", diagnostics);
    for (const key of ["reasons", "evidence"]) if (!Array.isArray(entry[key]) || entry[key].length === 0 || entry[key].some((item: unknown) => typeof item !== "string" || item.length === 0)) diagnostics.push(diagnostic(`${at}.${key}`, "schema/report/capability-evidence", `${key} must be a nonempty array of nonempty strings`));
  }
}
