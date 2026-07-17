import type { TargetName } from "@skillset/core/internal/types";

import { assertBooleanOption, CliArgReader } from "./cli-arg-reader";
import {
  readTargetNames,
  resolveCliRoot,
} from "./cli-arg-values";
import type { CliParseContext } from "./cli-arg-values";
import type { CreateCommandRequest } from "./create-cli";
import { mergeSetupIncludes } from "./init-args";
import type { SetupInclude } from "./setup";

export const parseCreateCommandRequest = (
  args: readonly string[],
  context: CliParseContext
): CreateCommandRequest => {
  let name: string | undefined;
  let index = 1;
  const positional = args[index];
  if (positional !== undefined && !positional.startsWith("--")) {
    name = positional;
    index += 1;
  }

  let include: readonly SetupInclude[] | undefined;
  let json = false;
  let root: string | undefined;
  let targets: readonly TargetName[] | undefined;
  let yes = false;
  const reader = new CliArgReader(args, index);
  while (!reader.done) {
    const option = reader.readOption();
    if (option === undefined) break;
    switch (option.flag) {
      case "--root":
        root = reader.readRequiredOptionValue(option);
        break;
      case "--targets":
        targets = readTargetNames(reader.readRequiredOptionValue(option));
        break;
      case "--include":
        include = mergeSetupIncludes(
          include,
          reader.readRequiredOptionValue(option)
        );
        break;
      case "--yes":
        assertBooleanOption(option);
        yes = true;
        break;
      case "--json":
        assertBooleanOption(option);
        json = true;
        break;
      default:
        throw new Error(`skillset: unknown option ${option.raw}`);
    }
  }
  return {
    jsonOutput: json,
    name,
    options: {},
    parentExplicit: root !== undefined,
    parentPath: resolveCliRoot(context, root),
    setupIncludes: include,
    setupTargets: targets,
    yes,
  };
};
