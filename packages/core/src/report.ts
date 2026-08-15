import { randomUUID } from "node:crypto";

import {
  REPORT_KINDS,
  REPORT_SCHEMA_VERSION,
  type SkillsetAdoptionReport,
  type SkillsetAdoptionReportPayload,
  type SkillsetExternalFixtureReport,
  type SkillsetExternalFixturePhase,
  type SkillsetExternalFixtureReportPayload,
  type SkillsetExternalFixtureReportWorkspace,
  type SkillsetImportReport,
  type SkillsetImportReportPayload,
  type SkillsetOperationReport,
  type SkillsetReport,
  type SkillsetReportEvidenceDescriptor,
  type SkillsetReportRenderResultCounts,
  type SkillsetReportWorkspace,
  type SkillsetTypedReportExitCode,
  type SkillsetTypedReportResult,
  validateSkillsetReport,
} from "@skillset/schema";

const REDACTED = "[REDACTED]";
const CREDENTIAL_PATTERNS = [
  /\b(?:github_pat_|gh[pousr]_)[A-Za-z0-9_]{16,}\b/g,
  /\b(?:npm_[A-Za-z0-9]{16,}|sk-[A-Za-z0-9_-]{16,})\b/g,
  /\bBearer\s+[A-Za-z0-9._~+\/-]{12,}\b/gi,
  /\b(?:api[_-]?key|password|secret|token)\s*[:=]\s*[^\s,;]+/gi,
] as const;

export interface CreateOperationReportInput {
  readonly command: string;
  readonly exitCode: number;
  readonly sentinels?: readonly string[] | undefined;
  readonly skillsetVersion: string;
  readonly workspace: SkillsetReportWorkspace;
}

interface CreateTypedReportInput<Payload> {
  readonly exitCode: SkillsetTypedReportExitCode;
  readonly payload: Payload;
  readonly sentinels?: readonly string[] | undefined;
  readonly skillsetVersion: string;
  readonly workspace: SkillsetReportWorkspace;
}

export type CreateAdoptionReportInput =
  CreateTypedReportInput<SkillsetAdoptionReportPayload>;

export type CreateImportReportInput =
  CreateTypedReportInput<SkillsetImportReportPayload>;

export type CreateExternalFixtureReportInput = Omit<
  CreateTypedReportInput<SkillsetExternalFixtureReportPayload>,
  "workspace"
> & {
  readonly workspace: SkillsetExternalFixtureReportWorkspace;
};

/** @internal Import only through `@skillset/core/internal/report` in focused tests. */
export interface CreateOperationReportOptions {
  /** Deterministic overrides reserved for focused tests. */
  readonly testHooks?: {
    readonly createdAt?: string | undefined;
    readonly id?: string | undefined;
  };
}

type ReportKind = SkillsetReport["kind"];
type ReportForKind<Kind extends ReportKind> = Extract<
  SkillsetReport,
  { readonly kind: Kind }
>;

export interface ReportKindDefinition<Kind extends ReportKind = ReportKind> {
  readonly kind: Kind;
  readonly renderPayload: (
    payload: ReportForKind<Kind>["payload"]
  ) => readonly string[];
  readonly sanitizePayload: (
    payload: ReportForKind<Kind>["payload"],
    sentinels: readonly string[]
  ) => ReportForKind<Kind>["payload"];
}

type AnyReportKindDefinition = {
  [Kind in ReportKind]: ReportKindDefinition<Kind>;
}[ReportKind];

export const reportKindRegistry: Readonly<{
  [Kind in (typeof REPORT_KINDS)[number]]: ReportKindDefinition<Kind>;
}> = Object.freeze({
  operation: Object.freeze({
    kind: "operation",
    renderPayload: () => [],
    sanitizePayload: () => ({}),
  }),
  adoption: Object.freeze({
    kind: "adoption",
    renderPayload: renderAdoptionPayload,
    sanitizePayload: cloneAdoptionPayload,
  }),
  import: Object.freeze({
    kind: "import",
    renderPayload: renderImportPayload,
    sanitizePayload: cloneImportPayload,
  }),
  "external-fixture": Object.freeze({
    kind: "external-fixture",
    renderPayload: renderExternalFixturePayload,
    sanitizePayload: cloneExternalFixturePayload,
  }),
});

export function getReportKindDefinition(
  kind: string
): AnyReportKindDefinition | undefined {
  return reportKindRegistry[kind as keyof typeof reportKindRegistry];
}

export function createOperationReport(
  input: CreateOperationReportInput,
  options: CreateOperationReportOptions = {}
): SkillsetOperationReport {
  const report: SkillsetOperationReport = {
    createdAt: options.testHooks?.createdAt ?? new Date().toISOString(),
    id: options.testHooks?.id ?? randomUUID(),
    kind: "operation",
    payload: {},
    result: {
      command: input.command,
      exitCode: input.exitCode,
      ok: input.exitCode === 0,
    },
    schemaVersion: REPORT_SCHEMA_VERSION,
    skillset: {
      version: input.skillsetVersion,
    },
    workspace: input.workspace,
  };
  return sanitizeAndValidateSkillsetReport(
    report,
    input.sentinels
  ) as SkillsetOperationReport;
}

export function createAdoptionReport(
  input: CreateAdoptionReportInput,
  options: CreateOperationReportOptions = {}
): SkillsetAdoptionReport {
  return createStructuredReport("adoption", input, options);
}

export function createImportReport(
  input: CreateImportReportInput,
  options: CreateOperationReportOptions = {}
): SkillsetImportReport {
  return createStructuredReport("import", input, options);
}

export function createExternalFixtureReport(
  input: CreateExternalFixtureReportInput,
  options: CreateOperationReportOptions = {}
): SkillsetExternalFixtureReport {
  return createStructuredReport("external-fixture", input, options);
}

function createStructuredReport(
  kind: "adoption",
  input: CreateAdoptionReportInput,
  options: CreateOperationReportOptions
): SkillsetAdoptionReport;
function createStructuredReport(
  kind: "import",
  input: CreateImportReportInput,
  options: CreateOperationReportOptions
): SkillsetImportReport;
function createStructuredReport(
  kind: "external-fixture",
  input: CreateExternalFixtureReportInput,
  options: CreateOperationReportOptions
): SkillsetExternalFixtureReport;
function createStructuredReport(
  kind: Exclude<SkillsetReport["kind"], "operation">,
  input:
    | CreateAdoptionReportInput
    | CreateExternalFixtureReportInput
    | CreateImportReportInput,
  options: CreateOperationReportOptions
):
  | SkillsetAdoptionReport
  | SkillsetExternalFixtureReport
  | SkillsetImportReport {
  const common = {
    createdAt: options.testHooks?.createdAt ?? new Date().toISOString(),
    id: options.testHooks?.id ?? randomUUID(),
    result: {
      command:
        kind === "adoption"
          ? "init.adopt"
          : kind === "import"
            ? "import"
            : "conformance.external",
      exitCode: input.exitCode,
      ok: input.exitCode === 0,
    },
    schemaVersion: REPORT_SCHEMA_VERSION,
    skillset: { version: input.skillsetVersion },
    workspace: input.workspace,
  } as const;
  const report = { ...common, kind, payload: input.payload };
  return sanitizeAndValidateSkillsetReport(report, input.sentinels) as
    | SkillsetAdoptionReport
    | SkillsetExternalFixtureReport
    | SkillsetImportReport;
}

export function sanitizeAndValidateSkillsetReport(
  value: unknown,
  sentinels: readonly string[] = []
): SkillsetReport {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("skillset: invalid report: report must be an object");
  }
  const scrubbedValue = scrubUnknown(value, sentinels);
  return validateAndNormalizeSkillsetReport(scrubbedValue);
}

export function validateAndNormalizeSkillsetReport(
  value: unknown
): SkillsetReport {
  const validation = validateSkillsetReport(value);
  if (!validation.ok) {
    throw new Error(
      `skillset: invalid report: ${validation.diagnostics
        .map((item) => `${item.path}: ${item.message}`)
        .join("; ")}`
    );
  }
  const source = value as SkillsetReport;
  const kind = source.kind;
  const definition =
    typeof kind === "string" ? getReportKindDefinition(kind) : undefined;
  if (definition === undefined) {
    throw new Error("skillset: invalid report: kind is not registered");
  }

  const common = {
    createdAt: source.createdAt,
    id: source.id,
    schemaVersion: source.schemaVersion as typeof REPORT_SCHEMA_VERSION,
    skillset: {
      version: source.skillset.version,
    },
    workspace: {
      id: source.workspace.id,
      ...(source.workspace.name === undefined
        ? {}
        : { name: source.workspace.name }),
      ...(source.workspace.repository === undefined
        ? {}
        : {
            repository: {
              ...(source.workspace.repository.commit === undefined
                ? {}
                : {
                    commit: source.workspace.repository.commit,
                  }),
              ...(source.workspace.repository.dirty === undefined
                ? {}
                : { dirty: source.workspace.repository.dirty }),
              identity: source.workspace.repository.identity,
            },
          }),
    },
  } as const;
  switch (source.kind) {
    case "operation":
      return {
        ...common,
        kind: "operation",
        payload: {},
        result: { ...source.result },
      };
    case "adoption":
      return {
        ...common,
        kind: "adoption",
        payload: reportKindRegistry.adoption.sanitizePayload(
          source.payload,
          []
        ),
        result: cloneTypedReportResult(source.result),
      };
    case "import":
      return {
        ...common,
        kind: "import",
        payload: reportKindRegistry.import.sanitizePayload(source.payload, []),
        result: cloneTypedReportResult(source.result),
      };
    case "external-fixture":
      return {
        ...common,
        kind: "external-fixture",
        payload: reportKindRegistry["external-fixture"].sanitizePayload(
          source.payload,
          []
        ),
        result: cloneTypedReportResult(source.result),
        workspace: common.workspace as SkillsetExternalFixtureReportWorkspace,
      };
  }
}

function cloneTypedReportResult<Command extends string>(
  result: SkillsetTypedReportResult<Command>
): SkillsetTypedReportResult<Command> {
  if (result.exitCode === 0) {
    return { command: result.command, exitCode: 0, ok: true };
  }
  return {
    command: result.command,
    exitCode: result.exitCode,
    ok: false,
  };
}

export function serializeSkillsetReport(report: SkillsetReport): string {
  return `${JSON.stringify(validateAndNormalizeSkillsetReport(report), null, 2)}\n`;
}

export function renderSkillsetReportMarkdown(report: SkillsetReport): string {
  const validated = validateAndNormalizeSkillsetReport(report);
  const lines = [
    "# Skillset Report",
    "",
    `- ID: ${renderInlineCode(validated.id)}`,
    `- Kind: ${renderInlineCode(validated.kind)}`,
    `- Created: ${renderInlineCode(validated.createdAt)}`,
    `- Skillset: ${renderInlineCode(validated.skillset.version)}`,
    `- Workspace: ${renderInlineCode(validated.workspace.id)}`,
  ];
  if (validated.workspace.name !== undefined) {
    lines.push(
      `- Workspace name: ${renderInlineCode(validated.workspace.name)}`
    );
  }
  if (validated.workspace.repository !== undefined) {
    lines.push(
      `- Repository: ${renderInlineCode(validated.workspace.repository.identity)}`
    );
    if (validated.workspace.repository.commit !== undefined) {
      lines.push(
        `- Commit: ${renderInlineCode(validated.workspace.repository.commit)}`
      );
    }
    if (validated.workspace.repository.dirty !== undefined) {
      lines.push(
        `- Dirty: ${validated.workspace.repository.dirty ? "yes" : "no"}`
      );
    }
  }
  lines.push(
    "",
    "## Result",
    "",
    `- Command: ${renderInlineCode(validated.result.command)}`,
    `- Outcome: ${validated.result.ok ? "success" : "failure"}`,
    `- Exit code: ${validated.result.exitCode}`
  );
  lines.push(...renderReportPayload(validated));
  return `${lines.join("\n")}\n`;
}

function renderReportPayload(report: SkillsetReport): readonly string[] {
  switch (report.kind) {
    case "operation":
      return reportKindRegistry.operation.renderPayload(report.payload);
    case "adoption":
      return reportKindRegistry.adoption.renderPayload(report.payload);
    case "import":
      return reportKindRegistry.import.renderPayload(report.payload);
    case "external-fixture":
      return reportKindRegistry["external-fixture"].renderPayload(
        report.payload
      );
  }
}

export function containsSensitiveReportContent(
  value: string,
  sentinels: readonly string[] = []
): boolean {
  if (
    sentinels.some(
      (sentinel) => sentinel.length > 0 && value.includes(sentinel)
    )
  ) {
    return true;
  }
  return CREDENTIAL_PATTERNS.some((pattern) => {
    pattern.lastIndex = 0;
    return pattern.test(value);
  });
}

function cloneEvidenceDescriptor(
  value: SkillsetReportEvidenceDescriptor
): SkillsetReportEvidenceDescriptor {
  return {
    available: value.available,
    bytes: value.bytes,
    entries: value.entries,
    id: value.id,
    sha256: value.sha256,
  };
}

function cloneRenderResultCounts(
  value: SkillsetReportRenderResultCounts
): SkillsetReportRenderResultCounts {
  return {
    failed: value.failed,
    rendered: value.rendered,
    skipped: value.skipped,
    unsupported: value.unsupported,
  };
}

function cloneAdoptionPayload(
  value: SkillsetAdoptionReportPayload
): SkillsetAdoptionReportPayload {
  return {
    alreadyAdopted: value.alreadyAdopted,
    candidateIds: [...value.candidateIds],
    destinations: [...value.destinations],
    diagnosticCodes: [...value.diagnosticCodes],
    importedUnitIds: [...value.importedUnitIds],
    ...(value.isolatedOutput === undefined
      ? {}
      : { isolatedOutput: cloneEvidenceDescriptor(value.isolatedOutput) }),
    listCounts: { ...value.listCounts },
    migrationFlagCodes: [...value.migrationFlagCodes],
    phases: {
      build: { ...value.phases.build },
      import: { ...value.phases.import },
      lint: { ...value.phases.lint },
      setup: { ...value.phases.setup },
    },
    renderResults: cloneRenderResultCounts(value.renderResults),
  };
}

function cloneImportPayload(
  value: SkillsetImportReportPayload
): SkillsetImportReportPayload {
  return {
    destinations: [...value.destinations],
    diagnosticCodes: [...value.diagnosticCodes],
    fields: {
      inferred: value.fields.inferred,
      preserved: value.fields.preserved,
      unsupported: value.fields.unsupported,
    },
    fileCount: value.fileCount,
    importedUnitIds: [...value.importedUnitIds],
    listCounts: { ...value.listCounts },
    partial: value.partial,
    requestedKind: value.requestedKind,
    ...(value.requestedProvider === undefined
      ? {}
      : { requestedProvider: value.requestedProvider }),
    renderResults: cloneRenderResultCounts(value.renderResults),
    warningCodes: [...value.warningCodes],
  };
}

function cloneExternalFixturePayload(
  value: SkillsetExternalFixtureReportPayload
): SkillsetExternalFixtureReportPayload {
  return {
    evidence: value.evidence.map(cloneEvidenceDescriptor),
    fixture: {
      manifestEntryCount: value.fixture.manifestEntryCount,
      manifestSha256: value.fixture.manifestSha256,
      name: value.fixture.name,
      pinnedCommit: value.fixture.pinnedCommit,
      repository: value.fixture.repository,
      targets: [...value.fixture.targets],
    },
    phases: {
      acquire: cloneExternalFixturePhase(value.phases.acquire),
      init: cloneExternalFixturePhase(value.phases.init),
      import: cloneExternalFixturePhase(value.phases.import),
      lint: cloneExternalFixturePhase(value.phases.lint),
      build: cloneExternalFixturePhase(value.phases.build),
      purity: cloneExternalFixturePhase(value.phases.purity),
      compare: cloneExternalFixturePhase(value.phases.compare),
    },
    pipelinePassed: value.pipelinePassed,
    runtime: { bunVersion: value.runtime.bunVersion },
    summaries: {
      comparisonDifferences: value.summaries.comparisonDifferences,
      importedUnits: value.summaries.importedUnits,
      migrationFlags: value.summaries.migrationFlags,
      renderResults: cloneRenderResultCounts(value.summaries.renderResults),
      surveyCandidates: value.summaries.surveyCandidates,
    },
  };
}

function cloneExternalFixturePhase(
  value: SkillsetExternalFixturePhase
): SkillsetExternalFixturePhase {
  return { exitClass: value.exitClass, status: value.status };
}

function renderAdoptionPayload(
  payload: SkillsetAdoptionReportPayload
): readonly string[] {
  return [
    "",
    "## Adoption",
    "",
    `- Already adopted: ${payload.alreadyAdopted ? "yes" : "no"}`,
    ...renderPhaseSummary("Setup", payload.phases.setup),
    ...renderPhaseSummary("Import", payload.phases.import),
    ...renderPhaseSummary("Lint", payload.phases.lint),
    ...renderPhaseSummary("Build", payload.phases.build),
    ...renderRenderResultCounts(payload.renderResults),
    `- Candidate IDs retained: ${payload.candidateIds.length}/${payload.listCounts.candidateIds}`,
    `- Imported units retained: ${payload.importedUnitIds.length}/${payload.listCounts.importedUnitIds}`,
    `- Destinations retained: ${payload.destinations.length}/${payload.listCounts.destinations}`,
    ...renderStringList("Candidate IDs", payload.candidateIds),
    ...renderStringList("Imported units", payload.importedUnitIds),
    ...renderStringList("Destinations", payload.destinations),
    ...renderStringList("Diagnostic codes", payload.diagnosticCodes),
    ...renderStringList("Migration flags", payload.migrationFlagCodes),
    ...(payload.isolatedOutput === undefined
      ? []
      : renderEvidenceDescriptor("Isolated output", payload.isolatedOutput)),
  ];
}

function renderImportPayload(
  payload: SkillsetImportReportPayload
): readonly string[] {
  return [
    "",
    "## Import",
    "",
    ...(payload.requestedProvider === undefined
      ? []
      : [
          `- Requested provider: ${renderInlineCode(payload.requestedProvider)}`,
        ]),
    `- Requested kind: ${renderInlineCode(payload.requestedKind)}`,
    `- Partial: ${payload.partial ? "yes" : "no"}`,
    `- Files: ${payload.fileCount}`,
    `- Imported units retained: ${payload.importedUnitIds.length}/${payload.listCounts.importedUnitIds}`,
    `- Destinations retained: ${payload.destinations.length}/${payload.listCounts.destinations}`,
    `- Inferred fields: ${payload.fields.inferred}`,
    `- Preserved fields: ${payload.fields.preserved}`,
    `- Unsupported fields: ${payload.fields.unsupported}`,
    ...renderRenderResultCounts(payload.renderResults),
    ...renderStringList("Imported units", payload.importedUnitIds),
    ...renderStringList("Destinations", payload.destinations),
    ...renderStringList("Diagnostic codes", payload.diagnosticCodes),
    ...renderStringList("Warning codes", payload.warningCodes),
  ];
}

function renderExternalFixturePayload(
  payload: SkillsetExternalFixtureReportPayload
): readonly string[] {
  return [
    "",
    "## External fixture",
    "",
    `- Fixture: ${renderInlineCode(payload.fixture.name)}`,
    `- Repository: ${renderInlineCode(payload.fixture.repository)}`,
    `- Pinned commit: ${renderInlineCode(payload.fixture.pinnedCommit)}`,
    `- Targets: ${payload.fixture.targets.map(renderInlineCode).join(", ")}`,
    `- Manifest SHA-256: ${renderInlineCode(payload.fixture.manifestSha256)}`,
    `- Manifest entries: ${payload.fixture.manifestEntryCount}`,
    `- Bun: ${renderInlineCode(payload.runtime.bunVersion)}`,
    `- Pipeline passed: ${payload.pipelinePassed ? "yes" : "no"}`,
    `- Survey candidates: ${payload.summaries.surveyCandidates}`,
    `- Imported units: ${payload.summaries.importedUnits}`,
    `- Migration flags: ${payload.summaries.migrationFlags}`,
    `- Comparison differences: ${payload.summaries.comparisonDifferences}`,
    ...renderRenderResultCounts(payload.summaries.renderResults),
    ...renderExternalFixturePhase("Acquire", payload.phases.acquire),
    ...renderExternalFixturePhase("Init", payload.phases.init),
    ...renderExternalFixturePhase("Import", payload.phases.import),
    ...renderExternalFixturePhase("Lint", payload.phases.lint),
    ...renderExternalFixturePhase("Build", payload.phases.build),
    ...renderExternalFixturePhase("Purity", payload.phases.purity),
    ...renderExternalFixturePhase("Compare", payload.phases.compare),
    ...payload.evidence.flatMap((descriptor) =>
      renderEvidenceDescriptor("Evidence", descriptor)
    ),
  ];
}

function renderExternalFixturePhase(
  label: string,
  phase: SkillsetExternalFixturePhase
): readonly string[] {
  return [
    `- Phase ${label}: ${renderInlineCode(phase.status)} (${renderInlineCode(phase.exitClass)})`,
  ];
}

function renderRenderResultCounts(
  counts: SkillsetReportRenderResultCounts
): readonly string[] {
  return [
    `- Rendered: ${counts.rendered}`,
    `- Unsupported: ${counts.unsupported}`,
    `- Failed: ${counts.failed}`,
    `- Skipped: ${counts.skipped}`,
  ];
}

function renderPhaseSummary(
  label: string,
  phase: SkillsetAdoptionReportPayload["phases"]["build"]
): readonly string[] {
  return [`- ${label}: ${renderInlineCode(phase.status)} (${phase.count})`];
}

function renderStringList(
  label: string,
  values: readonly string[]
): readonly string[] {
  return values.length === 0
    ? [`- ${label}: none`]
    : [`- ${label}: ${values.map(renderInlineCode).join(", ")}`];
}

function renderEvidenceDescriptor(
  label: string,
  descriptor: SkillsetReportEvidenceDescriptor
): readonly string[] {
  return [
    `- ${label}: ${renderInlineCode(descriptor.id)} (${descriptor.available ? "available" : "unavailable"}, ${descriptor.bytes} bytes, ${descriptor.entries} entries, sha256 ${renderInlineCode(descriptor.sha256)})`,
  ];
}

function scrubString(value: unknown, sentinels: readonly string[]): string {
  let scrubbed = typeof value === "string" ? value : "";
  for (const sentinel of sentinels) {
    if (sentinel.length > 0) scrubbed = scrubbed.replaceAll(sentinel, REDACTED);
  }
  for (const pattern of CREDENTIAL_PATTERNS) {
    pattern.lastIndex = 0;
    scrubbed = scrubbed.replace(pattern, REDACTED);
  }
  return scrubbed;
}

function scrubUnknown(value: unknown, sentinels: readonly string[]): unknown {
  if (typeof value === "string") return scrubString(value, sentinels);
  if (Array.isArray(value)) {
    return value.map((item) => scrubUnknown(item, sentinels));
  }
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      scrubUnknown(item, sentinels),
    ])
  );
}

function renderInlineCode(value: string): string {
  let longestRun = 0;
  let currentRun = 0;
  for (const character of value) {
    if (character === "`") {
      currentRun += 1;
      longestRun = Math.max(longestRun, currentRun);
    } else {
      currentRun = 0;
    }
  }
  const fence = "`".repeat(longestRun + 1);
  const pad =
    value.startsWith(" ") ||
    value.endsWith(" ") ||
    value.startsWith("`") ||
    value.endsWith("`")
      ? " "
      : "";
  return `${fence}${pad}${value}${pad}${fence}`;
}
