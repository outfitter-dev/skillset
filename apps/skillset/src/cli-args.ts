import { resolve } from "node:path";

import { isTargetName, targetNames } from "@skillset/core";
import type { LookupSubject, LookupView } from "@skillset/core";
import { sourceUnitSelector } from "@skillset/core/internal/source-unit-selector";
import type {
  BuildScope,
  CompileBuildMode,
  SkillsetOptions,
  TargetName,
} from "@skillset/core/internal/types";

import type { ChangeBump } from "./change-entries";
import type { ChangeReasonInput, ChangeSubcommand } from "./change-workflow";
import { isCliCommand, renderExpectedCliCommands } from "./cli-commands";
import type { CliCommand } from "./cli-commands";
import { CliOutputError, readCliCommand } from "./cli-output";
import type { CliRequest } from "./cli-request";
import { USAGE } from "./cli-usage";
import type { ImportKind, ImportProvider } from "./import";
import {
  addLookupTarget,
  addLookupTargets,
  addLookupView,
  readLookupSubject,
  setLookupField,
} from "./lookup-cli";
import type { NewSourceKind, NewSourceScope } from "./new-source";
import type { ReconcileChoice } from "./reconcile";
import type { ReleaseSubcommand } from "./release";
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
import { readClaudeSettingSources } from "./try";
import type { TryClaudeSettingSources, TrySubcommand } from "./try";
import { isTrySubcommand, validateTryFlags } from "./try-cli";

type Command = CliCommand;
type DistributionSubcommand = "plan";
type MarketplaceSubcommand = "check" | "update";

interface ParsedArgs {
  readonly command: Command;
  readonly changeAppend: boolean;
  readonly changeBump?: ChangeBump;
  readonly changeGroup?: string;
  readonly changeReason?: ChangeReasonInput;
  readonly changeRef?: string;
  readonly changeSince?: string;
  readonly changeStaged: boolean;
  readonly changeScopes?: readonly string[];
  readonly changeSubcommand?: ChangeSubcommand;
  readonly ciFix: boolean;
  readonly ciMode: boolean;
  readonly ciReportPath?: string;
  readonly checkOnly?: "outputs";
  readonly checkWrite: boolean;
  readonly devWrite: boolean;
  readonly distributionName?: string;
  readonly distributionSubcommand?: DistributionSubcommand;
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
  readonly importKind?: ImportKind;
  readonly importName?: string;
  readonly importPath?: string;
  readonly importProvider?: ImportProvider;
  readonly initAdopt?: readonly string[];
  readonly initFrom?: string;
  readonly jsonOutput: boolean;
  readonly jsonlOutput: boolean;
  readonly lookupAspects: readonly string[];
  readonly lookupField?: string;
  readonly lookupFeatures: boolean;
  readonly lookupSubject?: LookupSubject;
  readonly lookupTargets: readonly TargetName[];
  readonly lookupViews: readonly LookupView[];
  readonly marketplaceName?: string;
  readonly marketplaceSubcommand?: MarketplaceSubcommand;
  readonly newContainer?: string;
  readonly newId?: string;
  readonly newKind?: NewSourceKind;
  readonly newName?: string;
  readonly newPresets?: readonly string[];
  readonly newScope?: NewSourceScope;
  readonly options: SkillsetOptions;
  readonly releaseSubcommand?: ReleaseSubcommand;
  readonly releaseReason?: ChangeReasonInput;
  readonly releaseRef?: string;
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
  readonly setupIncludes?: readonly SetupInclude[];
  readonly setupTargets?: readonly TargetName[];
  readonly reconcileChoice?: ReconcileChoice;
  readonly testName?: string;
  readonly yes: boolean;
}

function parseArgs(args: readonly string[]): ParsedArgs {
  const command = args[0];
  if (!isCliCommand(command)) {
    throw new Error(
      `skillset: expected command ${renderExpectedCliCommands()}\n${USAGE}`
    );
  }

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
  let ciFix = false;
  let ciMode = false;
  let ciReportPath: string | undefined;
  let checkOnly: "outputs" | undefined;
  let checkWrite = false;
  let devWrite = false;
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
  let jsonlOutput = false;
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
  let rootPath = process.cwd();
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

  for (; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === undefined) {
      break;
    }
    const equalsIndex = arg.indexOf("=");
    const flag = equalsIndex === -1 ? arg : arg.slice(0, equalsIndex);
    const inlineValue =
      equalsIndex === -1 ? undefined : arg.slice(equalsIndex + 1);
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
      if (inlineValue !== undefined) {
        lookupTargets = addLookupTargets(lookupTargets, inlineValue);
        continue;
      }
      while (
        args[index + 1] !== undefined &&
        !args[index + 1]?.startsWith("--")
      ) {
        const value = args[index + 1];
        if (value === undefined) {
          break;
        }
        lookupTargets = addLookupTargets(lookupTargets, value);
        index += 1;
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
      if (inlineValue !== undefined) {
        throw new Error(`skillset: ${flag} does not take a value`);
      }
      if (flag === "--yes") {
        yes = true;
      }
      if (flag === "--updated") {
        buildMode = setBuildMode(buildMode, "updated");
      }
      if (flag === "--all") {
        buildMode = setBuildMode(buildMode, "all");
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
      if (flag === "--fix") {
        ciFix = true;
      }
      if (flag === "--ci") {
        ciMode = true;
      }
      if (flag === "--json") {
        jsonOutput = true;
      }
      if (flag === "--jsonl") {
        jsonlOutput = true;
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
        if (command === "check") {
          checkWrite = true;
        } else if (command === "dev") {
          devWrite = true;
        } else {
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

    const value = inlineValue ?? args[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`skillset: expected value after ${flag}`);
    }
    if (inlineValue === undefined) {
      index += 1;
    }

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
    if (flag === "--report") {
      ciReportPath = value;
    }
    if (flag === "--only") {
      if (value !== "outputs") {
        throw new Error("skillset: expected --only outputs");
      }
      checkOnly = value;
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
      setupTargets = readSetupTargets(value);
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

  validateChangeFlags(command, changeSubcommand, {
    append: changeAppend,
    ...(changeBump === undefined ? {} : { bump: changeBump }),
    ...(changeGroup === undefined ? {} : { group: changeGroup }),
    ...(changeReason === undefined ? {} : { reason: changeReason }),
    ...(changeRef === undefined ? {} : { ref: changeRef }),
    staged: changeStaged,
    ...(changeScopes === undefined ? {} : { scopes: changeScopes }),
    yes,
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

  validateCiFlags(command, {
    ci: ciMode,
    fix: ciFix,
    ...(checkOnly === undefined ? {} : { only: checkOnly }),
    ...(ciReportPath === undefined ? {} : { reportPath: ciReportPath }),
    ...(changeSince === undefined ? {} : { since: changeSince }),
    write: checkWrite,
    yes,
  });
  validateDevFlags(command, {
    write: devWrite,
    ...(buildMode === undefined ? {} : { buildMode }),
    ...(scopes === undefined ? {} : { scopes }),
    yes,
  });
  validateUpdateFlags(command, {
    ...(buildMode === undefined ? {} : { buildMode }),
    ...(scopes === undefined ? {} : { scopes }),
    yes,
  });

  validateAdoptFlags(command, {
    ...(buildMode === undefined ? {} : { buildMode }),
    ...(scopes === undefined ? {} : { scopes }),
  });
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
  if (jsonlOutput && command !== "dev") {
    throw new Error("skillset: --jsonl is only supported with dev");
  }
  validateLookupFlags(command, args, {
    features: lookupFeatures,
    ...(lookupField === undefined ? {} : { field: lookupField }),
    targets: lookupTargets,
    views: lookupViews,
  });
  validateSourceDiagnosticFlags(command, {
    ...(buildMode === undefined ? {} : { buildMode }),
    ...(checkOnly === undefined ? {} : { only: checkOnly }),
    ...(scopes === undefined ? {} : { scopes }),
    yes,
  });
  validateListFlags(command, buildMode);

  validateIsolatedFlag(command, isolated, checkOnly);
  validateDistributionFlags(command, {
    ...(buildMode === undefined ? {} : { buildMode }),
    ...(distributionName === undefined ? {} : { name: distributionName }),
    ...(distributionSubcommand === undefined
      ? {}
      : { subcommand: distributionSubcommand }),
    ...(scopes === undefined ? {} : { scopes }),
    yes,
  });
  validateMarketplaceFlags(command, {
    ...(buildMode === undefined ? {} : { buildMode }),
    ...(marketplaceName === undefined ? {} : { name: marketplaceName }),
    ...(scopes === undefined ? {} : { scopes }),
    ...(marketplaceSubcommand === undefined
      ? {}
      : { subcommand: marketplaceSubcommand }),
    yes,
  });

  if (command === "release" && scopes !== undefined) {
    throw new Error(
      "skillset: --scope is not supported with release commands yet"
    );
  }
  if (command === "release" && releaseSubcommand !== "apply" && yes) {
    throw new Error("skillset: --yes is only supported with release apply");
  }
  validateReleaseFlags(command, releaseSubcommand, {
    ...(releaseReason === undefined ? {} : { reason: releaseReason }),
    ...(releaseRef === undefined ? {} : { ref: releaseRef }),
  });
  validateTestFlags(command, {
    adHoc: hasAdHocTestFlags,
    ...(buildMode === undefined ? {} : { buildMode }),
    ...(testName === undefined ? {} : { declaredName: testName }),
    ...(distDir === undefined ? {} : { distDir }),
    ...(scopes === undefined ? {} : { scopes }),
    yes,
  });
  validateRestoreFlags(command, {
    ...(buildMode === undefined ? {} : { buildMode }),
    ...(changeSince === undefined ? {} : { changeSince }),
    ...(distDir === undefined ? {} : { distDir }),
    ...(scopes === undefined ? {} : { scopes }),
    ...(sourceDir === undefined ? {} : { sourceDir }),
  });
  validateStatusFlags(command, args);
  validateReconcileFlags(command, {
    ...(buildMode === undefined ? {} : { buildMode }),
    ...(changeSince === undefined ? {} : { changeSince }),
    ...(distDir === undefined ? {} : { distDir }),
    ...(scopes === undefined ? {} : { scopes }),
    ...(reconcileChoice === undefined ? {} : { choice: reconcileChoice }),
    ...(sourceDir === undefined ? {} : { sourceDir }),
    yes,
  });
  validateNewSourceFlags(command, {
    ...(buildMode === undefined ? {} : { buildMode }),
    ...(distDir === undefined ? {} : { distDir }),
    ...(newContainer === undefined ? {} : { container: newContainer }),
    ...(newId === undefined ? {} : { id: newId }),
    ...(importKind === undefined ? {} : { importKind }),
    ...(importProvider === undefined ? {} : { importProvider }),
    ...(newKind === undefined ? {} : { kind: newKind }),
    ...(newName === undefined ? {} : { name: newName }),
    ...(newPresets === undefined ? {} : { presets: newPresets }),
    ...(newScope === undefined ? {} : { scope: newScope }),
  });
  const options: SkillsetOptions = {
    ...(buildMode === undefined ? {} : { buildMode }),
    ...(scopes === undefined ? {} : { scopes }),
    ...(sourceDir === undefined ? {} : { sourceDir }),
    ...(distDir === undefined ? {} : { distDir }),
    ...(isolated ? { isolated: true } : {}),
  };

  return {
    command,
    changeAppend,
    ...(changeBump === undefined ? {} : { changeBump }),
    ...(changeGroup === undefined ? {} : { changeGroup }),
    ...(changeReason === undefined ? {} : { changeReason }),
    ...(changeRef === undefined ? {} : { changeRef }),
    ...(changeSince === undefined ? {} : { changeSince }),
    changeStaged,
    ...(changeScopes === undefined ? {} : { changeScopes }),
    ...(changeSubcommand === undefined ? {} : { changeSubcommand }),
    ciFix,
    ciMode,
    ...(ciReportPath === undefined ? {} : { ciReportPath }),
    ...(checkOnly === undefined ? {} : { checkOnly }),
    checkWrite,
    devWrite,
    ...(distributionName === undefined ? {} : { distributionName }),
    ...(distributionSubcommand === undefined ? {} : { distributionSubcommand }),
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
    ...(importKind === undefined ? {} : { importKind }),
    ...(importName === undefined ? {} : { importName }),
    ...(importPath === undefined ? {} : { importPath }),
    ...(importProvider === undefined ? {} : { importProvider }),
    ...(initAdopt === undefined ? {} : { initAdopt }),
    ...(initFrom === undefined ? {} : { initFrom }),
    jsonOutput,
    jsonlOutput,
    lookupAspects,
    ...(lookupField === undefined ? {} : { lookupField }),
    lookupFeatures,
    ...(lookupSubject === undefined ? {} : { lookupSubject }),
    lookupTargets,
    lookupViews,
    ...(marketplaceName === undefined ? {} : { marketplaceName }),
    ...(marketplaceSubcommand === undefined ? {} : { marketplaceSubcommand }),
    ...(newContainer === undefined ? {} : { newContainer }),
    ...(newId === undefined ? {} : { newId }),
    ...(newKind === undefined ? {} : { newKind }),
    ...(newName === undefined ? {} : { newName }),
    ...(newPresets === undefined ? {} : { newPresets }),
    ...(newScope === undefined ? {} : { newScope }),
    options,
    ...(releaseSubcommand === undefined ? {} : { releaseSubcommand }),
    ...(releaseReason === undefined ? {} : { releaseReason }),
    ...(releaseRef === undefined ? {} : { releaseRef }),
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
    rootPath: resolve(rootPath),
    ...(setupIncludes === undefined ? {} : { setupIncludes }),
    ...(setupTargets === undefined ? {} : { setupTargets }),
    ...(reconcileChoice === undefined ? {} : { reconcileChoice }),
    ...(testName === undefined ? {} : { testName }),
    yes,
  };
}

function createCliRequest(parsed: ParsedArgs): CliRequest {
  const { command, jsonOutput, options, rootPath, yes } = parsed;
  if (command === "build")
    return { command, request: { jsonOutput, options, rootPath, yes } };
  if (command === "diff")
    return { command, request: { jsonOutput, options, rootPath } };
  if (command === "dev")
    return {
      command,
      request: {
        jsonlOutput: parsed.jsonlOutput,
        options,
        rootPath,
        write: parsed.devWrite,
      },
    };
  if (command === "change")
    return {
      command,
      request: {
        changeAppend: parsed.changeAppend,
        changeBump: parsed.changeBump,
        changeGroup: parsed.changeGroup,
        changeReason: parsed.changeReason,
        changeRef: parsed.changeRef,
        changeScopes: parsed.changeScopes,
        changeSince: parsed.changeSince,
        changeStaged: parsed.changeStaged,
        changeSubcommand: parsed.changeSubcommand,
        jsonOutput,
        options,
        rootPath,
        yes,
      },
    };
  if (command === "release")
    return {
      command,
      request: {
        jsonOutput,
        options,
        releaseReason: parsed.releaseReason,
        releaseRef: parsed.releaseRef,
        releaseSubcommand: parsed.releaseSubcommand,
        rootPath,
        yes,
      },
    };
  if (command === "update")
    return { command, request: { jsonOutput, options, rootPath, yes } };
  if (command === "restore")
    return {
      command,
      request: {
        backupId: parsed.importPath,
        jsonOutput,
        options,
        rootPath,
        yes,
      },
    };
  if (command === "distribute")
    return {
      command,
      request: {
        distributionName: parsed.distributionName,
        distributionSubcommand: parsed.distributionSubcommand,
        jsonOutput,
        options,
        rootPath,
      },
    };
  if (command === "marketplace")
    return {
      command,
      request: {
        jsonOutput,
        marketplaceName: parsed.marketplaceName,
        marketplaceSubcommand: parsed.marketplaceSubcommand,
        options,
        rootPath,
        yes,
      },
    };
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
  if (command === "check")
    return {
      command,
      request: {
        changeSince: parsed.changeSince,
        checkOnly: parsed.checkOnly,
        checkWrite: parsed.checkWrite,
        ciFix: parsed.ciFix,
        ciMode: parsed.ciMode,
        ciReportPath: parsed.ciReportPath,
        jsonOutput,
        options,
        rootPath,
      },
    };
  if (command === "init")
    return {
      command,
      request: {
        destination: parsed.importPath,
        importName: parsed.importName,
        initAdopt: parsed.initAdopt,
        initFrom: parsed.initFrom,
        jsonOutput,
        options,
        rootExplicit: parsed.rootExplicit,
        rootPath,
        setupIncludes: parsed.setupIncludes,
        setupTargets: parsed.setupTargets,
        yes,
      },
    };
  if (command === "import")
    return {
      command,
      request: {
        importKind: parsed.importKind,
        importName: parsed.importName,
        importProvider: parsed.importProvider,
        jsonOutput,
        options,
        rootPath,
        sourcePath: parsed.importPath,
      },
    };
  if (command === "new")
    return {
      command,
      request: {
        jsonOutput,
        newContainer: parsed.newContainer,
        newId: parsed.newId,
        newKind: parsed.newKind,
        newName: parsed.newName,
        newPresets: parsed.newPresets,
        newScope: parsed.newScope,
        options,
        positionalName: parsed.importPath,
        rootPath,
        yes,
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
  if (command === "reconcile")
    return {
      command,
      request: {
        jsonOutput,
        managedPath: parsed.importPath,
        options,
        reconcileChoice: parsed.reconcileChoice,
        rootPath,
        yes,
      },
    };
  if (command === "status")
    return { command, request: { jsonOutput, options, rootPath } };
  throw new Error(`skillset: unhandled command ${command}`);
}

export function parseCliRequest(args: readonly string[]): CliRequest {
  try {
    return createCliRequest(parseArgs(args));
  } catch (error) {
    if (error instanceof CliOutputError) {
      throw error;
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new CliOutputError(message, 2, readCliCommand(args));
  }
}

function isReleaseSubcommand(
  value: string | undefined
): value is ReleaseSubcommand {
  return (
    value === "amend" ||
    value === "apply" ||
    value === "audit" ||
    value === "plan"
  );
}

function isChangeSubcommand(
  value: string | undefined
): value is ChangeSubcommand {
  return (
    value === "add" ||
    value === "amend" ||
    value === "check" ||
    value === "history" ||
    value === "list" ||
    value === "migrate" ||
    value === "reason" ||
    value === "show" ||
    value === "status"
  );
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

function readChangeScopes(value: string): readonly string[] {
  const scopes = value
    .split(",")
    .map((scope) => scope.trim())
    .filter((scope) => scope.length > 0);
  if (scopes.length === 0) {
    throw new Error(
      "skillset: --scope requires at least one source unit scope"
    );
  }
  return scopes.map(sourceUnitSelector);
}

function readHookRuntimeContextFields(
  value: string
): readonly HookRuntimeContextField[] {
  const fields = value
    .split(",")
    .map((field) => field.trim())
    .filter((field) => field.length > 0);
  if (fields.length === 0) {
    throw new Error("skillset: --context-fields requires at least one field");
  }
  return fields.map(readHookRuntimeContextField);
}

function readChangeBump(value: string): ChangeBump {
  if (
    value === "major" ||
    value === "minor" ||
    value === "none" ||
    value === "patch"
  ) {
    return value;
  }
  throw new Error("skillset: expected --bump major, minor, patch, or none");
}

function readPositiveInteger(value: string, flag: string): number {
  if (!/^[0-9]+$/u.test(value)) {
    throw new Error(`skillset: expected ${flag} to be a positive integer`);
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`skillset: expected ${flag} to be a positive integer`);
  }
  return parsed;
}

function setChangeReason(
  current: ChangeReasonInput | undefined,
  next: ChangeReasonInput
): ChangeReasonInput {
  if (current !== undefined) {
    throw new Error("skillset: pass only one of --reason or --reason-file");
  }
  return next;
}

function validateChangeFlags(
  command: Command,
  subcommand: ChangeSubcommand | undefined,
  change: {
    readonly append: boolean;
    readonly bump?: ChangeBump;
    readonly group?: string;
    readonly reason?: ChangeReasonInput;
    readonly ref?: string;
    readonly scopes?: readonly string[];
    readonly staged: boolean;
    readonly yes: boolean;
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
  if (command !== "change") {
    return;
  }
  if (change.yes && subcommand !== "migrate") {
    throw new Error("skillset: --yes is only supported with change migrate");
  }
  const allowed = {
    append: subcommand === "reason",
    bump: subcommand === "add",
    group: subcommand === "add" || subcommand === "list",
    reason:
      subcommand === "add" || subcommand === "amend" || subcommand === "reason",
    ref:
      subcommand === "amend" ||
      subcommand === "check" ||
      subcommand === "history" ||
      subcommand === "reason" ||
      subcommand === "show",
    scopes: subcommand === "add",
    staged: subcommand === "check" || subcommand === "status",
  };
  if (change.append && !allowed.append) {
    throw new Error("skillset: --append is only supported with change reason");
  }
  if (change.bump !== undefined && !allowed.bump) {
    throw new Error("skillset: --bump is only supported with change add");
  }
  if (change.group !== undefined && !allowed.group) {
    throw new Error(
      "skillset: --group is only supported with change add or change list"
    );
  }
  if (change.reason !== undefined && !allowed.reason) {
    throw new Error(
      "skillset: --reason and --reason-file are only supported with change add, change amend, or change reason"
    );
  }
  if (change.ref !== undefined && !allowed.ref) {
    throw new Error(
      "skillset: --ref is only supported with change amend, change check, change history, change reason, or change show"
    );
  }
  if (change.scopes !== undefined && !allowed.scopes) {
    throw new Error(
      "skillset: source-unit --scope is only supported with change add"
    );
  }
  if (change.staged && !allowed.staged) {
    throw new Error(
      "skillset: --staged is only supported with change status or change check"
    );
  }
}

function validateReleaseFlags(
  command: Command,
  subcommand: ReleaseSubcommand | undefined,
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
  if (command !== "release") {
    return;
  }

  if (release.reason !== undefined && subcommand !== "amend") {
    throw new Error(
      "skillset: --reason and --reason-file are only supported with release amend"
    );
  }
  if (release.ref !== undefined && subcommand !== "amend") {
    throw new Error("skillset: --ref is only supported with release amend");
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

function validateDistributionFlags(
  command: Command,
  distribution: {
    readonly buildMode?: CompileBuildMode;
    readonly name?: string;
    readonly scopes?: readonly BuildScope[];
    readonly subcommand?: DistributionSubcommand;
    readonly yes: boolean;
  }
): void {
  if (command !== "distribute") {
    return;
  }
  if (distribution.subcommand !== "plan") {
    throw new Error("skillset: expected distribute subcommand plan");
  }
  if (
    distribution.name !== undefined &&
    !/^[a-z0-9][a-z0-9._-]*$/.test(distribution.name)
  ) {
    throw new Error(
      "skillset: expected distribution name to be a lowercase id"
    );
  }
  if (
    distribution.buildMode !== undefined ||
    distribution.scopes !== undefined ||
    distribution.yes
  ) {
    throw new Error(
      "skillset: build/write options are not supported with distribute plan; it is always read-only"
    );
  }
}

function validateMarketplaceFlags(
  command: Command,
  marketplace: {
    readonly buildMode?: CompileBuildMode;
    readonly name?: string;
    readonly scopes?: readonly BuildScope[];
    readonly subcommand?: MarketplaceSubcommand;
    readonly yes: boolean;
  }
): void {
  if (command !== "marketplace") {
    return;
  }
  if (
    marketplace.subcommand !== "check" &&
    marketplace.subcommand !== "update"
  ) {
    throw new Error(
      "skillset: expected marketplace subcommand check or update"
    );
  }
  if (
    marketplace.name !== undefined &&
    !/^[a-z0-9][a-z0-9._-]*$/.test(marketplace.name)
  ) {
    throw new Error("skillset: expected marketplace name to be a lowercase id");
  }
  if (marketplace.subcommand === "check" && marketplace.yes) {
    throw new Error(
      "skillset: build/write options are not supported with marketplace check; it is always read-only"
    );
  }
  if (marketplace.buildMode !== undefined || marketplace.scopes !== undefined) {
    throw new Error(
      `skillset: build scope options are not supported with marketplace ${marketplace.subcommand}`
    );
  }
}

function validateTestFlags(
  command: Command,
  test: {
    readonly adHoc: boolean;
    readonly buildMode?: CompileBuildMode;
    readonly declaredName?: string;
    readonly distDir?: string;
    readonly scopes?: readonly BuildScope[];
    readonly yes: boolean;
  }
): void {
  if (command !== "test") {
    return;
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

function validateSourceDiagnosticFlags(
  command: Command,
  sourceCheck: {
    readonly buildMode?: CompileBuildMode;
    readonly only?: "outputs";
    readonly scopes?: readonly BuildScope[];
    readonly yes: boolean;
  }
): void {
  if (command !== "check") {
    return;
  }
  const label = `skillset ${command}`;
  if (sourceCheck.only === "outputs") {
    if (sourceCheck.yes) {
      throw new Error(
        `${label} --only outputs is read-only and does not support --yes`
      );
    }
    return;
  }
  if (sourceCheck.buildMode !== undefined) {
    throw new Error(
      `${label} does not support --updated or --all; it checks source diagnostics`
    );
  }
  if (sourceCheck.scopes !== undefined) {
    throw new Error(
      `${label} does not support --scope; it checks source diagnostics`
    );
  }
  if (sourceCheck.yes) {
    throw new Error(`${label} is read-only and does not support --yes`);
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

function validateRestoreFlags(
  command: Command,
  restore: {
    readonly buildMode?: CompileBuildMode;
    readonly changeSince?: string;
    readonly distDir?: string;
    readonly scopes?: readonly BuildScope[];
    readonly sourceDir?: string;
  }
): void {
  if (command !== "restore") {
    return;
  }
  if (
    restore.buildMode !== undefined ||
    restore.changeSince !== undefined ||
    restore.distDir !== undefined ||
    restore.scopes !== undefined ||
    restore.sourceDir !== undefined
  ) {
    throw new Error("skillset: restore only supports --root and --yes");
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

function validateReconcileFlags(
  command: Command,
  reconcile: {
    readonly buildMode?: CompileBuildMode;
    readonly changeSince?: string;
    readonly scopes?: readonly BuildScope[];
    readonly choice?: ReconcileChoice;
    readonly yes: boolean;
  }
): void {
  if (reconcile.choice !== undefined && command !== "reconcile") {
    throw new Error("skillset: --use is only supported with reconcile");
  }
  if (command !== "reconcile") {
    return;
  }
  if (reconcile.buildMode !== undefined) {
    throw new Error(
      "skillset: --updated and --all are not supported with reconcile"
    );
  }
  if (reconcile.changeSince !== undefined) {
    throw new Error("skillset: --since is not supported with reconcile");
  }
  if (reconcile.scopes !== undefined) {
    throw new Error("skillset: --scope is not supported with reconcile");
  }
  if (reconcile.yes && reconcile.choice === undefined) {
    throw new Error(
      "skillset: reconcile --yes requires --use source or --use output"
    );
  }
}

function validateNewSourceFlags(
  command: Command,
  source: {
    readonly buildMode?: CompileBuildMode;
    readonly container?: string;
    readonly distDir?: string;
    readonly id?: string;
    readonly importKind?: ImportKind;
    readonly importProvider?: ImportProvider;
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
  if (command !== "new") {
    return;
  }
  if (source.buildMode !== undefined) {
    throw new Error("skillset: --updated and --all are not supported with new");
  }
  if (source.distDir !== undefined) {
    throw new Error(
      "skillset: output-root overrides are not supported with new"
    );
  }
  if (source.importKind !== undefined) {
    throw new Error("skillset: --kind is only supported with import");
  }
  if (source.importProvider !== undefined) {
    throw new Error("skillset: --from is only supported with import");
  }
  if (source.kind === undefined) {
    throw new Error("skillset: expected new kind skill, agent, or hook");
  }
}

function setBuildMode(
  current: CompileBuildMode | undefined,
  next: CompileBuildMode
): CompileBuildMode {
  if (current !== undefined && current !== next) {
    throw new Error(
      `skillset: conflicting build mode flags --${current} and --${next}`
    );
  }
  return next;
}

function readBuildScopes(value: string): readonly BuildScope[] {
  const scopes = value
    .split(",")
    .map((scope) => scope.trim())
    .filter((scope) => scope.length > 0);
  if (scopes.length === 0) {
    throw new Error("skillset: --scope requires at least one scope");
  }
  if (scopes.includes("all")) {
    if (scopes.length > 1) {
      throw new Error(
        "skillset: --scope all cannot be combined with other scopes"
      );
    }
    return ["repo", "plugins", "project", "user"];
  }
  const seen = new Set<BuildScope>();
  for (const scope of scopes) {
    if (!isBuildScope(scope)) {
      throw new Error(
        "skillset: expected --scope repo, plugins, project, user, all, or a comma-separated combination"
      );
    }
    seen.add(scope);
  }
  return [...seen];
}

function isBuildScope(value: string): value is BuildScope {
  return (
    value === "repo" ||
    value === "plugins" ||
    value === "project" ||
    value === "user"
  );
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

function readTargetName(value: string): TargetName {
  if (isTargetName(value)) {
    return value;
  }
  throw new Error(`skillset: expected --target ${targetNames().join(", ")}`);
}

function mergeSetupIncludes(
  current: readonly SetupInclude[] | undefined,
  value: string
): readonly SetupInclude[] {
  const includes = value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
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

function readSetupTargets(value: string): readonly TargetName[] {
  const targets = value
    .split(",")
    .map((target) => target.trim())
    .filter((target) => target.length > 0);
  if (targets.length === 0) {
    throw new Error("skillset: --targets requires at least one target");
  }
  const seen = new Set<TargetName>();
  for (const target of targets) {
    if (!isTargetName(target)) {
      throw new Error(
        `skillset: expected --targets ${targetNames().join(", ")}`
      );
    }
    seen.add(target);
  }
  return [...seen];
}

function validateIsolatedFlag(
  command: Command,
  isolated: boolean,
  checkOnly?: "outputs"
): void {
  if (!isolated) {
    return;
  }
  if (
    command === "build" ||
    command === "diff" ||
    (command === "check" && checkOnly === "outputs")
  ) {
    return;
  }
  throw new Error(
    "skillset: --isolated is only supported with build, check --only outputs, or diff"
  );
}

function validateCiFlags(
  command: Command,
  ci: {
    readonly ci: boolean;
    readonly fix: boolean;
    readonly only?: "outputs";
    readonly reportPath?: string;
    readonly since?: string;
    readonly write: boolean;
    readonly yes: boolean;
  }
): void {
  if (command !== "check") {
    if (
      ci.ci ||
      ci.fix ||
      ci.only !== undefined ||
      ci.reportPath !== undefined ||
      ci.write
    ) {
      throw new Error(
        "skillset: readiness flags are only supported with check"
      );
    }
    if (ci.since !== undefined && command !== "change" && command !== "hooks") {
      throw new Error(
        "skillset: --since is only supported with check --ci or change commands"
      );
    }
    return;
  }
  if (ci.yes) {
    throw new Error(
      "skillset: check does not take mutation confirmation flags"
    );
  }
  if (ci.fix && !ci.ci) {
    throw new Error("skillset: check --fix requires --ci");
  }
  if (ci.write && ci.ci) {
    throw new Error("skillset: check --ci uses --fix instead of --write");
  }
  if ((ci.reportPath !== undefined || ci.since !== undefined) && !ci.ci) {
    throw new Error("skillset: --report and --since require check --ci");
  }
  if (
    ci.only !== undefined &&
    (ci.ci ||
      ci.fix ||
      ci.write ||
      ci.reportPath !== undefined ||
      ci.since !== undefined)
  ) {
    throw new Error(
      "skillset: check --only outputs cannot be combined with CI or write flags"
    );
  }
}

function validateDevFlags(
  command: Command,
  dev: {
    readonly write: boolean;
    readonly buildMode?: CompileBuildMode;
    readonly scopes?: readonly BuildScope[];
    readonly yes: boolean;
  }
): void {
  if (dev.write && command !== "dev") {
    throw new Error("skillset: dev write mode is only supported with dev");
  }
  if (command !== "dev") {
    return;
  }
  if (dev.buildMode !== undefined) {
    throw new Error("skillset: dev does not support --updated or --all");
  }
  if (dev.scopes !== undefined) {
    throw new Error("skillset: dev does not support --scope yet");
  }
  if (dev.yes) {
    throw new Error(
      "skillset: dev uses preview mode by default or write mode with --write; it does not support --yes"
    );
  }
}

function validateUpdateFlags(
  command: Command,
  update: {
    readonly buildMode?: CompileBuildMode;
    readonly scopes?: readonly BuildScope[];
    readonly yes: boolean;
  }
): void {
  if (command !== "update") {
    return;
  }
  if (update.buildMode !== undefined) {
    throw new Error("skillset: update does not support --updated or --all");
  }
  if (update.scopes !== undefined) {
    throw new Error(
      "skillset: update does not support --scope; provider format updates require a whole-workspace safety preflight"
    );
  }
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

function validateAdoptFlags(
  command: Command,
  adopt: {
    readonly buildMode?: CompileBuildMode;
    readonly scopes?: readonly BuildScope[];
  }
): void {
  if (command !== "init") {
    return;
  }
  if (adopt.buildMode !== undefined || adopt.scopes !== undefined) {
    throw new Error(
      "skillset: build mode and scope flags are not supported with adopt; adoption always builds the full projection isolated"
    );
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
  if (
    command === "build" ||
    command === "import" ||
    command === "init" ||
    command === "new" ||
    command === "reconcile" ||
    command === "restore" ||
    command === "update"
  ) {
    return;
  }
  if (command === "check") {
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
  }
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
