#!/usr/bin/env bun
import {
  readRuntimeContextField,
  readRuntimeContextFormat,
  renderRuntimeContext,
  type RuntimeContextField,
  type RuntimeContextFormat,
} from "./runtime";

export interface ToolkitCliIO {
  readonly stderr?: Pick<typeof process.stderr, "write">;
  readonly stdout?: Pick<typeof process.stdout, "write">;
}

interface RuntimeContextCliOptions {
  readonly event: string;
  readonly fields?: readonly RuntimeContextField[];
  readonly format: RuntimeContextFormat;
}

const USAGE = `Usage: skillset-toolkit runtime context --event <event> [--format json|env] [--fields provider,hook.event,session.id]

Commands:
  runtime context  Print normalized Skillset runtime context for hook scripts.
`;

export async function runToolkitCli(rawArgs: readonly string[] = process.argv.slice(2), io: ToolkitCliIO = {}): Promise<number> {
  const stdout = io.stdout ?? process.stdout;
  const stderr = io.stderr ?? process.stderr;
  try {
    if (rawArgs.includes("--help") || rawArgs.includes("-h")) {
      stdout.write(USAGE);
      return 0;
    }
    const options = parseRuntimeContextArgs(rawArgs);
    stdout.write(await renderRuntimeContext(options));
    return 0;
  } catch (error) {
    stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

function parseRuntimeContextArgs(args: readonly string[]): RuntimeContextCliOptions {
  if (args[0] !== "runtime" || args[1] !== "context") {
    throw new Error("skillset-toolkit: expected command runtime context");
  }

  let event: string | undefined;
  let fields: readonly RuntimeContextField[] | undefined;
  let format: RuntimeContextFormat = "json";

  for (let index = 2; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--event") {
      event = readFlagValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--format") {
      format = readRuntimeContextFormat(readFlagValue(args, index, arg));
      index += 1;
      continue;
    }
    if (arg === "--fields" || arg === "--context-fields") {
      fields = readRuntimeContextFields(readFlagValue(args, index, arg));
      index += 1;
      continue;
    }
    throw new Error(`skillset-toolkit: unknown runtime context option ${arg ?? ""}`);
  }

  if (event === undefined || event.trim().length === 0) {
    throw new Error("skillset-toolkit: runtime context requires --event <event>");
  }

  return {
    event,
    ...(fields === undefined ? {} : { fields }),
    format,
  };
}

function readRuntimeContextFields(value: string): readonly RuntimeContextField[] {
  const fields = value.split(",").map((field) => field.trim()).filter(Boolean).map(readRuntimeContextField);
  if (fields.length === 0) throw new Error("skillset-toolkit: --fields must include at least one context field");
  return fields;
}

function readFlagValue(args: readonly string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (value === undefined || value.startsWith("--")) throw new Error(`skillset-toolkit: ${flag} requires a value`);
  return value;
}

if (import.meta.main) {
  process.exitCode = await runToolkitCli();
}
