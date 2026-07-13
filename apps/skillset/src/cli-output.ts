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

import { CLI_LEAF_SUBCOMMANDS, isCliCommand } from "./cli-commands";

export type CliMachineMode = "json" | "jsonl";

export class CliOutputError extends Error {
  readonly command?: string;
  readonly exitCode: number;

  constructor(message: string, exitCode = 2, command?: string) {
    super(message);
    this.name = "CliOutputError";
    this.exitCode = exitCode;
    if (command !== undefined) this.command = command;
  }
}

export function readCliCommand(args: readonly string[]): string {
  const command = args[0];
  if (!isCliCommand(command)) return "cli";
  const subcommand = args[1];
  return subcommand !== undefined && CLI_LEAF_SUBCOMMANDS[command]?.includes(subcommand)
    ? `${command} ${subcommand}`
    : command;
}

export function readCliMachineMode(
  args: readonly string[]
): CliMachineMode | undefined {
  const json = args.includes("--json");
  const jsonl = args.includes("--jsonl");
  if (json && jsonl) {
    throw new CliOutputError("skillset: --json and --jsonl are mutually exclusive");
  }
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

export function renderCliDataResult(input: {
  readonly command: string;
  readonly data: SchemaJsonRecord;
  readonly diagnostics?: readonly SkillsetCliDiagnostic[];
  readonly exitCode?: number;
  readonly kind?: string;
}): string {
  return renderCliResult(createCliResult({
    command: input.command,
    data: input.data,
    ...(input.diagnostics === undefined ? {} : { diagnostics: input.diagnostics }),
    ...(input.exitCode === undefined ? {} : { exitCode: input.exitCode }),
    kind: input.kind ?? "data",
  }));
}

export function renderCliEvent(event: SkillsetCliEvent): string {
  assertValid(validateCliEvent(event));
  return `${JSON.stringify(event)}\n`;
}

const TERMINAL_CLI_EVENTS = new Set(["completed", "failed"]);

export function createCliEventStream(
  command: string,
  output: Pick<NodeJS.WritableStream, "write">
): { readonly emit: (event: string, data: SchemaJsonRecord) => SkillsetCliEvent } {
  let sequence = 0;
  let terminal = false;
  return {
    emit(event, data) {
      if (terminal) throw new CliOutputError("skillset: cannot emit an event after a terminal CLI event", 4);
      const value = createCliEvent({ command, data, event, sequence: sequence + 1 });
      sequence = value.sequence;
      terminal = TERMINAL_CLI_EVENTS.has(event);
      output.write(renderCliEvent(value));
      return value;
    },
  };
}

export function parseCliEventStream(input: string): readonly SkillsetCliEvent[] {
  const lines = input.split("\n").filter((line) => line.length > 0);
  const events = lines.map((line, index) => {
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      throw new CliOutputError(`skillset: invalid JSONL event at line ${index + 1}`, 4);
    }
    assertValid(validateCliEvent(value));
    return value as SkillsetCliEvent;
  });
  for (let index = 0; index < events.length; index += 1) {
    if (events[index]?.sequence !== index + 1) {
      throw new CliOutputError(`skillset: non-monotonic CLI event sequence at line ${index + 1}`, 4);
    }
  }
  const terminals = events.filter((event) => TERMINAL_CLI_EVENTS.has(event.event));
  if (terminals.length !== 1 || !TERMINAL_CLI_EVENTS.has(events.at(-1)?.event ?? "")) {
    throw new CliOutputError("skillset: CLI event stream ended without exactly one terminal event", 4);
  }
  return events;
}

function assertValid(validation: ReturnType<typeof validateCliResult>): void {
  if (validation.ok) return;
  const detail = validation.diagnostics
    .map((item) => `${item.path}: ${item.message}`)
    .join("; ");
  throw new CliOutputError(`skillset: invalid structured output: ${detail}`, 4);
}
