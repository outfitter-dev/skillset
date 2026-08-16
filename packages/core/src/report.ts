import { randomUUID } from "node:crypto";

import {
  REPORT_KINDS,
  REPORT_SCHEMA_VERSION,
  type SkillsetOperationReport,
  type SkillsetReport,
  type SkillsetReportWorkspace,
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

/** @internal Import only through `@skillset/core/internal/report` in focused tests. */
export interface CreateOperationReportOptions {
  /** Deterministic overrides reserved for focused tests. */
  readonly testHooks?: {
    readonly createdAt?: string | undefined;
    readonly id?: string | undefined;
  };
}

export interface ReportKindDefinition {
  readonly kind: SkillsetReport["kind"];
  readonly renderPayload: (payload: Record<string, never>) => readonly string[];
  readonly sanitizePayload: (
    payload: Record<string, never>,
    sentinels: readonly string[]
  ) => Record<string, never>;
}

export const reportKindRegistry: Readonly<
  Record<(typeof REPORT_KINDS)[number], ReportKindDefinition>
> = Object.freeze({
  operation: Object.freeze({
    kind: "operation",
    renderPayload: () => [],
    sanitizePayload: () => ({}),
  }),
});

export function getReportKindDefinition(
  kind: string
): ReportKindDefinition | undefined {
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
  return sanitizeAndValidateSkillsetReport(report, input.sentinels);
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

  const normalized: SkillsetReport = {
    createdAt: source.createdAt,
    id: source.id,
    kind: definition.kind,
    payload: definition.sanitizePayload(
      isEmptyRecord(source.payload) ? source.payload : {},
      []
    ),
    result: {
      command: source.result.command,
      exitCode: source.result.exitCode,
      ok: source.result.ok,
    },
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
  };
  return normalized;
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
  lines.push(
    ...reportKindRegistry[validated.kind].renderPayload(validated.payload)
  );
  return `${lines.join("\n")}\n`;
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

function isEmptyRecord(value: unknown): value is Record<string, never> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).length === 0
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
