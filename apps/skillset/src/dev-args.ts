import { assertBooleanOption, CliArgReader } from "./cli-arg-reader";
import {
  mergeBuildMode,
  readBuildScopes,
  resolveCliRoot,
} from "./cli-arg-values";
import type { CliParseContext } from "./cli-arg-values";
import type { DevCommandRequest } from "./dev-cli";

export const parseDevCommandRequest = (
  args: readonly string[],
  context: CliParseContext
): DevCommandRequest => {
  let buildMode: "all" | "updated" | undefined;
  let isolated = false;
  let jsonOutput = false;
  let jsonlOutput = false;
  let readinessFlag = false;
  let rootPath: string | undefined;
  let scopes: readonly string[] | undefined;
  let yes = false;
  let write = false;
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
      case "--write":
        assertBooleanOption(option);
        write = true;
        break;
      case "--jsonl":
        assertBooleanOption(option);
        jsonlOutput = true;
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
      case "--yes":
        assertBooleanOption(option);
        yes = true;
        break;
      case "--from":
      case "--kind":
      case "--name":
        reader.readRequiredOptionValue(option);
        break;
      case "--json":
        assertBooleanOption(option);
        jsonOutput = true;
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
      case "--isolated":
        assertBooleanOption(option);
        isolated = true;
        break;
      default:
        throw new Error(`skillset: unknown option ${option.raw}`);
    }
  }

  if (readinessFlag) {
    throw new Error("skillset: readiness flags are only supported with check");
  }
  if (buildMode !== undefined) {
    throw new Error("skillset: dev does not support --updated or --all");
  }
  if (scopes !== undefined) {
    throw new Error("skillset: dev does not support --scope yet");
  }
  if (yes) {
    throw new Error(
      "skillset: dev uses preview mode by default or write mode with --write; it does not support --yes"
    );
  }
  if (jsonOutput) {
    throw new Error("skillset: --json is not supported for this command route");
  }
  if (isolated) {
    throw new Error(
      "skillset: --isolated is only supported with build, check --only outputs, or diff"
    );
  }

  return {
    jsonlOutput,
    options: {},
    rootPath: resolveCliRoot(context, rootPath),
    write,
  };
};
