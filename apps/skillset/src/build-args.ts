import type { SkillsetOptions } from "@skillset/core/internal/types";

import type { BuildCommandRequest, DiffCommandRequest } from "./build-cli";
import { assertBooleanOption, CliArgReader } from "./cli-arg-reader";
import {
  mergeBuildMode,
  readBuildScopes,
  resolveCliRoot,
} from "./cli-arg-values";
import type { CliParseContext } from "./cli-arg-values";
import { rejectProjectionForeignOption } from "./projection-foreign-args";
import { readImportKind, readImportProvider } from "./source-arg-values";

export const parseBuildCommandRequest = (
  args: readonly string[],
  context: CliParseContext
): BuildCommandRequest => {
  const parsed = parseProjectionArgs(args, context);
  return {
    jsonOutput: parsed.jsonOutput,
    options: parsed.options,
    rootPath: parsed.rootPath,
    yes: parsed.yes,
  };
};

export const parseDiffCommandRequest = (
  args: readonly string[],
  context: CliParseContext
): DiffCommandRequest => {
  const parsed = parseProjectionArgs(args, context);
  return {
    jsonOutput: parsed.jsonOutput,
    options: parsed.options,
    rootPath: parsed.rootPath,
  };
};

interface ProjectionArgs {
  readonly jsonOutput: boolean;
  readonly options: SkillsetOptions;
  readonly rootPath: string;
  readonly yes: boolean;
}

const parseProjectionArgs = (
  args: readonly string[],
  context: CliParseContext
): ProjectionArgs => {
  let buildMode: "all" | "updated" | undefined;
  let isolated = false;
  let jsonOutput = false;
  let rootPath: string | undefined;
  let scopes: SkillsetOptions["scopes"];
  let yes = false;
  let readinessFlag = false;
  let sinceFlag = false;
  let jsonlOutput = false;
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
      case "--scope":
        scopes = readBuildScopes(reader.readRequiredOptionValue(option));
        break;
      case "--updated":
        assertBooleanOption(option);
        buildMode = mergeBuildMode(buildMode, "updated");
        break;
      case "--all":
        assertBooleanOption(option);
        buildMode = mergeBuildMode(buildMode, "all");
        break;
      case "--isolated":
        assertBooleanOption(option);
        isolated = true;
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
      case "--write":
        assertBooleanOption(option);
        throw new Error(
          "skillset: --write is only supported with check or dev"
        );
      case "--jsonl":
        assertBooleanOption(option);
        jsonlOutput = true;
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
  if (jsonlOutput) {
    throw new Error("skillset: --jsonl is only supported with dev");
  }

  return {
    jsonOutput,
    options: {
      ...(buildMode === undefined ? {} : { buildMode }),
      ...(scopes === undefined ? {} : { scopes }),
      ...(isolated ? { isolated: true } : {}),
    },
    rootPath: resolveCliRoot(context, rootPath),
    yes,
  };
};
