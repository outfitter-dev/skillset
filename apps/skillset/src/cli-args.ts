import type { LookupSubject, LookupView } from "@skillset/core";
import type {
  BuildScope,
  CompileBuildMode,
  SkillsetOptions,
  TargetName,
} from "@skillset/core/internal/types";

import {
  parseBuildCommandRequest,
  parseDiffCommandRequest,
} from "./build-args";
import {
  isChangeSubcommand,
  parseChangeCommandRequest,
  readChangeBump,
  readChangeScopes,
  setChangeReason,
} from "./change-args";
import type { ChangeBump } from "./change-entries";
import type { ChangeReasonInput, ChangeSubcommand } from "./change-workflow";
import { parseCheckCommandRequest } from "./check-args";
import { assertBooleanOption, CliArgReader } from "./cli-arg-reader";
import {
  mergeBuildMode,
  readBuildScopes,
  readPositiveInteger,
  readTargetName,
  readTargetNames,
  resolveCliRoot,
  tokenizeCsv,
} from "./cli-arg-values";
import type { CliParseContext } from "./cli-arg-values";
import { isCliCommand, renderExpectedCliCommands } from "./cli-commands";
import type { CliCommand } from "./cli-commands";
import { CliOutputError, readCliCommand } from "./cli-output";
import type { CliRequest } from "./cli-request";
import { USAGE } from "./cli-usage";
import { parseDevCommandRequest } from "./dev-args";
import {
  parseDistributionCommandRequest,
  parseMarketplaceCommandRequest,
} from "./distribution-args";
import type { ImportKind, ImportProvider } from "./import";
import { parseInitCommandRequest } from "./init-args";
import {
  addLookupTarget,
  addLookupTargets,
  addLookupView,
  readLookupSubject,
  setLookupField,
} from "./lookup-cli";
import type { NewSourceKind, NewSourceScope } from "./new-source";
import type { ReconcileChoice } from "./reconcile";
import {
  parseReconcileCommandRequest,
  parseRestoreCommandRequest,
} from "./recovery-args";
import type { ReleaseSubcommand } from "./release";
import {
  isReleaseSubcommand,
  parseReleaseCommandRequest,
} from "./release-args";
import {
  readHookRuntimeContextField,
  readHookRuntimeContextFormat,
  readHookRunEvent,
} from "./runtime-hooks";
import type {
  HookRuntimeContextField,
  HookRuntimeContextFormat,
  HookRunEvent,
  HookRunner,
  HookSubcommand,
} from "./runtime-hooks";
import type { SetupInclude } from "./setup";
import {
  parseImportCommandRequest,
  parseNewCommandRequest,
} from "./source-args";
import { readClaudeSettingSources } from "./try";
import type { TryClaudeSettingSources, TrySubcommand } from "./try";
import { isTrySubcommand, validateTryFlags } from "./try-cli";
import { parseUpdateCommandRequest } from "./update-args";

type Command = CliCommand;
type DistributionSubcommand = "plan";
type MarketplaceSubcommand = "check" | "update";

interface ParsedArgs {
  readonly command: Command;
  readonly hookAgentRuntime: boolean;
  readonly hookContextEvent?: string;
  readonly hookContextFields?: readonly HookRuntimeContextField[];
  readonly hookContextFormat?: HookRuntimeContextFormat;
  readonly hookPreCommit: boolean;
  readonly hookPrePush: boolean;
  readonly hookRunner?: HookRunner;
  readonly hookRunEvent?: HookRunEvent;
  readonly hookSubcommand?: HookSubcommand;
  readonly hookTarget?: TargetName;
  readonly importPath?: string;
  readonly jsonOutput: boolean;
  readonly lookupAspects: readonly string[];
  readonly lookupField?: string;
  readonly lookupFeatures: boolean;
  readonly lookupSubject?: LookupSubject;
  readonly lookupTargets: readonly TargetName[];
  readonly lookupViews: readonly LookupView[];
  readonly options: SkillsetOptions;
  readonly tryBackground: boolean;
  readonly tryClaudeSettingSources?: TryClaudeSettingSources;
  readonly tryLines?: number;
  readonly tryName?: string;
  readonly tryPlugins: readonly string[];
  readonly tryPrompt?: string;
  readonly tryPromptFile?: string;
  readonly tryRunId?: string;
  readonly trySubcommand?: TrySubcommand;
  readonly tryTarget?: TargetName;
  readonly tryTimeoutMs?: number;
  readonly rootExplicit: boolean;
  readonly rootPath: string;
  readonly testName?: string;
  readonly yes: boolean;
}

function parseArgs(
  command: Command,
  args: readonly string[],
  context: CliParseContext
): ParsedArgs {
  let changeSubcommand: ChangeSubcommand | undefined;
  let distributionName: string | undefined;
  let distributionSubcommand: DistributionSubcommand | undefined;
  let releaseSubcommand: ReleaseSubcommand | undefined;
  let releaseReason: ChangeReasonInput | undefined;
  let releaseRef: string | undefined;
  let tryBackground = false;
  let tryClaudeSettingSources: TryClaudeSettingSources | undefined;
  let tryLines: number | undefined;
  let tryName: string | undefined;
  let tryPlugins: string[] = [];
  let tryPrompt: string | undefined;
  let tryPromptFile: string | undefined;
  let tryRunId: string | undefined;
  let trySubcommand: TrySubcommand | undefined;
  let tryTarget: TargetName | undefined;
  let tryTimeoutMs: number | undefined;
  let changeAppend = false;
  let changeBump: ChangeBump | undefined;
  let changeGroup: string | undefined;
  let changeReason: ChangeReasonInput | undefined;
  let changeRef: string | undefined;
  let changeSince: string | undefined;
  let changeStaged = false;
  let changeScopes: readonly string[] | undefined;
  let hookAgentRuntime = false;
  let hookContextEvent: string | undefined;
  let hookContextFields: readonly HookRuntimeContextField[] | undefined;
  let hookContextFormat: HookRuntimeContextFormat | undefined;
  let hookPreCommit = false;
  let hookPrePush = false;
  let hookRunner: HookRunner | undefined;
  let hookRunEvent: HookRunEvent | undefined;
  let hookSubcommand: HookSubcommand | undefined;
  let hookTarget: TargetName | undefined;
  let importKind: ImportKind | undefined;
  let importName: string | undefined;
  let importPath: string | undefined;
  let importProvider: ImportProvider | undefined;
  let initAdopt: readonly string[] | undefined;
  let initFrom: string | undefined;
  let jsonOutput = false;
  let lookupAspects: string[] = [];
  let lookupField: string | undefined;
  let lookupFeatures = false;
  let lookupSubject: LookupSubject | undefined;
  let lookupTargets: TargetName[] = [];
  let lookupViews: LookupView[] = [];
  let marketplaceName: string | undefined;
  let marketplaceSubcommand: MarketplaceSubcommand | undefined;
  let newContainer: string | undefined;
  let newId: string | undefined;
  let newKind: NewSourceKind | undefined;
  let newName: string | undefined;
  let newPresets: readonly string[] | undefined;
  let newScope: NewSourceScope | undefined;
  let rootPath: string | undefined;
  let rootExplicit = false;
  let sourceDir: string | undefined;
  let distDir: string | undefined;
  let buildMode: CompileBuildMode | undefined;
  let isolated = false;
  let scopes: readonly BuildScope[] | undefined;
  let setupIncludes: readonly SetupInclude[] | undefined;
  let setupTargets: readonly TargetName[] | undefined;
  let reconcileChoice: ReconcileChoice | undefined;
  let testName: string | undefined;
  let yes = false;
  let index = 1;

  if (command === "change") {
    const subcommand = args[index];
    if (!isChangeSubcommand(subcommand)) {
      throw new Error(
        "skillset: expected change subcommand add, amend, check, history, list, reason, show, or status"
      );
    }
    changeSubcommand = subcommand;
    index += 1;
    const rawRef = args[index];
    if (
      (subcommand === "amend" ||
        subcommand === "check" ||
        subcommand === "history" ||
        subcommand === "reason" ||
        subcommand === "show") &&
      rawRef !== undefined &&
      !rawRef.startsWith("--")
    ) {
      changeRef = rawRef;
      index += 1;
    }
  }

  if (command === "release") {
    const subcommand = args[index];
    if (!isReleaseSubcommand(subcommand)) {
      throw new Error(
        "skillset: expected release subcommand amend, apply, audit, or plan"
      );
    }
    releaseSubcommand = subcommand;
    index += 1;
    const rawRef = args[index];
    if (
      subcommand === "amend" &&
      rawRef !== undefined &&
      !rawRef.startsWith("--")
    ) {
      releaseRef = rawRef;
      index += 1;
    }
  }

  if (command === "distribute") {
    const subcommand = args[index];
    if (subcommand !== "plan") {
      throw new Error("skillset: expected distribute subcommand plan");
    }
    distributionSubcommand = subcommand;
    index += 1;
    const rawName = args[index];
    if (rawName !== undefined && !rawName.startsWith("--")) {
      distributionName = rawName;
      index += 1;
    }
  }

  if (command === "marketplace") {
    const subcommand = args[index];
    if (subcommand !== "check" && subcommand !== "update") {
      throw new Error(
        "skillset: expected marketplace subcommand check or update"
      );
    }
    marketplaceSubcommand = subcommand;
    index += 1;
    const rawName = args[index];
    if (rawName !== undefined && !rawName.startsWith("--")) {
      marketplaceName = rawName;
      index += 1;
    }
  }

  if (command === "hooks") {
    const subcommand = args[index];
    if (
      subcommand !== "context" &&
      subcommand !== "print" &&
      subcommand !== "run"
    ) {
      throw new Error(
        "skillset: expected hooks subcommand context, print, or run"
      );
    }
    hookSubcommand = subcommand;
    index += 1;
    if (subcommand === "run") {
      hookRunEvent = readHookRunEvent(args[index]);
      index += 1;
    }
  }

  if (command === "test") {
    const subcommand = args[index];
    if (isTrySubcommand(subcommand)) {
      trySubcommand = subcommand;
      index += 1;
    }
    const rawRunId = args[index];
    if (
      (trySubcommand === "status" ||
        trySubcommand === "tail" ||
        trySubcommand === "worker") &&
      rawRunId !== undefined &&
      !rawRunId.startsWith("--")
    ) {
      tryRunId = rawRunId;
      index += 1;
    }
  }

  if (command === "import") {
    const first = args[index];
    if (first !== undefined && !first.startsWith("--")) {
      if (isImportKind(first)) {
        throw new Error("skillset: import kind must be passed with --kind");
      } else if (isImportProvider(first)) {
        importProvider = first;
        const rawPath = args[index + 1];
        if (rawPath !== undefined && !rawPath.startsWith("--")) {
          importPath = rawPath;
          index += 2;
        } else {
          index += 1;
        }
      } else {
        importPath = first;
        index += 1;
      }
    }
  }

  if (command === "init") {
    const rawPath = args[index];
    if (rawPath !== undefined && !rawPath.startsWith("--")) {
      importPath = rawPath;
      index += 1;
    }
  }

  if (command === "explain" || command === "reconcile") {
    const rawPath = args[index];
    if (rawPath === undefined || rawPath.startsWith("--")) {
      throw new Error(`skillset: expected a path to ${command}`);
    }
    importPath = rawPath;
    index += 1;
  }

  if (command === "lookup") {
    const rawSubject = args[index];
    if (rawSubject === "features") {
      lookupFeatures = true;
      index += 1;
      const rawFeatureId = args[index];
      if (rawFeatureId !== undefined && !rawFeatureId.startsWith("--")) {
        importPath = rawFeatureId;
        index += 1;
      }
    } else if (rawSubject !== undefined && !rawSubject.startsWith("--")) {
      lookupSubject = readLookupSubject(rawSubject);
      index += 1;
      while (args[index] !== undefined && !args[index]?.startsWith("--")) {
        const aspect = args[index];
        if (aspect !== undefined) {
          lookupAspects = [...lookupAspects, aspect];
        }
        index += 1;
      }
    }
  }

  if (command === "restore") {
    const rawBackupId = args[index];
    if (rawBackupId === undefined || rawBackupId.startsWith("--")) {
      throw new Error("skillset: expected backup id to restore");
    }
    importPath = rawBackupId;
    index += 1;
  }

  if (command === "test" && trySubcommand === undefined) {
    const rawName = args[index];
    if (rawName !== undefined && !rawName.startsWith("--")) {
      testName = rawName;
      index += 1;
    }
  }

  if (command === "new") {
    const rawKind = args[index];
    if (!isNewSourceKind(rawKind)) {
      throw new Error("skillset: expected new kind skill, agent, or hook");
    }
    newKind = rawKind;
    index += 1;
    const rawName = args[index];
    if (rawName !== undefined && !rawName.startsWith("--")) {
      importPath = rawName;
      index += 1;
    }
  }

  const reader = new CliArgReader(args, index);
  while (!reader.done) {
    const option = reader.readOption();
    if (option === undefined) {
      break;
    }
    const { flag, raw: arg } = option;
    if (
      flag !== "--root" &&
      flag !== "--id" &&
      flag !== "--name" &&
      flag !== "--in" &&
      flag !== "--kind" &&
      flag !== "--from" &&
      flag !== "--adopt" &&
      flag !== "--preset" &&
      flag !== "--append" &&
      flag !== "--bump" &&
      flag !== "--group" &&
      flag !== "--reason" &&
      flag !== "--reason-file" &&
      flag !== "--ref" &&
      flag !== "--since" &&
      flag !== "--staged" &&
      flag !== "--yes" &&
      flag !== "--updated" &&
      flag !== "--all" &&
      flag !== "--isolated" &&
      flag !== "--scope" &&
      flag !== "--targets" &&
      flag !== "--include" &&
      flag !== "--fix" &&
      flag !== "--ci" &&
      flag !== "--only" &&
      flag !== "--use" &&
      flag !== "--report" &&
      flag !== "--json" &&
      flag !== "--jsonl" &&
      flag !== "--runner" &&
      flag !== "--target" &&
      flag !== "--agent-runtime" &&
      flag !== "--pre-commit" &&
      flag !== "--pre-push" &&
      flag !== "--write" &&
      flag !== "--frontmatter" &&
      flag !== "--fields" &&
      flag !== "--field" &&
      flag !== "--values" &&
      flag !== "--events" &&
      flag !== "--compat" &&
      flag !== "--examples" &&
      flag !== "--schema" &&
      flag !== "--prompt" &&
      flag !== "--prompt-file" &&
      flag !== "--plugin" &&
      flag !== "--claude-setting-sources" &&
      flag !== "--timeout-ms" &&
      flag !== "--lines" &&
      flag !== "--background" &&
      flag !== "--event" &&
      flag !== "--format" &&
      flag !== "--context-fields"
    ) {
      throw new Error(`skillset: unknown option ${arg}`);
    }

    if (flag === "--compat") {
      lookupViews = addLookupView(lookupViews, "compat");
      for (const value of reader.readOptionalOptionValues(option)) {
        lookupTargets = addLookupTargets(lookupTargets, value);
      }
      continue;
    }

    if (
      flag === "--yes" ||
      flag === "--updated" ||
      flag === "--all" ||
      flag === "--isolated" ||
      flag === "--append" ||
      flag === "--staged" ||
      flag === "--fix" ||
      flag === "--ci" ||
      flag === "--json" ||
      flag === "--jsonl" ||
      flag === "--agent-runtime" ||
      flag === "--pre-commit" ||
      flag === "--pre-push" ||
      flag === "--write" ||
      flag === "--frontmatter" ||
      flag === "--fields" ||
      flag === "--values" ||
      flag === "--events" ||
      flag === "--examples" ||
      flag === "--schema" ||
      flag === "--background"
    ) {
      assertBooleanOption(option);
      if (flag === "--yes") {
        yes = true;
      }
      if (flag === "--updated") {
        buildMode = mergeBuildMode(buildMode, "updated");
      }
      if (flag === "--all") {
        buildMode = mergeBuildMode(buildMode, "all");
      }
      if (flag === "--isolated") {
        isolated = true;
      }
      if (flag === "--append") {
        changeAppend = true;
      }
      if (flag === "--staged") {
        changeStaged = true;
      }
      if (flag === "--json") {
        jsonOutput = true;
      }
      if (flag === "--agent-runtime") {
        hookAgentRuntime = true;
      }
      if (flag === "--pre-commit") {
        hookPreCommit = true;
      }
      if (flag === "--pre-push") {
        hookPrePush = true;
      }
      if (flag === "--write") {
        if (command !== "check" && command !== "dev") {
          throw new Error(
            "skillset: --write is only supported with check or dev"
          );
        }
      }
      if (flag === "--frontmatter") {
        lookupViews = addLookupView(lookupViews, "frontmatter");
      }
      if (flag === "--fields") {
        lookupViews = addLookupView(lookupViews, "fields");
      }
      if (flag === "--values") {
        lookupViews = addLookupView(lookupViews, "values");
      }
      if (flag === "--events") {
        lookupViews = addLookupView(lookupViews, "events");
      }
      if (flag === "--examples") {
        lookupViews = addLookupView(lookupViews, "examples");
      }
      if (flag === "--schema") {
        lookupViews = addLookupView(lookupViews, "schema");
      }
      if (flag === "--background") {
        tryBackground = true;
      }
      continue;
    }

    const value = reader.readRequiredOptionValue(option);

    if (flag === "--root") {
      rootPath = value;
      rootExplicit = true;
    }
    if (flag === "--ref") {
      if (command === "release" && releaseSubcommand === "amend") {
        releaseRef = value;
      } else {
        changeRef = value;
      }
    }
    if (flag === "--since") {
      changeSince = value;
    }
    if (flag === "--scope") {
      if (command === "change" && changeSubcommand === "add") {
        changeScopes = [...(changeScopes ?? []), ...readChangeScopes(value)];
      } else if (
        command === "change" &&
        (changeSubcommand === "status" || changeSubcommand === "check")
      ) {
        throw new Error(
          `skillset: change ${changeSubcommand} is a whole-source command; --scope is not supported`
        );
      } else if (command === "change") {
        throw new Error(
          "skillset: --scope is only supported with change add source-unit entries"
        );
      } else if (command === "new") {
        newScope = readNewSourceScope(value);
      } else {
        scopes = readBuildScopes(value);
      }
    }
    if (flag === "--group") {
      changeGroup = value;
    }
    if (flag === "--reason") {
      const reason =
        value === "-"
          ? ({ kind: "stdin" } as const)
          : ({ kind: "inline", value } as const);
      if (command === "release" && releaseSubcommand === "amend") {
        releaseReason = setChangeReason(releaseReason, reason);
      } else {
        changeReason = setChangeReason(changeReason, reason);
      }
    }
    if (flag === "--reason-file") {
      const reason = { kind: "file", path: value } as const;
      if (command === "release" && releaseSubcommand === "amend") {
        releaseReason = setChangeReason(releaseReason, reason);
      } else {
        changeReason = setChangeReason(changeReason, reason);
      }
    }
    if (flag === "--bump") {
      changeBump = readChangeBump(value);
    }
    if (flag === "--only") {
      if (value !== "outputs") {
        throw new Error("skillset: expected --only outputs");
      }
    }
    if (flag === "--use") {
      if (value !== "source" && value !== "output") {
        throw new Error("skillset: --use expects source or output");
      }
      reconcileChoice = value;
    }
    if (flag === "--field") {
      lookupField = setLookupField(lookupField, value);
    }
    if (flag === "--runner") {
      hookRunner = readHookRunner(value);
    }
    if (flag === "--event") {
      hookContextEvent = value;
    }
    if (flag === "--format") {
      hookContextFormat = readHookRuntimeContextFormat(value);
    }
    if (flag === "--context-fields") {
      hookContextFields = readHookRuntimeContextFields(value);
    }
    if (flag === "--target") {
      if (command === "test") {
        tryTarget = readTargetName(value);
      } else {
        hookTarget = readHookTarget(value);
      }
    }
    if (flag === "--prompt") {
      tryPrompt = value;
    }
    if (flag === "--prompt-file") {
      tryPromptFile = value;
    }
    if (flag === "--plugin") {
      tryPlugins = [...tryPlugins, value];
    }
    if (flag === "--claude-setting-sources") {
      tryClaudeSettingSources = readClaudeSettingSources(
        value,
        "--claude-setting-sources"
      );
    }
    if (flag === "--timeout-ms") {
      tryTimeoutMs = readPositiveInteger(value, "--timeout-ms");
    }
    if (flag === "--lines") {
      tryLines = readPositiveInteger(value, "--lines");
    }
    if (flag === "--targets") {
      setupTargets = readTargetNames(value);
    }
    if (flag === "--include") {
      setupIncludes = mergeSetupIncludes(setupIncludes, value);
    }
    if (flag === "--id") {
      newId = value;
    }
    if (flag === "--in") {
      newContainer = value;
    }
    if (flag === "--name") {
      if (command === "new") {
        newName = value;
      } else if (command === "test") {
        tryName = value;
      } else {
        importName = value;
      }
    }
    if (flag === "--preset") {
      newPresets = [...(newPresets ?? []), value];
    }
    if (flag === "--kind") {
      if (!isImportKind(value)) {
        throw new Error(
          "skillset: expected --kind skill, skills, plugin, or plugins"
        );
      }
      if (importKind !== undefined && importKind !== value) {
        throw new Error(
          `skillset: conflicting import kinds ${importKind} and ${value}`
        );
      }
      importKind = value;
    }
    if (flag === "--from") {
      if (command === "init") {
        initFrom = value;
      } else if (!isImportProvider(value)) {
        throw new Error(
          "skillset: expected --from claude, codex, cursor, agents, or skillset"
        );
      } else {
        importProvider = value;
      }
    }
    if (flag === "--adopt") {
      initAdopt = [...(initAdopt ?? []), value];
    }
  }

  validateLegacyChangeFlags(command, {
    append: changeAppend,
    ...(changeBump === undefined ? {} : { bump: changeBump }),
    ...(changeGroup === undefined ? {} : { group: changeGroup }),
    ...(changeReason === undefined ? {} : { reason: changeReason }),
    ...(changeRef === undefined ? {} : { ref: changeRef }),
    staged: changeStaged,
    ...(changeScopes === undefined ? {} : { scopes: changeScopes }),
  });

  validateHookFlags(command, {
    agentRuntime: hookAgentRuntime,
    ...(buildMode === undefined ? {} : { buildMode }),
    ...(changeSince === undefined ? {} : { changeSince }),
    ...(distDir === undefined ? {} : { distDir }),
    ...(hookContextEvent === undefined
      ? {}
      : { contextEvent: hookContextEvent }),
    ...(hookContextFields === undefined
      ? {}
      : { contextFields: hookContextFields }),
    ...(hookContextFormat === undefined
      ? {}
      : { contextFormat: hookContextFormat }),
    ...(importKind === undefined ? {} : { importKind }),
    ...(importName === undefined ? {} : { importName }),
    ...(importProvider === undefined ? {} : { importProvider }),
    preCommit: hookPreCommit,
    prePush: hookPrePush,
    ...(hookRunner === undefined ? {} : { runner: hookRunner }),
    rootExplicit,
    ...(scopes === undefined ? {} : { scopes }),
    ...(sourceDir === undefined ? {} : { sourceDir }),
    ...(hookSubcommand === undefined ? {} : { subcommand: hookSubcommand }),
    ...(hookTarget === undefined ? {} : { target: hookTarget }),
    yes,
  });

  validateSetupFlags(command, {
    ...(setupIncludes === undefined ? {} : { includes: setupIncludes }),
    ...(setupTargets === undefined ? {} : { targets: setupTargets }),
  });
  if (
    command !== "init" &&
    (initAdopt !== undefined || initFrom !== undefined)
  ) {
    throw new Error(
      "skillset: --adopt and init acquisition --from are only supported with init"
    );
  }

  validateLegacyReadinessFlags(command, args);

  const hasAdHocTestFlags =
    trySubcommand !== undefined ||
    tryTarget !== undefined ||
    tryPrompt !== undefined ||
    tryPromptFile !== undefined ||
    tryPlugins.length > 0 ||
    tryName !== undefined ||
    tryTimeoutMs !== undefined ||
    tryClaudeSettingSources !== undefined ||
    tryBackground;
  if (command === "test" && testName !== undefined && hasAdHocTestFlags) {
    throw new Error(
      `skillset: declared test ${testName} cannot be combined with ad hoc test flags`
    );
  }
  validateTryFlags(command, trySubcommand, {
    background: tryBackground,
    ...(buildMode === undefined ? {} : { buildMode }),
    ...(tryClaudeSettingSources === undefined
      ? {}
      : { claudeSettingSources: tryClaudeSettingSources }),
    ...(distDir === undefined ? {} : { distDir }),
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
  validateJsonFlags(command, jsonOutput, {
    ...(changeSubcommand === undefined ? {} : { changeSubcommand }),
    ...(distributionSubcommand === undefined ? {} : { distributionSubcommand }),
    ...(releaseSubcommand === undefined ? {} : { releaseSubcommand }),
  });
  if (
    hasCliFlag(args, "--jsonl") &&
    command !== "build" &&
    command !== "check" &&
    command !== "dev" &&
    command !== "diff" &&
    command !== "update"
  ) {
    throw new Error("skillset: unknown option --jsonl");
  }
  validateLookupFlags(
    command,
    args,
    {
      features: lookupFeatures,
      ...(lookupField === undefined ? {} : { field: lookupField }),
      targets: lookupTargets,
      views: lookupViews,
    },
    rootExplicit
  );
  validateListFlags(command, buildMode);

  validateLegacyIsolatedFlag(command, isolated);

  validateLegacyReleaseFlags(command, {
    ...(releaseReason === undefined ? {} : { reason: releaseReason }),
    ...(releaseRef === undefined ? {} : { ref: releaseRef }),
  });
  validateTestFlags(command, args, {
    adHoc: hasAdHocTestFlags,
    ...(buildMode === undefined ? {} : { buildMode }),
    ...(testName === undefined ? {} : { declaredName: testName }),
    ...(distDir === undefined ? {} : { distDir }),
    ...(scopes === undefined ? {} : { scopes }),
    ...(tryRunId === undefined ? {} : { runId: tryRunId }),
    ...(trySubcommand === undefined ? {} : { subcommand: trySubcommand }),
    yes,
  });
  validateStatusFlags(command, args);
  validateLegacyReconcileFlags(command, {
    ...(reconcileChoice === undefined ? {} : { choice: reconcileChoice }),
  });
  validateLegacyNewSourceFlags(command, {
    ...(newContainer === undefined ? {} : { container: newContainer }),
    ...(newId === undefined ? {} : { id: newId }),
    ...(newKind === undefined ? {} : { kind: newKind }),
    ...(newName === undefined ? {} : { name: newName }),
    ...(newPresets === undefined ? {} : { presets: newPresets }),
    ...(newScope === undefined ? {} : { scope: newScope }),
  });
  if (command === "change" && changeSubcommand === "add") {
    if (changeScopes === undefined || changeScopes.length === 0) {
      throw new Error("skillset: change add requires at least one --scope");
    }
    if (changeBump === undefined) {
      throw new Error(
        "skillset: change add requires --bump major, minor, patch, or none"
      );
    }
  }
  if (
    command === "change" &&
    (changeSubcommand === "amend" ||
      changeSubcommand === "reason" ||
      changeSubcommand === "show") &&
    changeRef === undefined
  ) {
    throw new Error(`skillset: change ${changeSubcommand} requires @ref`);
  }
  if (
    command === "release" &&
    releaseSubcommand === "amend" &&
    releaseRef === undefined
  ) {
    throw new Error("skillset: release amend requires @ref");
  }
  const options: SkillsetOptions = {
    ...(buildMode === undefined ? {} : { buildMode }),
    ...(scopes === undefined ? {} : { scopes }),
    ...(sourceDir === undefined ? {} : { sourceDir }),
    ...(distDir === undefined ? {} : { distDir }),
    ...(isolated ? { isolated: true } : {}),
  };

  return {
    command,
    hookAgentRuntime,
    ...(hookContextEvent === undefined ? {} : { hookContextEvent }),
    ...(hookContextFields === undefined ? {} : { hookContextFields }),
    ...(hookContextFormat === undefined ? {} : { hookContextFormat }),
    hookPreCommit,
    hookPrePush,
    ...(hookRunner === undefined ? {} : { hookRunner }),
    ...(hookRunEvent === undefined ? {} : { hookRunEvent }),
    ...(hookSubcommand === undefined ? {} : { hookSubcommand }),
    ...(hookTarget === undefined ? {} : { hookTarget }),
    ...(importPath === undefined ? {} : { importPath }),
    jsonOutput,
    lookupAspects,
    ...(lookupField === undefined ? {} : { lookupField }),
    lookupFeatures,
    ...(lookupSubject === undefined ? {} : { lookupSubject }),
    lookupTargets,
    lookupViews,
    options,
    tryBackground,
    ...(tryClaudeSettingSources === undefined
      ? {}
      : { tryClaudeSettingSources }),
    ...(tryLines === undefined ? {} : { tryLines }),
    ...(tryName === undefined ? {} : { tryName }),
    tryPlugins,
    ...(tryPrompt === undefined ? {} : { tryPrompt }),
    ...(tryPromptFile === undefined ? {} : { tryPromptFile }),
    ...(tryRunId === undefined ? {} : { tryRunId }),
    ...(trySubcommand === undefined ? {} : { trySubcommand }),
    ...(tryTarget === undefined ? {} : { tryTarget }),
    ...(tryTimeoutMs === undefined ? {} : { tryTimeoutMs }),
    rootExplicit,
    rootPath: resolveCliRoot(context, rootPath),
    ...(testName === undefined ? {} : { testName }),
    yes,
  };
}

function createCliRequest(parsed: ParsedArgs): CliRequest {
  const { command, jsonOutput, options, rootPath, yes } = parsed;
  if (command === "hooks")
    return {
      command,
      request: {
        hookAgentRuntime: parsed.hookAgentRuntime,
        hookContextEvent: parsed.hookContextEvent,
        hookContextFields: parsed.hookContextFields,
        hookContextFormat: parsed.hookContextFormat,
        hookPreCommit: parsed.hookPreCommit,
        hookPrePush: parsed.hookPrePush,
        hookRunEvent: parsed.hookRunEvent,
        hookRunner: parsed.hookRunner,
        hookSubcommand: parsed.hookSubcommand,
        hookTarget: parsed.hookTarget,
        rootPath,
      },
    };
  if (command === "test")
    return {
      command,
      request: {
        jsonOutput,
        options,
        rootPath,
        testName: parsed.testName,
        tryBackground: parsed.tryBackground,
        tryClaudeSettingSources: parsed.tryClaudeSettingSources,
        tryLines: parsed.tryLines,
        tryName: parsed.tryName,
        tryPlugins: parsed.tryPlugins,
        tryPrompt: parsed.tryPrompt,
        tryPromptFile: parsed.tryPromptFile,
        tryRunId: parsed.tryRunId,
        trySubcommand: parsed.trySubcommand,
        tryTarget: parsed.tryTarget,
        tryTimeoutMs: parsed.tryTimeoutMs,
      },
    };
  if (command === "list")
    return { command, request: { jsonOutput, options, rootPath } };
  if (command === "lookup")
    return {
      command,
      request: parsed.lookupFeatures
        ? {
            kind: "features",
            value: { featureId: parsed.importPath, jsonOutput },
          }
        : {
            kind: "query",
            value: {
              jsonOutput,
              lookupAspects: parsed.lookupAspects,
              lookupField: parsed.lookupField,
              lookupSubject: parsed.lookupSubject,
              lookupTargets: parsed.lookupTargets,
              lookupViews: parsed.lookupViews,
            },
          },
    };
  if (command === "explain")
    return {
      command,
      request: { jsonOutput, options, path: parsed.importPath, rootPath },
    };
  if (command === "status")
    return { command, request: { jsonOutput, options, rootPath } };
  throw new Error(`skillset: unhandled command ${command}`);
}

export function parseCliRequest(
  args: readonly string[],
  context: CliParseContext = { cwd: process.cwd() }
): CliRequest {
  try {
    const command = args[0];
    if (!isCliCommand(command)) {
      throw new Error(
        `skillset: expected command ${renderExpectedCliCommands()}\n${USAGE}`
      );
    }
    const parsed = parseArgs(command, args, context);
    if (command === "change") {
      return { command, request: parseChangeCommandRequest(args, context) };
    }
    if (command === "build") {
      return { command, request: parseBuildCommandRequest(args, context) };
    }
    if (command === "check") {
      return { command, request: parseCheckCommandRequest(args, context) };
    }
    if (command === "dev") {
      return { command, request: parseDevCommandRequest(args, context) };
    }
    if (command === "diff") {
      return { command, request: parseDiffCommandRequest(args, context) };
    }
    if (command === "distribute") {
      return {
        command,
        request: parseDistributionCommandRequest(args, context),
      };
    }
    if (command === "import") {
      return { command, request: parseImportCommandRequest(args, context) };
    }
    if (command === "init") {
      return { command, request: parseInitCommandRequest(args, context) };
    }
    if (command === "marketplace") {
      return {
        command,
        request: parseMarketplaceCommandRequest(args, context),
      };
    }
    if (command === "new") {
      return { command, request: parseNewCommandRequest(args, context) };
    }
    if (command === "reconcile") {
      return {
        command,
        request: parseReconcileCommandRequest(args, context),
      };
    }
    if (command === "release") {
      return { command, request: parseReleaseCommandRequest(args, context) };
    }
    if (command === "restore") {
      return { command, request: parseRestoreCommandRequest(args, context) };
    }
    if (command === "update") {
      return { command, request: parseUpdateCommandRequest(args, context) };
    }
    return createCliRequest(parsed);
  } catch (error) {
    if (error instanceof CliOutputError) {
      throw error;
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new CliOutputError(message, 2, readCliCommand(args));
  }
}

function isNewSourceKind(value: string | undefined): value is NewSourceKind {
  return value === "agent" || value === "hook" || value === "skill";
}

function readNewSourceScope(value: string): NewSourceScope {
  if (value === "repo") {
    return value;
  }
  throw new Error("skillset: new currently supports only --scope repo");
}

function readHookRuntimeContextFields(
  value: string
): readonly HookRuntimeContextField[] {
  const fields = tokenizeCsv(value);
  if (fields.length === 0) {
    throw new Error("skillset: --context-fields requires at least one field");
  }
  return fields.map(readHookRuntimeContextField);
}

function validateLegacyChangeFlags(
  command: Command,
  change: {
    readonly append: boolean;
    readonly bump?: ChangeBump;
    readonly group?: string;
    readonly reason?: ChangeReasonInput;
    readonly ref?: string;
    readonly scopes?: readonly string[];
    readonly staged: boolean;
  }
): void {
  const hasChangeFlag =
    change.append ||
    change.bump !== undefined ||
    change.group !== undefined ||
    change.reason !== undefined ||
    change.ref !== undefined ||
    change.scopes !== undefined ||
    change.staged;
  if (hasChangeFlag && command !== "change") {
    throw new Error(
      "skillset: change options are only supported with change commands"
    );
  }
}

function validateLegacyReleaseFlags(
  command: Command,
  release: {
    readonly reason?: ChangeReasonInput;
    readonly ref?: string;
  }
): void {
  const hasReleaseFlag =
    release.reason !== undefined || release.ref !== undefined;
  if (hasReleaseFlag && command !== "release") {
    throw new Error(
      "skillset: release options are only supported with release commands"
    );
  }
}

function validateHookFlags(
  command: Command,
  hooks: {
    readonly agentRuntime: boolean;
    readonly buildMode?: CompileBuildMode;
    readonly changeSince?: string;
    readonly contextEvent?: string;
    readonly contextFields?: readonly HookRuntimeContextField[];
    readonly contextFormat?: HookRuntimeContextFormat;
    readonly distDir?: string;
    readonly importKind?: ImportKind;
    readonly importName?: string;
    readonly importProvider?: ImportProvider;
    readonly preCommit: boolean;
    readonly prePush: boolean;
    readonly runner?: HookRunner;
    readonly rootExplicit: boolean;
    readonly scopes?: readonly BuildScope[];
    readonly sourceDir?: string;
    readonly subcommand?: HookSubcommand;
    readonly target?: TargetName;
    readonly yes: boolean;
  }
): void {
  const hasHookPrintFlag =
    hooks.agentRuntime ||
    hooks.preCommit ||
    hooks.prePush ||
    hooks.runner !== undefined ||
    hooks.target !== undefined;
  const hasHookContextFlag =
    hooks.contextEvent !== undefined ||
    hooks.contextFields !== undefined ||
    hooks.contextFormat !== undefined;
  if (
    hasHookPrintFlag &&
    (command !== "hooks" || hooks.subcommand !== "print")
  ) {
    throw new Error(
      "skillset: hook options are only supported with hooks print"
    );
  }
  if (
    hasHookContextFlag &&
    (command !== "hooks" || hooks.subcommand !== "context")
  ) {
    throw new Error(
      "skillset: hook context options are only supported with hooks context"
    );
  }
  if (command !== "hooks") {
    return;
  }
  if (
    hooks.subcommand !== "context" &&
    hooks.subcommand !== "print" &&
    hooks.subcommand !== "run"
  ) {
    throw new Error(
      "skillset: expected hooks subcommand context, print, or run"
    );
  }
  if (hooks.subcommand === "context" && hooks.contextEvent === undefined) {
    throw new Error("skillset: hooks context requires --event");
  }
  if (hooks.subcommand === "print" && hooks.rootExplicit) {
    throw new Error("skillset: --root is not supported with hooks print");
  }
  if (
    hooks.buildMode !== undefined ||
    hooks.scopes !== undefined ||
    hooks.sourceDir !== undefined ||
    hooks.distDir !== undefined ||
    hooks.changeSince !== undefined ||
    hooks.importKind !== undefined ||
    hooks.importName !== undefined ||
    hooks.importProvider !== undefined ||
    hooks.yes
  ) {
    throw new Error(
      `skillset: non-hook options are not supported with hooks ${hooks.subcommand}`
    );
  }
}

function validateTestFlags(
  command: Command,
  args: readonly string[],
  test: {
    readonly adHoc: boolean;
    readonly buildMode?: CompileBuildMode;
    readonly declaredName?: string;
    readonly distDir?: string;
    readonly runId?: string;
    readonly scopes?: readonly BuildScope[];
    readonly subcommand?: TrySubcommand;
    readonly yes: boolean;
  }
): void {
  if (command !== "test") {
    return;
  }
  if (test.subcommand === "worker") {
    if (test.runId === undefined) {
      throw new Error("skillset: test worker requires run id");
    }
    const unsupportedFlag = args.slice(3).find((argument) => {
      if (!argument.startsWith("--")) {
        return false;
      }
      return argument.split("=", 1)[0] !== "--root";
    });
    if (unsupportedFlag !== undefined) {
      throw new Error(
        "skillset: test worker only supports <run-id> and --root <path>"
      );
    }
  }
  if (test.declaredName !== undefined && test.adHoc) {
    throw new Error(
      `skillset: declared test ${test.declaredName} cannot be combined with ad hoc test flags`
    );
  }
  if (
    test.buildMode !== undefined ||
    test.distDir !== undefined ||
    test.scopes !== undefined ||
    test.yes
  ) {
    throw new Error(
      "skillset: build/write options are not supported with test; test output always writes under logical .skillset/cache/tests"
    );
  }
}

function validateListFlags(
  command: Command,
  buildMode: CompileBuildMode | undefined
): void {
  if (command === "list" && buildMode !== undefined) {
    throw new Error(
      "skillset: --updated and --all are not supported with list"
    );
  }
}

function validateStatusFlags(command: Command, args: readonly string[]): void {
  if (command !== "status") {
    return;
  }
  for (let index = 1; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === undefined) {
      break;
    }
    const equalsIndex = argument.indexOf("=");
    const flag = equalsIndex === -1 ? argument : argument.slice(0, equalsIndex);
    if (flag === "--json") {
      continue;
    }
    if (flag === "--root") {
      if (equalsIndex === -1) {
        index += 1;
      }
      continue;
    }
    throw new Error("skillset: status only supports --root and --json");
  }
}

function validateLegacyReconcileFlags(
  command: Command,
  reconcile: {
    readonly choice?: ReconcileChoice;
  }
): void {
  if (reconcile.choice !== undefined && command !== "reconcile") {
    throw new Error("skillset: --use is only supported with reconcile");
  }
}

function validateLegacyNewSourceFlags(
  command: Command,
  source: {
    readonly container?: string;
    readonly id?: string;
    readonly kind?: NewSourceKind;
    readonly name?: string;
    readonly presets?: readonly string[];
    readonly scope?: NewSourceScope;
  }
): void {
  const hasNewFlag =
    source.container !== undefined ||
    source.id !== undefined ||
    source.kind !== undefined ||
    source.name !== undefined ||
    source.presets !== undefined ||
    source.scope !== undefined;
  if (hasNewFlag && command !== "new") {
    throw new Error("skillset: new options are only supported with new");
  }
}

function readHookRunner(value: string): HookRunner {
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
}

function readHookTarget(value: string): TargetName {
  if (value === "claude" || value === "codex") {
    return value;
  }
  throw new Error("skillset: expected --target claude or codex");
}

function mergeSetupIncludes(
  current: readonly SetupInclude[] | undefined,
  value: string
): readonly SetupInclude[] {
  const includes = tokenizeCsv(value);
  if (includes.length === 0) {
    throw new Error("skillset: --include requires at least one value");
  }
  const seen = new Set<SetupInclude>(current ?? []);
  for (const include of includes) {
    if (include !== "ci") {
      throw new Error("skillset: expected --include ci");
    }
    seen.add(include);
  }
  return [...seen];
}

function validateLegacyIsolatedFlag(command: Command, isolated: boolean): void {
  if (!isolated) {
    return;
  }
  if (
    command === "build" ||
    command === "check" ||
    command === "dev" ||
    command === "diff" ||
    command === "update"
  ) {
    return;
  }
  throw new Error(
    "skillset: --isolated is only supported with build, check --only outputs, or diff"
  );
}

function validateLegacyReadinessFlags(
  command: Command,
  args: readonly string[]
): void {
  if (command === "check") {
    return;
  }
  if (
    hasCliFlag(args, "--ci") ||
    hasCliFlag(args, "--fix") ||
    hasCliFlag(args, "--only") ||
    hasCliFlag(args, "--report")
  ) {
    throw new Error("skillset: readiness flags are only supported with check");
  }
  if (
    hasCliFlag(args, "--since") &&
    command !== "change" &&
    command !== "hooks"
  ) {
    throw new Error(
      "skillset: --since is only supported with check --ci or change commands"
    );
  }
}

function hasCliFlag(args: readonly string[], expected: string): boolean {
  return args.some((argument) => argument.split("=", 1)[0] === expected);
}

function validateSetupFlags(
  command: Command,
  setup: {
    readonly includes?: readonly SetupInclude[];
    readonly targets?: readonly TargetName[];
  }
): void {
  const hasSetupFlag =
    setup.includes !== undefined || setup.targets !== undefined;
  if (hasSetupFlag && command !== "init") {
    throw new Error("skillset: setup options are only supported with init");
  }
}

function validateJsonFlags(
  command: Command,
  jsonOutput: boolean,
  route: {
    readonly changeSubcommand?: ChangeSubcommand;
    readonly distributionSubcommand?: DistributionSubcommand;
    readonly releaseSubcommand?: ReleaseSubcommand;
  }
): void {
  if (!jsonOutput) {
    return;
  }
  if (command === "dev") {
    return;
  }
  if (
    command === "build" ||
    command === "check" ||
    command === "import" ||
    command === "init" ||
    command === "new" ||
    command === "reconcile" ||
    command === "restore" ||
    command === "update"
  ) {
    return;
  }
  if (
    command === "change" &&
    (route.changeSubcommand === "check" ||
      route.changeSubcommand === "history" ||
      route.changeSubcommand === "list" ||
      route.changeSubcommand === "show" ||
      route.changeSubcommand === "status")
  ) {
    return;
  }
  if (
    command === "change" &&
    (route.changeSubcommand === "add" ||
      route.changeSubcommand === "amend" ||
      route.changeSubcommand === "migrate" ||
      route.changeSubcommand === "reason")
  ) {
    return;
  }
  if (command === "release" && route.releaseSubcommand !== undefined) {
    return;
  }
  if (
    command === "diff" ||
    command === "status" ||
    command === "explain" ||
    command === "list" ||
    command === "lookup" ||
    command === "marketplace" ||
    command === "test"
  ) {
    return;
  }
  if (command === "distribute" && route.distributionSubcommand === "plan") {
    return;
  }
  throw new Error("skillset: --json is not supported for this command route");
}

function validateLookupFlags(
  command: Command,
  args: readonly string[],
  lookup: {
    readonly features: boolean;
    readonly field?: string;
    readonly targets: readonly TargetName[];
    readonly views: readonly LookupView[];
  },
  rootExplicit: boolean
): void {
  if (command === "lookup") {
    if (lookup.features) {
      const unsupportedFlag = args.slice(2).find((argument) => {
        if (!argument.startsWith("--")) {
          return false;
        }
        const flag = argument.split("=", 1)[0];
        return flag !== "--json";
      });
      if (
        unsupportedFlag !== undefined ||
        lookup.field !== undefined ||
        lookup.targets.length > 0 ||
        lookup.views.length > 0
      ) {
        throw new Error(
          "skillset: expected lookup features to use only an optional feature id and --json"
        );
      }
    }
    if (rootExplicit) {
      throw new Error("skillset: --root is not supported with lookup");
    }
    return;
  }
  if (
    lookup.field !== undefined ||
    lookup.targets.length > 0 ||
    lookup.views.length > 0
  ) {
    throw new Error("skillset: lookup flags are only supported with lookup");
  }
}

function isImportKind(value: string): value is ImportKind {
  return (
    value === "skill" ||
    value === "skills" ||
    value === "plugin" ||
    value === "plugins"
  );
}

function isImportProvider(value: string): value is ImportProvider {
  return (
    value === "agents" ||
    value === "claude" ||
    value === "codex" ||
    value === "cursor" ||
    value === "skillset"
  );
}
