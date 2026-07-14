import type { SkillsetOptions } from "@skillset/core/internal/types";

import type { CheckCommandRequest } from "./check-cli";
import { assertBooleanOption, CliArgReader } from "./cli-arg-reader";
import {
  mergeBuildMode,
  readBuildScopes,
  resolveCliRoot,
} from "./cli-arg-values";
import type { CliParseContext } from "./cli-arg-values";
import { rejectProjectionForeignOption } from "./projection-foreign-args";
import { readImportKind, readImportProvider } from "./source-arg-values";

export const parseCheckCommandRequest = (
  args: readonly string[],
  context: CliParseContext
): CheckCommandRequest => {
  let buildMode: "all" | "updated" | undefined;
  let changeSince: string | undefined;
  let checkOnly: "outputs" | undefined;
  let checkWrite = false;
  let ciFix = false;
  let ciMode = false;
  let ciReportPath: string | undefined;
  let isolated = false;
  let jsonOutput = false;
  let jsonlOutput = false;
  let rootPath: string | undefined;
  let scopes: SkillsetOptions["scopes"];
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
      case "--since":
        changeSince = reader.readRequiredOptionValue(option);
        break;
      case "--report":
        ciReportPath = reader.readRequiredOptionValue(option);
        break;
      case "--only": {
        const value = reader.readRequiredOptionValue(option);
        if (value !== "outputs") {
          throw new Error("skillset: expected --only outputs");
        }
        checkOnly = value;
        break;
      }
      case "--ci":
        assertBooleanOption(option);
        ciMode = true;
        break;
      case "--fix":
        assertBooleanOption(option);
        ciFix = true;
        break;
      case "--write":
        assertBooleanOption(option);
        checkWrite = true;
        break;
      case "--json":
        assertBooleanOption(option);
        jsonOutput = true;
        break;
      case "--jsonl":
        assertBooleanOption(option);
        jsonlOutput = true;
        break;
      case "--isolated":
        assertBooleanOption(option);
        isolated = true;
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
      default:
        rejectProjectionForeignOption(reader, option);
        throw new Error(`skillset: unknown option ${option.raw}`);
    }
  }

  if (yes) {
    throw new Error(
      "skillset: check does not take mutation confirmation flags"
    );
  }
  if (ciFix && !ciMode) {
    throw new Error("skillset: check --fix requires --ci");
  }
  if (checkWrite && ciMode) {
    throw new Error("skillset: check --ci uses --fix instead of --write");
  }
  if ((ciReportPath !== undefined || changeSince !== undefined) && !ciMode) {
    throw new Error("skillset: --report and --since require check --ci");
  }
  if (
    checkOnly !== undefined &&
    (ciMode ||
      ciFix ||
      checkWrite ||
      ciReportPath !== undefined ||
      changeSince !== undefined)
  ) {
    throw new Error(
      "skillset: check --only outputs cannot be combined with CI or write flags"
    );
  }
  if (jsonlOutput) {
    throw new Error("skillset: --jsonl is only supported with dev");
  }
  if (checkOnly !== "outputs" && buildMode !== undefined) {
    throw new Error(
      "skillset check does not support --updated or --all; it checks source diagnostics"
    );
  }
  if (checkOnly !== "outputs" && scopes !== undefined) {
    throw new Error(
      "skillset check does not support --scope; it checks source diagnostics"
    );
  }
  if (isolated && checkOnly !== "outputs") {
    throw new Error(
      "skillset: --isolated is only supported with build, check --only outputs, or diff"
    );
  }
  return {
    changeSince,
    checkOnly,
    checkWrite,
    ciFix,
    ciMode,
    ciReportPath,
    jsonOutput,
    options: {
      ...(checkOnly === "outputs" && buildMode !== undefined
        ? { buildMode }
        : {}),
      ...(checkOnly === "outputs" && scopes !== undefined ? { scopes } : {}),
      ...(isolated ? { isolated: true } : {}),
    },
    rootPath: resolveCliRoot(context, rootPath),
  };
};
