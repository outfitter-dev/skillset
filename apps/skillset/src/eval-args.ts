import type { SkillsetOptions } from "@skillset/core/internal/types";

import { assertBooleanOption, CliArgReader } from "./cli-arg-reader";
import { readPositiveInteger, resolveCliRoot } from "./cli-arg-values";
import type { CliParseContext } from "./cli-arg-values";
import type { EvalCommandRequest } from "./eval-cli";

export function parseEvalCommandRequest(
  args: readonly string[],
  context: CliParseContext
): EvalCommandRequest {
  const subcommand = readEvalSubcommand(args[1]);
  let index = 2;
  let runId: string | undefined;
  if (subcommand === "status" || subcommand === "tail") {
    const value = args[index];
    if (value !== undefined && !value.startsWith("--")) {
      runId = value;
      index += 1;
    }
  }
  let jsonOutput = false;
  let lines: number | undefined;
  let rootPath: string | undefined;
  let timeoutMs: number | undefined;
  const reader = new CliArgReader(args, index);
  while (!reader.done) {
    const option = reader.readOption();
    if (option === undefined) break;
    if (option.flag === "--json") {
      assertBooleanOption(option);
      jsonOutput = true;
    } else if (option.flag === "--root") {
      rootPath = reader.readRequiredOptionValue(option);
    } else if (option.flag === "--lines" && subcommand === "tail") {
      lines = readPositiveInteger(reader.readRequiredOptionValue(option), "--lines");
    } else if (option.flag === "--timeout-ms" && subcommand === "run") {
      timeoutMs = readPositiveInteger(reader.readRequiredOptionValue(option), "--timeout-ms");
    } else {
      throw new Error(`skillset: eval ${subcommand} does not support ${option.flag}`);
    }
  }
  const options: SkillsetOptions = {};
  return subcommand === "list" ? {
    jsonOutput,
    options,
    rootPath: resolveCliRoot(context, rootPath),
    subcommand,
  } : subcommand === "run" ? {
    jsonOutput,
    options,
    rootPath: resolveCliRoot(context, rootPath),
    subcommand,
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  } : subcommand === "status" ? {
    jsonOutput,
    options,
    rootPath: resolveCliRoot(context, rootPath),
    ...(runId === undefined ? {} : { runId }),
    subcommand,
  } : {
    jsonOutput,
    ...(lines === undefined ? {} : { lines }),
    options,
    rootPath: resolveCliRoot(context, rootPath),
    ...(runId === undefined ? {} : { runId }),
    subcommand,
  };
}

function readEvalSubcommand(value: string | undefined): "list" | "run" | "status" | "tail" {
  if (value === "list" || value === "run" || value === "status" || value === "tail") return value;
  throw new Error("skillset: eval requires list, run, status, or tail");
}
