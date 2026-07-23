import type { SkillsetOptions } from "@skillset/core/internal/types";

import { assertBooleanOption, CliArgReader } from "./cli-arg-reader";
import { resolveCliRoot } from "./cli-arg-values";
import type { CliParseContext } from "./cli-arg-values";
import type { EvalCommandRequest } from "./eval-cli";

export function parseEvalCommandRequest(
  args: readonly string[],
  context: CliParseContext
): EvalCommandRequest {
  if (args[1] !== "list") {
    throw new Error("skillset: eval requires the list subcommand");
  }
  let jsonOutput = false;
  let rootPath: string | undefined;
  const reader = new CliArgReader(args, 2);
  while (!reader.done) {
    const option = reader.readOption();
    if (option === undefined) break;
    if (option.flag === "--json") {
      assertBooleanOption(option);
      jsonOutput = true;
    } else if (option.flag === "--root") {
      rootPath = reader.readRequiredOptionValue(option);
    } else {
      throw new Error(`skillset: eval list does not support ${option.flag}`);
    }
  }
  const options: SkillsetOptions = {};
  return {
    jsonOutput,
    options,
    rootPath: resolveCliRoot(context, rootPath),
    subcommand: "list",
  };
}
