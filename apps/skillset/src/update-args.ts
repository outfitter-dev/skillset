import { assertBooleanOption, CliArgReader } from "./cli-arg-reader";
import {
  mergeBuildMode,
  readBuildScopes,
  resolveCliRoot,
} from "./cli-arg-values";
import type { CliParseContext } from "./cli-arg-values";
import type { UpdateCommandRequest } from "./update-cli";

export const parseUpdateCommandRequest = (
  args: readonly string[],
  context: CliParseContext
): UpdateCommandRequest => {
  let buildMode: "all" | "updated" | undefined;
  let isolated = false;
  let jsonOutput = false;
  let jsonlOutput = false;
  let readinessFlag = false;
  let rootPath: string | undefined;
  let scopes: readonly string[] | undefined;
  let yes = false;
  const reader = new CliArgReader(args, 1);

  while (!reader.done) {
    const option = reader.readOption();
    if (option === undefined) {
      break;
    }
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
      case "--from":
      case "--kind":
      case "--name":
        reader.readRequiredOptionValue(option);
        break;
      case "--updated":
      case "--all":
        assertBooleanOption(option);
        buildMode = mergeBuildMode(
          buildMode,
          option.flag === "--all" ? "all" : "updated"
        );
        break;
      case "--scope":
        scopes = readBuildScopes(reader.readRequiredOptionValue(option));
        break;
      case "--fix":
      case "--ci":
        assertBooleanOption(option);
        readinessFlag = true;
        break;
      case "--only":
      case "--report":
      case "--since":
        reader.readRequiredOptionValue(option);
        readinessFlag = true;
        break;
      case "--include":
      case "--targets":
        reader.readRequiredOptionValue(option);
        throw new Error("skillset: setup options are only supported with init");
      case "--write":
        assertBooleanOption(option);
        throw new Error(
          "skillset: --write is only supported with check or dev"
        );
      case "--isolated":
        assertBooleanOption(option);
        isolated = true;
        break;
      case "--jsonl":
        assertBooleanOption(option);
        jsonlOutput = true;
        break;
      default:
        throw new Error(`skillset: unknown option ${option.raw}`);
    }
  }

  if (readinessFlag) {
    throw new Error("skillset: readiness flags are only supported with check");
  }
  if (buildMode !== undefined) {
    throw new Error("skillset: update does not support --updated or --all");
  }
  if (scopes !== undefined) {
    throw new Error(
      "skillset: update does not support --scope; provider format updates require a whole-workspace safety preflight"
    );
  }
  if (jsonlOutput) {
    throw new Error("skillset: --jsonl is only supported with dev");
  }
  if (isolated) {
    throw new Error(
      "skillset: --isolated is only supported with build, check --only outputs, or diff"
    );
  }

  return {
    jsonOutput,
    options: {},
    rootPath: resolveCliRoot(context, rootPath),
    yes,
  };
};
