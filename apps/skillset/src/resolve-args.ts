import { assertBooleanOption, CliArgReader } from "./cli-arg-reader";
import { resolveCliRoot } from "./cli-arg-values";
import type { CliParseContext } from "./cli-arg-values";
import type { ResolveCommandRequest } from "./resolve-cli";

export const parseResolveCommandRequest = (
  args: readonly string[],
  context: CliParseContext
): ResolveCommandRequest => {
  let jsonOutput = false;
  let rootPath: string | undefined;
  let yes = false;
  const reader = new CliArgReader(args, 1);

  while (!reader.done) {
    const option = reader.readOption();
    if (option === undefined) break;
    switch (option.flag) {
      case "--root":
        rootPath = reader.readRequiredOptionValue(option);
        break;
      case "--json":
        assertBooleanOption(option);
        jsonOutput = true;
        break;
      case "--yes":
        assertBooleanOption(option);
        yes = true;
        break;
      default:
        throw new Error(`skillset: unknown option ${option.raw}`);
    }
  }

  return {
    jsonOutput,
    options: {},
    rootPath: resolveCliRoot(context, rootPath),
    yes,
  };
};
