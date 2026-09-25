import { assertBooleanOption, CliArgReader } from "./cli-arg-reader";
import {
  mergeBuildMode,
  readBuildScopes,
  resolveCliRoot,
} from "./cli-arg-values";
import type { CliParseContext } from "./cli-arg-values";
import { CliUsageError } from "./cli-output";
import { rejectProjectionForeignOption } from "./projection-foreign-args";
import { readImportKind, readImportProvider } from "./source-arg-values";
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
  let sinceFlag = false;
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
        readImportProvider(reader.readRequiredOptionValue(option));
        break;
      case "--kind":
        readImportKind(reader.readRequiredOptionValue(option));
        break;
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
      case "--report": {
        const value = reader.readRequiredOptionValue(option);
        if (option.flag === "--only" && value !== "outputs") {
          throw new CliUsageError("skillset: expected --only outputs");
        }
        readinessFlag = true;
        break;
      }
      case "--since":
        reader.readRequiredOptionValue(option);
        sinceFlag = true;
        break;
      case "--write":
        assertBooleanOption(option);
        throw new CliUsageError(
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
        rejectProjectionForeignOption(reader, option);
        throw new CliUsageError(`skillset: unknown option ${option.raw}`);
    }
  }

  if (readinessFlag) {
    throw new CliUsageError("skillset: readiness flags are only supported with check");
  }
  if (sinceFlag) {
    throw new CliUsageError(
      "skillset: --since is only supported with check --ci or change commands"
    );
  }
  if (buildMode !== undefined) {
    throw new CliUsageError("skillset: update does not support --updated or --all");
  }
  if (scopes !== undefined) {
    throw new CliUsageError(
      "skillset: update does not support --scope; provider format updates require a whole-workspace safety preflight"
    );
  }
  if (jsonlOutput) {
    throw new CliUsageError("skillset: --jsonl is only supported with dev");
  }
  if (isolated) {
    throw new CliUsageError(
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
