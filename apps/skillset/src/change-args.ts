import { sourceUnitSelector } from "@skillset/core/internal/source-unit-selector";
import type { SkillsetOptions } from "@skillset/core/internal/types";

import type { ChangeCommandRequest } from "./change-cli";
import type { ChangeBump } from "./change-entries";
import type { ChangeReasonInput, ChangeSubcommand } from "./change-workflow";
import { assertBooleanOption, CliArgReader } from "./cli-arg-reader";
import { mergeBuildMode, resolveCliRoot, tokenizeCsv } from "./cli-arg-values";
import type { CliParseContext } from "./cli-arg-values";
import { readImportKind, readImportProvider } from "./source-arg-values";

export const parseChangeCommandRequest = (
  args: readonly string[],
  context: CliParseContext
): ChangeCommandRequest => {
  const changeSubcommand = readChangeSubcommand(args[1]);
  let index = 2;
  let changeRef: string | undefined;
  const positionalRef = args[index];
  if (
    supportsPositionalRef(changeSubcommand) &&
    positionalRef !== undefined &&
    !positionalRef.startsWith("--")
  ) {
    changeRef = positionalRef;
    index += 1;
  }

  let buildMode: "all" | "updated" | undefined;
  let changeAppend = false;
  let changeBump: ChangeBump | undefined;
  let changeGroup: string | undefined;
  let changeReason: ChangeReasonInput | undefined;
  let changeScopes: readonly string[] | undefined;
  let changeSince: string | undefined;
  let changeStaged = false;
  let jsonOutput = false;
  let reconcileChoice: "output" | "source" | undefined;
  let rootPath: string | undefined;
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
        changeRef = reader.readRequiredOptionValue(option);
        break;
      case "--since":
        changeSince = reader.readRequiredOptionValue(option);
        break;
      case "--scope":
        changeScopes = readChangeScopesForSubcommand(
          changeSubcommand,
          changeScopes,
          reader.readRequiredOptionValue(option)
        );
        break;
      case "--group":
        changeGroup = reader.readRequiredOptionValue(option);
        break;
      case "--reason":
        changeReason = setChangeReason(
          changeReason,
          readInlineReason(reader.readRequiredOptionValue(option))
        );
        break;
      case "--reason-file":
        changeReason = setChangeReason(changeReason, {
          kind: "file",
          path: reader.readRequiredOptionValue(option),
        });
        break;
      case "--bump":
        changeBump = readChangeBump(reader.readRequiredOptionValue(option));
        break;
      case "--use": {
        const value = reader.readRequiredOptionValue(option);
        if (value !== "source" && value !== "output") {
          throw new Error("skillset: --use expects source or output");
        }
        reconcileChoice = value;
        break;
      }
      case "--append":
        assertBooleanOption(option);
        changeAppend = true;
        break;
      case "--staged":
        assertBooleanOption(option);
        changeStaged = true;
        break;
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

  validateChangeOptions(changeSubcommand, {
    append: changeAppend,
    buildMode,
    bump: changeBump,
    group: changeGroup,
    reason: changeReason,
    ref: changeRef,
    scopes: changeScopes,
    since: changeSince,
    staged: changeStaged,
    yes,
  });
  if (reconcileChoice !== undefined) {
    throw new Error("skillset: --use is only supported with reconcile");
  }
  validateRequiredChangeInputs(changeSubcommand, {
    bump: changeBump,
    ref: changeRef,
    scopes: changeScopes,
  });
  const options: SkillsetOptions = {
    ...(buildMode === undefined ? {} : { buildMode }),
  };
  return {
    changeAppend,
    changeBump,
    changeGroup,
    changeReason,
    changeRef,
    changeScopes,
    changeSince,
    changeStaged,
    changeSubcommand,
    jsonOutput,
    options,
    rootPath: resolveCliRoot(context, rootPath),
    yes,
  };
};

export const isChangeSubcommand = (
  value: string | undefined
): value is ChangeSubcommand =>
  value === "add" ||
  value === "amend" ||
  value === "check" ||
  value === "history" ||
  value === "list" ||
  value === "migrate" ||
  value === "reason" ||
  value === "refresh" ||
  value === "show" ||
  value === "status";

export const readChangeScopes = (value: string): readonly string[] => {
  const scopes = tokenizeCsv(value);
  if (scopes.length === 0) {
    throw new Error(
      "skillset: --scope requires at least one source unit scope"
    );
  }
  return scopes.map(sourceUnitSelector);
};

export const readChangeBump = (value: string): ChangeBump => {
  if (
    value === "major" ||
    value === "minor" ||
    value === "none" ||
    value === "patch"
  ) {
    return value;
  }
  throw new Error("skillset: expected --bump major, minor, patch, or none");
};

export const setChangeReason = (
  current: ChangeReasonInput | undefined,
  next: ChangeReasonInput
): ChangeReasonInput => {
  if (current !== undefined) {
    throw new Error("skillset: pass only one of --reason or --reason-file");
  }
  return next;
};

const readChangeSubcommand = (value: string | undefined): ChangeSubcommand => {
  if (isChangeSubcommand(value)) return value;
  throw new Error(
    "skillset: expected change subcommand add, amend, check, history, list, migrate, reason, refresh, show, or status"
  );
};

const supportsPositionalRef = (subcommand: ChangeSubcommand): boolean =>
  subcommand === "amend" ||
  subcommand === "check" ||
  subcommand === "history" ||
  subcommand === "reason" ||
  subcommand === "refresh" ||
  subcommand === "show";

const readInlineReason = (value: string): ChangeReasonInput =>
  value === "-" ? { kind: "stdin" } : { kind: "inline", value };

const readChangeScopesForSubcommand = (
  subcommand: ChangeSubcommand,
  current: readonly string[] | undefined,
  value: string
): readonly string[] => {
  if (subcommand === "add") {
    return [...(current ?? []), ...readChangeScopes(value)];
  }
  if (subcommand === "status" || subcommand === "check") {
    throw new Error(
      `skillset: change ${subcommand} is a whole-source command; --scope is not supported`
    );
  }
  throw new Error(
    "skillset: --scope is only supported with change add source-unit entries"
  );
};

const validateChangeOptions = (
  subcommand: ChangeSubcommand,
  change: {
    readonly append: boolean;
    readonly buildMode: "all" | "updated" | undefined;
    readonly bump: ChangeBump | undefined;
    readonly group: string | undefined;
    readonly reason: ChangeReasonInput | undefined;
    readonly ref: string | undefined;
    readonly scopes: readonly string[] | undefined;
    readonly since: string | undefined;
    readonly staged: boolean;
    readonly yes: boolean;
  }
): void => {
  if (subcommand === "refresh" && (change.since !== undefined || change.buildMode !== undefined)) {
    throw new Error("skillset: change refresh only supports @ref, --ref, --yes, --json, and --root");
  }
  if (change.yes && subcommand !== "migrate" && subcommand !== "refresh") {
    throw new Error("skillset: --yes is only supported with change migrate or change refresh");
  }
  if (change.append && subcommand !== "reason") {
    throw new Error("skillset: --append is only supported with change reason");
  }
  if (change.bump !== undefined && subcommand !== "add") {
    throw new Error("skillset: --bump is only supported with change add");
  }
  if (
    change.group !== undefined &&
    subcommand !== "add" &&
    subcommand !== "list"
  ) {
    throw new Error(
      "skillset: --group is only supported with change add or change list"
    );
  }
  if (
    change.reason !== undefined &&
    subcommand !== "add" &&
    subcommand !== "amend" &&
    subcommand !== "reason"
  ) {
    throw new Error(
      "skillset: --reason and --reason-file are only supported with change add, change amend, or change reason"
    );
  }
  if (change.ref !== undefined && !supportsPositionalRef(subcommand)) {
    throw new Error(
      "skillset: --ref is only supported with change amend, change check, change history, change reason, change refresh, or change show"
    );
  }
  if (change.scopes !== undefined && subcommand !== "add") {
    throw new Error(
      "skillset: source-unit --scope is only supported with change add"
    );
  }
  if (change.staged && subcommand !== "check" && subcommand !== "status") {
    throw new Error(
      "skillset: --staged is only supported with change status or change check"
    );
  }
};

const validateRequiredChangeInputs = (
  subcommand: ChangeSubcommand,
  change: {
    readonly bump: ChangeBump | undefined;
    readonly ref: string | undefined;
    readonly scopes: readonly string[] | undefined;
  }
): void => {
  if (subcommand === "add" && change.scopes === undefined) {
    throw new Error("skillset: change add requires at least one --scope");
  }
  if (subcommand === "add" && change.bump === undefined) {
    throw new Error(
      "skillset: change add requires --bump major, minor, patch, or none"
    );
  }
  if (
    (subcommand === "amend" ||
      subcommand === "reason" ||
      subcommand === "show") &&
    change.ref === undefined
  ) {
    throw new Error(`skillset: change ${subcommand} requires @ref`);
  }
};
