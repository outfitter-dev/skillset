import { assertBooleanOption, CliArgReader } from "./cli-arg-reader";
import { resolveCliRoot } from "./cli-arg-values";
import type { CliParseContext } from "./cli-arg-values";
import type { PromoteCommandRequest } from "./promote-cli";

export const parsePromoteCommandRequest = (
  args: readonly string[],
  context: CliParseContext
): PromoteCommandRequest => {
  const reader = new CliArgReader(args, 1);
  let draftPath: string | undefined;
  let jsonOutput = false;
  let rootPath: string | undefined;
  let yes = false;

  while (!reader.done) {
    const positional = reader.readOptionalPositional();
    if (positional !== undefined) {
      if (draftPath === undefined) draftPath = positional;
      else throw new Error("skillset: promote accepts exactly <draft-path>");
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
          `skillset: promote only supports --json, --root, and --yes; received ${option.raw}`
        );
      }
    }
  }

  if (draftPath === undefined) {
    throw new Error("skillset: promote requires <draft-path>");
  }
  return {
    draftPath,
    jsonOutput,
    rootPath: resolveCliRoot(context, rootPath),
    yes,
  };
};
