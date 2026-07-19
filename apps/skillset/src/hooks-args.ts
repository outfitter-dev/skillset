import type {
  BuildScope,
  CompileBuildMode,
  TargetName,
} from "@skillset/core/internal/types";

import { readChangeBump, setChangeReason } from "./change-args";
import type { ChangeReasonInput } from "./change-workflow";
import { assertBooleanOption, CliArgReader } from "./cli-arg-reader";
import {
  mergeBuildMode,
  readBuildScopes,
  readClaudeSettingSources,
  readPositiveInteger,
  readTargetNames,
  resolveCliRoot,
  tokenizeCsv,
} from "./cli-arg-values";
import type { CliParseContext } from "./cli-arg-values";
import type { HooksCommandRequest } from "./hooks-cli";
import { addLookupTargets, setLookupField } from "./lookup-cli";
import {
  readHookRuntimeContextField,
  readHookRuntimeContextFormat,
  readHookRunEvent,
} from "./runtime-hooks";
import type {
  HookRuntimeContextField,
  HookRuntimeContextFormat,
  HookRunner,
  HookSubcommand,
} from "./runtime-hooks";
import { readImportKind, readImportProvider } from "./source-arg-values";

export const parseHooksCommandRequest = (
  args: readonly string[],
  context: CliParseContext
): HooksCommandRequest => {
  const hookSubcommand = readHookSubcommand(args[1]);
  let index = 2;
  let hookRunEvent: ReturnType<typeof readHookRunEvent> | undefined;
  if (hookSubcommand === "run") {
    hookRunEvent = readHookRunEvent(args[index]);
    index += 1;
  }

  let buildMode: CompileBuildMode | undefined;
  let changeSince: string | undefined;
  let hookAgentRuntime = false;
  let hookContextEvent: string | undefined;
  let hookContextFields: readonly HookRuntimeContextField[] | undefined;
  let hookContextFormat: HookRuntimeContextFormat | undefined;
  let hookPreCommit = false;
  let hookPrePush = false;
  let hookRunner: HookRunner | undefined;
  let hookTarget: TargetName | undefined;
  let importMetadata = false;
  let rootExplicit = false;
  let rootPath: string | undefined;
  let scopes: readonly BuildScope[] | undefined;
  let yes = false;
  let jsonOutput = false;
  let jsonlOutput = false;
  let lookupField: string | undefined;
  let lookupTargets: TargetName[] = [];
  let lookupView = false;
  let testFlag = false;
  let isolated = false;
  let newFlag = false;
  let reconcileFlag = false;
  let adoptFlag = false;
  let changeFlag = false;
  let changeReason: ChangeReasonInput | undefined;
  let readinessFlag = false;
  let setupFlag = false;
  const reader = new CliArgReader(args, index);
  while (!reader.done) {
    const option = reader.readOption();
    if (option === undefined) {
      break;
    }
    switch (option.flag) {
      case "--root": {
        rootPath = reader.readRequiredOptionValue(option);
        rootExplicit = true;
        break;
      }
      case "--runner": {
        hookRunner = readHookRunner(reader.readRequiredOptionValue(option));
        break;
      }
      case "--target": {
        hookTarget = readHookTarget(reader.readRequiredOptionValue(option));
        break;
      }
      case "--event": {
        hookContextEvent = reader.readRequiredOptionValue(option);
        break;
      }
      case "--format": {
        hookContextFormat = readHookRuntimeContextFormat(
          reader.readRequiredOptionValue(option)
        );
        break;
      }
      case "--context-fields": {
        hookContextFields = readHookRuntimeContextFields(
          reader.readRequiredOptionValue(option)
        );
        break;
      }
      case "--agent-runtime": {
        assertBooleanOption(option);
        hookAgentRuntime = true;
        break;
      }
      case "--pre-commit": {
        assertBooleanOption(option);
        hookPreCommit = true;
        break;
      }
      case "--pre-push": {
        assertBooleanOption(option);
        hookPrePush = true;
        break;
      }
      case "--updated":
      case "--all": {
        assertBooleanOption(option);
        buildMode = mergeBuildMode(
          buildMode,
          option.flag === "--all" ? "all" : "updated"
        );
        break;
      }
      case "--scope": {
        scopes = readBuildScopes(reader.readRequiredOptionValue(option));
        break;
      }
      case "--since": {
        changeSince = reader.readRequiredOptionValue(option);
        break;
      }
      case "--yes": {
        assertBooleanOption(option);
        yes = true;
        break;
      }
      case "--json": {
        assertBooleanOption(option);
        jsonOutput = true;
        break;
      }
      case "--jsonl": {
        assertBooleanOption(option);
        jsonlOutput = true;
        break;
      }
      case "--compat": {
        lookupView = true;
        for (const value of reader.readOptionalOptionValues(option)) {
          lookupTargets = addLookupTargets(lookupTargets, value);
        }
        break;
      }
      case "--frontmatter":
      case "--fields":
      case "--values":
      case "--events":
      case "--examples":
      case "--schema": {
        assertBooleanOption(option);
        lookupView = true;
        break;
      }
      case "--field": {
        lookupField = setLookupField(
          lookupField,
          reader.readRequiredOptionValue(option)
        );
        break;
      }
      case "--prompt":
      case "--prompt-file":
      case "--plugin": {
        reader.readRequiredOptionValue(option);
        testFlag = true;
        break;
      }
      case "--claude-setting-sources": {
        readClaudeSettingSources(
          reader.readRequiredOptionValue(option),
          "--claude-setting-sources"
        );
        testFlag = true;
        break;
      }
      case "--timeout-ms":
      case "--lines": {
        readPositiveInteger(
          reader.readRequiredOptionValue(option),
          option.flag
        );
        testFlag = true;
        break;
      }
      case "--background": {
        assertBooleanOption(option);
        testFlag = true;
        break;
      }
      case "--name":
        reader.readRequiredOptionValue(option);
        importMetadata = true;
        break;
      case "--kind":
        readImportKind(reader.readRequiredOptionValue(option));
        importMetadata = true;
        break;
      case "--from": {
        readImportProvider(reader.readRequiredOptionValue(option));
        importMetadata = true;
        break;
      }
      case "--append":
      case "--staged": {
        assertBooleanOption(option);
        changeFlag = true;
        break;
      }
      case "--group":
      case "--ref": {
        reader.readRequiredOptionValue(option);
        changeFlag = true;
        break;
      }
      case "--bump": {
        readChangeBump(reader.readRequiredOptionValue(option));
        changeFlag = true;
        break;
      }
      case "--reason": {
        const value = reader.readRequiredOptionValue(option);
        changeReason = setChangeReason(
          changeReason,
          value === "-" ? { kind: "stdin" } : { kind: "inline", value }
        );
        changeFlag = true;
        break;
      }
      case "--reason-file": {
        changeReason = setChangeReason(changeReason, {
          kind: "file",
          path: reader.readRequiredOptionValue(option),
        });
        changeFlag = true;
        break;
      }
      case "--targets": {
        readTargetNames(reader.readRequiredOptionValue(option));
        setupFlag = true;
        break;
      }
      case "--include": {
        const includes = tokenizeCsv(reader.readRequiredOptionValue(option));
        if (includes.length === 0) {
          throw new Error("skillset: --include requires at least one value");
        }
        if (includes.some((include) => include !== "ci")) {
          throw new Error("skillset: expected --include ci");
        }
        setupFlag = true;
        break;
      }
      case "--adopt": {
        reader.readRequiredOptionValue(option);
        adoptFlag = true;
        break;
      }
      case "--fix":
      case "--ci": {
        assertBooleanOption(option);
        readinessFlag = true;
        break;
      }
      case "--only":
      case "--report": {
        const value = reader.readRequiredOptionValue(option);
        if (option.flag === "--only" && value !== "outputs") {
          throw new Error("skillset: expected --only outputs");
        }
        readinessFlag = true;
        break;
      }
      case "--write": {
        assertBooleanOption(option);
        throw new Error(
          "skillset: --write is only supported with check or dev"
        );
      }
      case "--isolated": {
        assertBooleanOption(option);
        isolated = true;
        break;
      }
      case "--use": {
        const value = reader.readRequiredOptionValue(option);
        if (value !== "source" && value !== "output") {
          throw new Error("skillset: --use expects source or output");
        }
        reconcileFlag = true;
        break;
      }
      case "--id":
      case "--in":
      case "--preset": {
        reader.readRequiredOptionValue(option);
        newFlag = true;
        break;
      }
      default: {
        throw new Error(`skillset: unknown option ${option.raw}`);
      }
    }
  }

  if (changeFlag) {
    throw new Error(
      "skillset: change options are only supported with change commands"
    );
  }
  const hasPrintFlag =
    hookAgentRuntime ||
    hookPreCommit ||
    hookPrePush ||
    hookRunner !== undefined ||
    hookTarget !== undefined;
  if (hasPrintFlag && hookSubcommand !== "print") {
    throw new Error(
      "skillset: hook options are only supported with hooks print"
    );
  }
  const hasContextFlag =
    hookContextEvent !== undefined ||
    hookContextFields !== undefined ||
    hookContextFormat !== undefined;
  if (hasContextFlag && hookSubcommand !== "context") {
    throw new Error(
      "skillset: hook context options are only supported with hooks context"
    );
  }
  if (hookSubcommand === "context" && hookContextEvent === undefined) {
    throw new Error("skillset: hooks context requires --event");
  }
  if (hookSubcommand === "print" && rootExplicit) {
    throw new Error("skillset: --root is not supported with hooks print");
  }
  if (
    buildMode !== undefined ||
    scopes !== undefined ||
    changeSince !== undefined ||
    importMetadata ||
    yes
  ) {
    throw new Error(
      `skillset: non-hook options are not supported with hooks ${hookSubcommand}`
    );
  }
  if (setupFlag) {
    throw new Error("skillset: setup options are only supported with init");
  }
  if (adoptFlag) {
    throw new Error(
      "skillset: --adopt and init acquisition --from are only supported with init"
    );
  }
  if (readinessFlag) {
    throw new Error("skillset: readiness flags are only supported with check");
  }
  if (testFlag) {
    throw new Error(
      "skillset: ad hoc test options are only supported with test"
    );
  }
  if (jsonOutput) {
    throw new Error("skillset: --json is not supported for this command route");
  }
  if (jsonlOutput) {
    throw new Error("skillset: unknown option --jsonl");
  }
  if (lookupField !== undefined || lookupTargets.length > 0 || lookupView) {
    throw new Error("skillset: lookup flags are only supported with lookup");
  }
  if (isolated) {
    throw new Error(
      "skillset: --isolated is only supported with build, check --only outputs, or diff"
    );
  }
  if (reconcileFlag) {
    throw new Error("skillset: --use is only supported with reconcile");
  }
  if (newFlag) {
    throw new Error("skillset: new options are only supported with new");
  }
  return {
    hookAgentRuntime,
    hookContextEvent,
    hookContextFields,
    hookContextFormat,
    hookPreCommit,
    hookPrePush,
    hookRunEvent,
    hookRunner,
    hookSubcommand,
    hookTarget,
    rootPath: resolveCliRoot(context, rootPath),
  };
};

const readHookSubcommand = (value: string | undefined): HookSubcommand => {
  if (value === "context" || value === "print" || value === "run") {
    return value;
  }
  throw new Error("skillset: expected hooks subcommand context, print, or run");
};

const readHookRuntimeContextFields = (
  value: string
): readonly HookRuntimeContextField[] => {
  const fields = tokenizeCsv(value);
  if (fields.length === 0) {
    throw new Error("skillset: --context-fields requires at least one field");
  }
  return fields.map(readHookRuntimeContextField);
};

const readHookRunner = (value: string): HookRunner => {
  if (
    value === "git" ||
    value === "husky" ||
    value === "lefthook" ||
    value === "pre-commit"
  ) {
    return value;
  }
  throw new Error(
    "skillset: expected --runner lefthook, husky, pre-commit, or git"
  );
};

const readHookTarget = (value: string): TargetName => {
  if (value === "claude" || value === "codex") {
    return value;
  }
  if (value === "cursor") {
    throw new Error("skillset: hooks print --agent-runtime only supports --target claude or --target codex; Cursor has no documented runtime hook destination");
  }
  throw new Error("skillset: expected --target claude or codex");
};
