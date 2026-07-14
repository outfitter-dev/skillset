import { assertBooleanOption, CliArgReader } from "./cli-arg-reader";
import {
  mergeBuildMode,
  readBuildScopes,
  resolveCliRoot,
} from "./cli-arg-values";
import type { CliParseContext } from "./cli-arg-values";
import type { DevCommandRequest } from "./dev-cli";
import { rejectProjectionForeignOption } from "./projection-foreign-args";
import { readImportKind, readImportProvider } from "./source-arg-values";

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
  let sinceFlag = false;
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
        readImportProvider(reader.readRequiredOptionValue(option));
        break;
      case "--kind":
        readImportKind(reader.readRequiredOptionValue(option));
        break;
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
      case "--report": {
        const value = reader.readRequiredOptionValue(option);
        if (option.flag === "--only" && value !== "outputs") {
          throw new Error("skillset: expected --only outputs");
        }
        readinessFlag = true;
        break;
      }
      case "--since":
        reader.readRequiredOptionValue(option);
        sinceFlag = true;
        break;
      case "--isolated":
        assertBooleanOption(option);
        isolated = true;
        break;
      default:
        rejectProjectionForeignOption(reader, option);
        throw new Error(`skillset: unknown option ${option.raw}`);
    }
  }

  if (readinessFlag) {
    throw new Error("skillset: readiness flags are only supported with check");
  }
  if (sinceFlag) {
    throw new Error(
      "skillset: --since is only supported with check --ci or change commands"
    );
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
