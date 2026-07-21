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
import { readImportKind, readImportProvider } from "./source-arg-values";
import type { TestCommandRequest } from "./test-cli";
import type { AdHocTestClaudeSettingSources, AdHocTestSubcommand } from "./ad-hoc-test";
import { isAdHocTestSubcommand, validateAdHocTestFlags } from "./ad-hoc-test-cli";

export const parseTestCommandRequest = (
  args: readonly string[],
  context: CliParseContext
): TestCommandRequest => {
  let index = 1;
  let adHocSubcommand: AdHocTestSubcommand | undefined;
  const first = args[index];
  if (isAdHocTestSubcommand(first)) {
    adHocSubcommand = first;
    index += 1;
  }

  let adHocRunId: string | undefined;
  if (
    adHocSubcommand === "status" ||
    adHocSubcommand === "tail" ||
    adHocSubcommand === "worker"
  ) {
    const value = args[index];
    if (value !== undefined && !value.startsWith("--")) {
      adHocRunId = value;
      index += 1;
    }
  }

  let testName: string | undefined;
  if (adHocSubcommand === undefined) {
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
  let adHocBackground = false;
  let adHocClaudeSettingSources: AdHocTestClaudeSettingSources | undefined;
  let adHocLines: number | undefined;
  let adHocName: string | undefined;
  let adHocPlugins: string[] = [];
  let adHocPrompt: string | undefined;
  let adHocPromptFile: string | undefined;
  let adHocTarget: TargetName | undefined;
  let adHocTimeoutMs: number | undefined;
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
    if (adHocSubcommand === "worker" && option.flag !== "--root") {
      workerUnsupported = true;
    }
    switch (option.flag) {
      case "--root": {
        rootPath = reader.readRequiredOptionValue(option);
        break;
      }
      case "--target": {
        adHocTarget = readTargetName(reader.readRequiredOptionValue(option));
        break;
      }
      case "--prompt": {
        adHocPrompt = reader.readRequiredOptionValue(option);
        break;
      }
      case "--prompt-file": {
        adHocPromptFile = reader.readRequiredOptionValue(option);
        break;
      }
      case "--plugin": {
        adHocPlugins = [...adHocPlugins, reader.readRequiredOptionValue(option)];
        break;
      }
      case "--claude-setting-sources": {
        adHocClaudeSettingSources = readClaudeSettingSources(
          reader.readRequiredOptionValue(option),
          "--claude-setting-sources"
        );
        break;
      }
      case "--timeout-ms": {
        adHocTimeoutMs = readPositiveInteger(
          reader.readRequiredOptionValue(option),
          "--timeout-ms"
        );
        break;
      }
      case "--lines": {
        adHocLines = readPositiveInteger(
          reader.readRequiredOptionValue(option),
          "--lines"
        );
        break;
      }
      case "--name": {
        adHocName = reader.readRequiredOptionValue(option);
        break;
      }
      case "--background": {
        assertBooleanOption(option);
        adHocBackground = true;
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
        readImportKind(reader.readRequiredOptionValue(option));
        break;
      case "--from": {
        readImportProvider(reader.readRequiredOptionValue(option));
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
    throw new Error("skillset: --adopt is only supported with init");
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
    adHocSubcommand !== undefined ||
    adHocTarget !== undefined ||
    adHocPrompt !== undefined ||
    adHocPromptFile !== undefined ||
    adHocPlugins.length > 0 ||
    adHocName !== undefined ||
    adHocTimeoutMs !== undefined ||
    adHocClaudeSettingSources !== undefined ||
    adHocBackground;
  if (testName !== undefined && hasAdHocFlags) {
    throw new Error(
      `skillset: declared test ${testName} cannot be combined with ad hoc test flags`
    );
  }
  validateAdHocTestFlags("test", adHocSubcommand, {
    background: adHocBackground,
    ...(buildMode === undefined ? {} : { buildMode }),
    ...(adHocClaudeSettingSources === undefined
      ? {}
      : { claudeSettingSources: adHocClaudeSettingSources }),
    ...(adHocLines === undefined ? {} : { lines: adHocLines }),
    ...(adHocName === undefined ? {} : { name: adHocName }),
    plugins: adHocPlugins,
    ...(adHocPrompt === undefined ? {} : { prompt: adHocPrompt }),
    ...(adHocPromptFile === undefined ? {} : { promptFile: adHocPromptFile }),
    ...(scopes === undefined ? {} : { scopes }),
    ...(adHocTarget === undefined ? {} : { target: adHocTarget }),
    ...(adHocTimeoutMs === undefined ? {} : { timeoutMs: adHocTimeoutMs }),
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
  if (adHocSubcommand === "worker") {
    if (adHocRunId === undefined) {
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
    adHocBackground,
    adHocClaudeSettingSources,
    adHocLines,
    adHocName,
    adHocPlugins,
    adHocPrompt,
    adHocPromptFile,
    adHocRunId,
    adHocSubcommand,
    adHocTarget,
    adHocTimeoutMs,
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
