import { assertBooleanOption, CliArgReader } from "./cli-arg-reader";
import { resolveCliRoot } from "./cli-arg-values";
import type { CliParseContext } from "./cli-arg-values";
import { CliUsageError } from "./cli-output";
import type { MoveCommandRequest } from "./move-cli";

export const parseMoveCommandRequest = (
  args: readonly string[],
  context: CliParseContext
): MoveCommandRequest => {
  const reader = new CliArgReader(args, 1);
  let from: string | undefined;
  let jsonOutput = false;
  let rootPath: string | undefined;
  let to: string | undefined;
  let yes = false;

  while (!reader.done) {
    const positional = reader.readOptionalPositional();
    if (positional !== undefined) {
      if (from === undefined) from = positional;
      else if (to === undefined) to = positional;
      else throw new CliUsageError("skillset: move accepts exactly <from> and <to>");
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
        throw new CliUsageError(
          `skillset: move only supports --json, --root, and --yes; received ${option.raw}`
        );
      }
    }
  }

  if (from === undefined || to === undefined) {
    throw new CliUsageError("skillset: move requires <from> and <to>");
  }
  return {
    from,
    jsonOutput,
    rootPath: resolveCliRoot(context, rootPath),
    to,
    yes,
  };
};
