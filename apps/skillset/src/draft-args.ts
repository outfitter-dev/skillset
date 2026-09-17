import { assertBooleanOption, CliArgReader } from "./cli-arg-reader";
import { resolveCliRoot } from "./cli-arg-values";
import type { CliParseContext } from "./cli-arg-values";
import type { DraftCommandRequest } from "./draft-cli";

export const parseDraftCommandRequest = (
  args: readonly string[],
  context: CliParseContext
): DraftCommandRequest => {
  const reader = new CliArgReader(args, 1);
  let jsonOutput = false;
  let rootPath: string | undefined;
  let shippedPath: string | undefined;
  let yes = false;

  while (!reader.done) {
    const positional = reader.readOptionalPositional();
    if (positional !== undefined) {
      if (shippedPath === undefined) shippedPath = positional;
      else throw new Error("skillset: draft accepts exactly <shipped-path>");
      continue;
    }
    const option = reader.readOption();
    if (option === undefined) break;
    switch (option.flag) {
      case "--json": {
        assertBooleanOption(option);
        jsonOutput = true;
        break;
      }
      case "--root": {
        rootPath = reader.readRequiredOptionValue(option);
        break;
      }
      case "--yes": {
        assertBooleanOption(option);
        yes = true;
        break;
      }
      default: {
        throw new Error(
          `skillset: draft only supports --json, --root, and --yes; received ${option.raw}`
        );
      }
    }
  }

  if (shippedPath === undefined) {
    throw new Error("skillset: draft requires <shipped-path>");
  }
  return {
    jsonOutput,
    rootPath: resolveCliRoot(context, rootPath),
    shippedPath,
    yes,
  };
};
