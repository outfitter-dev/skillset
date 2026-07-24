import { assertBooleanOption, CliArgReader } from "./cli-arg-reader";
import { resolveCliRoot } from "./cli-arg-values";
import type { CliParseContext } from "./cli-arg-values";
import type { RenameCommandRequest } from "./rename-cli";

export const parseRenameCommandRequest = (
  args: readonly string[],
  context: CliParseContext
): RenameCommandRequest => {
  const reader = new CliArgReader(args, 1);
  let from: string | undefined;
  let jsonOutput = false;
  let rootPath: string | undefined;
  let to: string | undefined;
  let yes = false;

  while (!reader.done) {
    const positional = reader.readOptionalPositional();
    if (positional !== undefined) {
      if (from === undefined) {
        from = positional;
      } else if (to === undefined) {
        to = positional;
      } else {
        throw new Error("skillset: rename accepts exactly <from> and <to>");
      }
      continue;
    }
    const option = reader.readOption();
    if (option === undefined) {
      break;
    }
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
          `skillset: rename only supports --json, --root, and --yes; received ${option.raw}`
        );
      }
    }
  }

  if (from === undefined || to === undefined) {
    throw new Error("skillset: rename requires <from> and <to>");
  }

  return {
    from,
    jsonOutput,
    rootPath: resolveCliRoot(context, rootPath),
    to,
    yes,
  };
};
