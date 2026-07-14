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
import type { ReleaseSubcommand } from "./release";
import type { ReleaseCommandRequest } from "./release-cli";

export const parseReleaseCommandRequest = (
  args: readonly string[],
  context: CliParseContext
): ReleaseCommandRequest => {
  const releaseSubcommand = readReleaseSubcommand(args[1]);
  let index = 2;
  let releaseRef: string | undefined;
  const positionalRef = args[index];
  if (
    releaseSubcommand === "amend" &&
    positionalRef !== undefined &&
    !positionalRef.startsWith("--")
  ) {
    releaseRef = positionalRef;
    index += 1;
  }
  let buildMode: "all" | "updated" | undefined;
  let changeAppend = false;
  let changeBump = false;
  let changeGroup: string | undefined;
  let changeReason: ChangeReasonInput | undefined;
  let changeRef: string | undefined;
  let changeSince: string | undefined;
  let changeStaged = false;
  let jsonOutput = false;
  let reconcileChoice: "output" | "source" | undefined;
  let releaseReason: ChangeReasonInput | undefined;
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
      case "--ref":
        if (releaseSubcommand === "amend") {
          releaseRef = reader.readRequiredOptionValue(option);
        } else {
          changeRef = reader.readRequiredOptionValue(option);
        }
        break;
      case "--reason": {
        const value = reader.readRequiredOptionValue(option);
        const reason: ChangeReasonInput =
          value === "-" ? { kind: "stdin" } : { kind: "inline", value };
        if (releaseSubcommand === "amend") {
          releaseReason = setChangeReason(releaseReason, reason);
        } else {
          changeReason = setChangeReason(changeReason, reason);
        }
        break;
      }
      case "--reason-file": {
        const reason = {
          kind: "file",
          path: reader.readRequiredOptionValue(option),
        } as const;
        if (releaseSubcommand === "amend") {
          releaseReason = setChangeReason(releaseReason, reason);
        } else {
          changeReason = setChangeReason(changeReason, reason);
        }
        break;
      }
      case "--since":
        changeSince = reader.readRequiredOptionValue(option);
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
        reconcileChoice = value;
        break;
      }
      case "--yes":
        assertBooleanOption(option);
        yes = true;
        break;
      case "--json":
        assertBooleanOption(option);
        jsonOutput = true;
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
      case "--name":
      case "--kind":
      case "--from":
        reader.readRequiredOptionValue(option);
        break;
      default:
        throw new Error(`skillset: unknown option ${option.raw}`);
    }
  }

  if (
    changeAppend ||
    changeBump ||
    changeGroup !== undefined ||
    changeReason !== undefined ||
    changeRef !== undefined ||
    changeStaged
  ) {
    throw new Error(
      "skillset: change options are only supported with change commands"
    );
  }
  if (changeSince !== undefined) {
    throw new Error(
      "skillset: --since is only supported with check --ci or change commands"
    );
  }
  if (scopes !== undefined) {
    throw new Error(
      "skillset: --scope is not supported with release commands yet"
    );
  }
  if (releaseSubcommand !== "apply" && yes) {
    throw new Error("skillset: --yes is only supported with release apply");
  }
  if (releaseReason !== undefined && releaseSubcommand !== "amend") {
    throw new Error(
      "skillset: --reason and --reason-file are only supported with release amend"
    );
  }
  if (releaseRef !== undefined && releaseSubcommand !== "amend") {
    throw new Error("skillset: --ref is only supported with release amend");
  }
  if (reconcileChoice !== undefined) {
    throw new Error("skillset: --use is only supported with reconcile");
  }
  return {
    jsonOutput,
    options: {
      ...(buildMode === undefined ? {} : { buildMode }),
    },
    releaseReason,
    releaseRef,
    releaseSubcommand,
    rootPath: resolveCliRoot(context, rootPath),
    yes,
  };
};

export const isReleaseSubcommand = (
  value: string | undefined
): value is ReleaseSubcommand =>
  value === "amend" ||
  value === "apply" ||
  value === "audit" ||
  value === "plan";

const readReleaseSubcommand = (
  value: string | undefined
): ReleaseSubcommand => {
  if (isReleaseSubcommand(value)) return value;
  throw new Error(
    "skillset: expected release subcommand amend, apply, audit, or plan"
  );
};
