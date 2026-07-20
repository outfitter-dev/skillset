import type { SkillsetOptions } from "@skillset/core/internal/types";

import { readChangeBump, setChangeReason } from "./change-args";
import type { ChangeReasonInput } from "./change-workflow";
import { assertBooleanOption, CliArgReader } from "./cli-arg-reader";
import {
  mergeBuildMode,
  readBuildScopes,
  resolveCliRoot,
} from "./cli-arg-values";
import type { CliParseContext } from "./cli-arg-values";
import type { ReconcileChoice } from "./reconcile";
import type {
  ReconcileCommandRequest,
  RestoreCommandRequest,
} from "./recovery-cli";
import { readImportKind, readImportProvider } from "./source-arg-values";

export const parseRestoreCommandRequest = (
  args: readonly string[],
  context: CliParseContext
): RestoreCommandRequest => {
  const backupId = args[1]?.startsWith("--")
    ? undefined
    : readRequiredPath(args[1], "backup id to restore");
  const parsed = parseRecoveryOptions(args, backupId === undefined ? 1 : 2, context);
  validateRecoveryOwnership(parsed);
  if (parsed.buildMode !== undefined || parsed.scopes !== undefined) {
    throw new Error("skillset: restore only supports --root, --yes, --json, and --list");
  }
  if (parsed.choice !== undefined) {
    throw new Error("skillset: --use is only supported with reconcile");
  }
  if (parsed.list) {
    if (backupId !== undefined) {
      throw new Error("skillset: restore --list cannot be combined with a backup id");
    }
    if (parsed.yes) {
      throw new Error("skillset: restore --list cannot be combined with --yes");
    }
  } else if (backupId === undefined) {
    throw new Error("skillset: expected backup id to restore");
  }
  return {
    backupId,
    jsonOutput: parsed.jsonOutput,
    list: parsed.list,
    options: {},
    rootPath: parsed.rootPath,
    yes: parsed.yes,
  };
};

export const parseReconcileCommandRequest = (
  args: readonly string[],
  context: CliParseContext
): ReconcileCommandRequest => {
  const managedPath = readRequiredPath(args[1], "a path to reconcile");
  const parsed = parseRecoveryOptions(args, 2, context);
  validateRecoveryOwnership(parsed);
  if (parsed.buildMode !== undefined) {
    throw new Error(
      "skillset: --updated and --all are not supported with reconcile"
    );
  }
  if (parsed.scopes !== undefined) {
    throw new Error("skillset: --scope is not supported with reconcile");
  }
  if (parsed.list) {
    throw new Error("skillset: --list is only supported with restore");
  }
  if (parsed.yes && parsed.choice === undefined) {
    throw new Error(
      "skillset: reconcile --yes requires --use source or --use output"
    );
  }
  return {
    jsonOutput: parsed.jsonOutput,
    managedPath,
    options: {},
    reconcileChoice: parsed.choice,
    rootPath: parsed.rootPath,
    yes: parsed.yes,
  };
};

interface RecoveryOptions {
  readonly buildMode: "all" | "updated" | undefined;
  readonly changeFlag: boolean;
  readonly changeSince: string | undefined;
  readonly choice: ReconcileChoice | undefined;
  readonly jsonOutput: boolean;
  readonly list: boolean;
  readonly rootPath: string;
  readonly scopes: SkillsetOptions["scopes"];
  readonly yes: boolean;
}

const parseRecoveryOptions = (
  args: readonly string[],
  index: number,
  context: CliParseContext
): RecoveryOptions => {
  let buildMode: "all" | "updated" | undefined;
  let changeAppend = false;
  let changeBump = false;
  let changeGroup: string | undefined;
  let changeReason: ChangeReasonInput | undefined;
  let changeRef: string | undefined;
  let changeStaged = false;
  let changeSince: string | undefined;
  let choice: ReconcileChoice | undefined;
  let jsonOutput = false;
  let list = false;
  let rootPath: string | undefined;
  let scopes: SkillsetOptions["scopes"];
  let yes = false;
  const reader = new CliArgReader(args, index);
  while (!reader.done) {
    const option = reader.readOption();
    if (option === undefined) break;
    switch (option.flag) {
      case "--root":
        rootPath = reader.readRequiredOptionValue(option);
        break;
      case "--since":
        changeSince = reader.readRequiredOptionValue(option);
        break;
      case "--ref":
        changeRef = reader.readRequiredOptionValue(option);
        break;
      case "--reason": {
        const value = reader.readRequiredOptionValue(option);
        changeReason = setChangeReason(
          changeReason,
          value === "-" ? { kind: "stdin" } : { kind: "inline", value }
        );
        break;
      }
      case "--reason-file":
        changeReason = setChangeReason(changeReason, {
          kind: "file",
          path: reader.readRequiredOptionValue(option),
        });
        break;
      case "--group":
        changeGroup = reader.readRequiredOptionValue(option);
        break;
      case "--bump":
        readChangeBump(reader.readRequiredOptionValue(option));
        changeBump = true;
        break;
      case "--append":
        assertBooleanOption(option);
        changeAppend = true;
        break;
      case "--staged":
        assertBooleanOption(option);
        changeStaged = true;
        break;
      case "--use": {
        const value = reader.readRequiredOptionValue(option);
        if (value !== "source" && value !== "output") {
          throw new Error("skillset: --use expects source or output");
        }
        choice = value;
        break;
      }
      case "--scope":
        scopes = readBuildScopes(reader.readRequiredOptionValue(option));
        break;
      case "--updated":
      case "--all":
        assertBooleanOption(option);
        buildMode = mergeBuildMode(
          buildMode,
          option.flag === "--all" ? "all" : "updated"
        );
        break;
      case "--yes":
        assertBooleanOption(option);
        yes = true;
        break;
      case "--json":
        assertBooleanOption(option);
        jsonOutput = true;
        break;
      case "--list":
        assertBooleanOption(option);
        list = true;
        break;
      case "--write":
        assertBooleanOption(option);
        throw new Error(
          "skillset: --write is only supported with check or dev"
        );
      case "--name":
        reader.readRequiredOptionValue(option);
        break;
      case "--kind":
        readImportKind(reader.readRequiredOptionValue(option));
        break;
      case "--from":
        readImportProvider(reader.readRequiredOptionValue(option));
        break;
      default:
        throw new Error(`skillset: unknown option ${option.raw}`);
    }
  }
  return {
    buildMode,
    changeFlag:
      changeAppend ||
      changeBump ||
      changeGroup !== undefined ||
      changeReason !== undefined ||
      changeRef !== undefined ||
      changeStaged,
    changeSince,
    choice,
    jsonOutput,
    list,
    rootPath: resolveCliRoot(context, rootPath),
    scopes,
    yes,
  };
};

const validateRecoveryOwnership = (parsed: RecoveryOptions): void => {
  if (parsed.changeFlag) {
    throw new Error(
      "skillset: change options are only supported with change commands"
    );
  }
  if (parsed.changeSince !== undefined) {
    throw new Error(
      "skillset: --since is only supported with check --ci or change commands"
    );
  }
};

const readRequiredPath = (
  value: string | undefined,
  expectation: string
): string => {
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`skillset: expected ${expectation}`);
  }
  return value;
};
