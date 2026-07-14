import type {
  SkillsetOptions,
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
  readTargetName,
  readTargetNames,
  resolveCliRoot,
  tokenizeCsv,
} from "./cli-arg-values";
import type { CliParseContext } from "./cli-arg-values";
import { addLookupTargets, setLookupField } from "./lookup-cli";
import {
  readHookRuntimeContextField,
  readHookRuntimeContextFormat,
} from "./runtime-hooks";
import type { TestCommandRequest } from "./test-cli";
import type { TryClaudeSettingSources, TrySubcommand } from "./try";
import { isTrySubcommand, validateTryFlags } from "./try-cli";

export const parseTestCommandRequest = (
  args: readonly string[],
  context: CliParseContext
): TestCommandRequest => {
  let index = 1;
  let trySubcommand: TrySubcommand | undefined;
  const first = args[index];
  if (isTrySubcommand(first)) {
    trySubcommand = first;
    index += 1;
  }

  let tryRunId: string | undefined;
  if (
    trySubcommand === "status" ||
    trySubcommand === "tail" ||
    trySubcommand === "worker"
  ) {
    const value = args[index];
    if (value !== undefined && !value.startsWith("--")) {
      tryRunId = value;
      index += 1;
    }
  }

  let testName: string | undefined;
  if (trySubcommand === undefined) {
    const value = args[index];
    if (value !== undefined && !value.startsWith("--")) {
      testName = value;
      index += 1;
    }
  }

  let buildMode: "all" | "updated" | undefined;
  let jsonOutput = false;
  let jsonlOutput = false;
  let rootPath: string | undefined;
  let scopes: SkillsetOptions["scopes"];
  let tryBackground = false;
  let tryClaudeSettingSources: TryClaudeSettingSources | undefined;
  let tryLines: number | undefined;
  let tryName: string | undefined;
  let tryPlugins: string[] = [];
  let tryPrompt: string | undefined;
  let tryPromptFile: string | undefined;
  let tryTarget: TargetName | undefined;
  let tryTimeoutMs: number | undefined;
  let yes = false;
  let hookContext = false;
  let hookPrint = false;
  let lookupField: string | undefined;
  let lookupTargets: TargetName[] = [];
  let lookupView = false;
  let newFlag = false;
  let reconcileFlag = false;
  let workerUnsupported = false;
  let adoptFlag = false;
  let changeFlag = false;
  let changeReason: ChangeReasonInput | undefined;
  let isolated = false;
  let readinessFlag = false;
  let setupFlag = false;
  let sinceFlag = false;
  const reader = new CliArgReader(args, index);
  while (!reader.done) {
    const option = reader.readOption();
    if (option === undefined) {
      break;
    }
    if (trySubcommand === "worker" && option.flag !== "--root") {
      workerUnsupported = true;
    }
    switch (option.flag) {
      case "--root": {
        rootPath = reader.readRequiredOptionValue(option);
        break;
      }
      case "--target": {
        tryTarget = readTargetName(reader.readRequiredOptionValue(option));
        break;
      }
      case "--prompt": {
        tryPrompt = reader.readRequiredOptionValue(option);
        break;
      }
      case "--prompt-file": {
        tryPromptFile = reader.readRequiredOptionValue(option);
        break;
      }
      case "--plugin": {
        tryPlugins = [...tryPlugins, reader.readRequiredOptionValue(option)];
        break;
      }
      case "--claude-setting-sources": {
        tryClaudeSettingSources = readClaudeSettingSources(
          reader.readRequiredOptionValue(option),
          "--claude-setting-sources"
        );
        break;
      }
      case "--timeout-ms": {
        tryTimeoutMs = readPositiveInteger(
          reader.readRequiredOptionValue(option),
          "--timeout-ms"
        );
        break;
      }
      case "--lines": {
        tryLines = readPositiveInteger(
          reader.readRequiredOptionValue(option),
          "--lines"
        );
        break;
      }
      case "--name": {
        tryName = reader.readRequiredOptionValue(option);
        break;
      }
      case "--background": {
        assertBooleanOption(option);
        tryBackground = true;
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
      case "--runner": {
        readHookRunner(reader.readRequiredOptionValue(option));
        hookPrint = true;
        break;
      }
      case "--agent-runtime":
      case "--pre-commit":
      case "--pre-push": {
        assertBooleanOption(option);
        hookPrint = true;
        break;
      }
      case "--event": {
        reader.readRequiredOptionValue(option);
        hookContext = true;
        break;
      }
      case "--format": {
        readHookRuntimeContextFormat(reader.readRequiredOptionValue(option));
        hookContext = true;
        break;
      }
      case "--context-fields": {
        const fields = tokenizeCsv(reader.readRequiredOptionValue(option));
        if (fields.length === 0) {
          throw new Error(
            "skillset: --context-fields requires at least one field"
          );
        }
        fields.map(readHookRuntimeContextField);
        hookContext = true;
        break;
      }
      case "--kind":
      case "--from": {
        reader.readRequiredOptionValue(option);
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
      case "--since": {
        reader.readRequiredOptionValue(option);
        sinceFlag = true;
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
  if (hookPrint) {
    throw new Error(
      "skillset: hook options are only supported with hooks print"
    );
  }
  if (hookContext) {
    throw new Error(
      "skillset: hook context options are only supported with hooks context"
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
  if (sinceFlag) {
    throw new Error(
      "skillset: --since is only supported with check --ci or change commands"
    );
  }

  const hasAdHocFlags =
    trySubcommand !== undefined ||
    tryTarget !== undefined ||
    tryPrompt !== undefined ||
    tryPromptFile !== undefined ||
    tryPlugins.length > 0 ||
    tryName !== undefined ||
    tryTimeoutMs !== undefined ||
    tryClaudeSettingSources !== undefined ||
    tryBackground;
  if (testName !== undefined && hasAdHocFlags) {
    throw new Error(
      `skillset: declared test ${testName} cannot be combined with ad hoc test flags`
    );
  }
  validateTryFlags("test", trySubcommand, {
    background: tryBackground,
    ...(buildMode === undefined ? {} : { buildMode }),
    ...(tryClaudeSettingSources === undefined
      ? {}
      : { claudeSettingSources: tryClaudeSettingSources }),
    ...(tryLines === undefined ? {} : { lines: tryLines }),
    ...(tryName === undefined ? {} : { name: tryName }),
    plugins: tryPlugins,
    ...(tryPrompt === undefined ? {} : { prompt: tryPrompt }),
    ...(tryPromptFile === undefined ? {} : { promptFile: tryPromptFile }),
    ...(scopes === undefined ? {} : { scopes }),
    ...(tryTarget === undefined ? {} : { target: tryTarget }),
    ...(tryTimeoutMs === undefined ? {} : { timeoutMs: tryTimeoutMs }),
    yes,
  });
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
  if (trySubcommand === "worker") {
    if (tryRunId === undefined) {
      throw new Error("skillset: test worker requires run id");
    }
    if (workerUnsupported) {
      throw new Error(
        "skillset: test worker only supports <run-id> and --root <path>"
      );
    }
  }
  if (buildMode !== undefined || scopes !== undefined || yes) {
    throw new Error(
      "skillset: build/write options are not supported with test; test output always writes under logical .skillset/cache/tests"
    );
  }
  if (reconcileFlag) {
    throw new Error("skillset: --use is only supported with reconcile");
  }
  if (newFlag) {
    throw new Error("skillset: new options are only supported with new");
  }
  return {
    jsonOutput,
    options: {},
    rootPath: resolveCliRoot(context, rootPath),
    testName,
    tryBackground,
    tryClaudeSettingSources,
    tryLines,
    tryName,
    tryPlugins,
    tryPrompt,
    tryPromptFile,
    tryRunId,
    trySubcommand,
    tryTarget,
    tryTimeoutMs,
  };
};

const readHookRunner = (value: string): void => {
  if (
    value !== "git" &&
    value !== "husky" &&
    value !== "lefthook" &&
    value !== "pre-commit"
  ) {
    throw new Error(
      "skillset: expected --runner lefthook, husky, pre-commit, or git"
    );
  }
};
