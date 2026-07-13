import {
  CLI_EVENT_SCHEMA_VERSION,
  CLI_RESULT_SCHEMA_VERSION,
  SKILLSET_SCHEMA_URI_BASE,
  SKILLSET_SCHEMA_VERSION,
  validateCliEvent,
  validateCliResult,
  type SchemaJsonRecord,
  type SkillsetCliChange,
  type SkillsetCliDiagnostic,
  type SkillsetCliEvent,
  type SkillsetCliResult,
} from "@skillset/schema";

export type CliMachineMode = "json" | "jsonl";

export class CliOutputError extends Error {
  readonly command?: string;
  readonly exitCode: number;

  constructor(message: string, exitCode = 2, command?: string) {
    super(message);
    this.name = "CliOutputError";
    this.exitCode = exitCode;
    this.command = command;
  }
}

const LEAF_SUBCOMMANDS: Readonly<Record<string, readonly string[]>> = {
  change: ["add", "amend", "check", "history", "list", "migrate", "reason", "show", "status"],
  distribute: ["plan"],
  hooks: ["context", "print", "run"],
  lookup: ["features"],
  marketplace: ["check", "update"],
  release: ["amend", "apply", "audit", "plan"],
  test: ["list", "status", "tail"],
};
const KNOWN_COMMANDS = new Set([
  "build", "change", "check", "dev", "diff", "distribute", "explain",
  "hooks", "import", "init", "list", "lookup", "marketplace", "new",
  "reconcile", "release", "restore", "status", "test", "update",
]);

export function readCliCommand(args: readonly string[]): string {
  const command = args[0];
  if (command === undefined || !KNOWN_COMMANDS.has(command)) return "cli";
  const subcommand = args[1];
  return subcommand !== undefined && LEAF_SUBCOMMANDS[command]?.includes(subcommand)
    ? `${command} ${subcommand}`
    : command;
}

export function readCliMachineMode(
  args: readonly string[]
): CliMachineMode | undefined {
  const json = args.includes("--json");
  const jsonl = args.includes("--jsonl");
  if (json && jsonl)
    throw new CliOutputError(
      "skillset: --json and --jsonl are mutually exclusive"
    );
  if (json) return "json";
  if (jsonl) return "jsonl";
  return undefined;
}

export function createCliResult(input: {
  readonly changes?: readonly SkillsetCliChange[];
  readonly command: string;
  readonly data: SchemaJsonRecord;
  readonly diagnostics?: readonly SkillsetCliDiagnostic[];
  readonly exitCode?: number;
  readonly kind: string;
  readonly meta?: SchemaJsonRecord;
}): SkillsetCliResult {
  const exitCode = input.exitCode ?? 0;
  const value: SkillsetCliResult = {
    changes: input.changes ?? [],
    command: input.command,
    data: input.data,
    diagnostics: input.diagnostics ?? [],
    exitCode,
    kind: input.kind,
    meta: input.meta ?? {
      schema: `${SKILLSET_SCHEMA_URI_BASE}/${SKILLSET_SCHEMA_VERSION}/cli-result.schema.json`,
    },
    ok: exitCode === 0,
    schemaVersion: CLI_RESULT_SCHEMA_VERSION,
  };
  assertValid(validateCliResult(value));
  return value;
}

export function createCliEvent(input: {
  readonly command: string;
  readonly data: SchemaJsonRecord;
  readonly event: string;
  readonly sequence: number;
}): SkillsetCliEvent {
  const value: SkillsetCliEvent = {
    ...input,
    schemaVersion: CLI_EVENT_SCHEMA_VERSION,
  };
  assertValid(validateCliEvent(value));
  return value;
}

export function renderCliResult(result: SkillsetCliResult): string {
  assertValid(validateCliResult(result));
  return `${JSON.stringify(result)}\n`;
}

export function renderCliEvent(event: SkillsetCliEvent): string {
  assertValid(validateCliEvent(event));
  return `${JSON.stringify(event)}\n`;
}

function assertValid(validation: ReturnType<typeof validateCliResult>): void {
  if (validation.ok) return;
  const detail = validation.diagnostics
    .map((item) => `${item.path}: ${item.message}`)
    .join("; ");
  throw new CliOutputError(`skillset: invalid structured output: ${detail}`, 4);
}
