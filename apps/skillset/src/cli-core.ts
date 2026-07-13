import { mkdir, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { createInterface } from "node:readline/promises";

import {
  auditVersions,
  buildSkillsetResult,
  checkMarketplaces,
  createOperationalPathContext,
  diffSkillsetResult,
  isRepoOperationalCachePath,
  planDistributions,
  recordKnownSkillsetWorkspace,
  resolveOperationalPath,
  restoreOutputBackup,
  updateMarketplaces,
  verifySkillsetResult,
  isTargetName,
  targetNames,
  type DistributionPlanReport,
  type LookupSubject,
  type LookupView,
  type MarketplaceCheckReport,
  type MarketplaceUpdateReport,
  type OutputBackupRestoreReport,
  type SkillsetDiagnostic,
  type VersionAuditReport,
} from "@skillset/core";

import { changeCheck, type ChangeBump, type ChangeCheckReport } from "./change-entries";
import { changeStatus, type ChangeStatusReport } from "./change-status";
import { ADOPT_REPORT_DIR, adoptCandidateId, adoptSkillset, type AdoptReport } from "./adopt";
import {
  addChangeEntry,
  amendAppliedChange,
  groupRef,
  listChangeEntries,
  migratePendingChangeEntries,
  readChangeHistory,
  showChangeEntry,
  updateChangeReason,
  type ChangeEntryView,
  type ChangeMigrationReport,
  type ChangeReasonInput,
  type ChangeSubcommand,
} from "./change-workflow";
import {
  doctorSkillset,
  explainPath,
  listFeatureCapabilities,
  listGeneratedEntries,
  type FeatureCapability,
} from "@skillset/core/internal/authoring";
import { ciSkillset, hasDrift, renderCiReportMarkdown, type CiReport } from "./ci";
import { printDiagnostics, printDiffPlan, printGeneratedChangelogDriftHint, printGeneratedChangelogPathHint } from "./cli-renderers";
import { CliOutputError, readCliCommand } from "./cli-output";
import { isCliCommand, renderExpectedCliCommands, type CliCommand } from "./cli-commands";
import { runDevWatch } from "./dev-watch";
import {
  dispatchHookRun,
  readHookRuntimeContextField,
  readHookRuntimeContextFormat,
  readHookRunEvent,
  readHookStdin,
  renderHookPrint,
  renderHookRuntimeContext,
  type HookRuntimeContextField,
  type HookRuntimeContextFormat,
  type HookRunEvent,
  type HookRunner,
  type HookSubcommand,
} from "./runtime-hooks";
import { importSources, type ImportKind, type ImportProvider, type ImportReport } from "./import";
import {
  addLookupTarget,
  addLookupTargets,
  addLookupView,
  readLookupSubject,
  runLookupCommand,
  setLookupField,
} from "./lookup-cli";
import { loadBuildGraph } from "@skillset/core/internal/resolver";
import {
  scaffoldSourceUnit,
  type NewSourceKind,
  type NewSourceReport,
  type NewSourceScope,
} from "./new-source";
import {
  amendReleaseRecord,
  applyRelease,
  planRelease,
  type ReleaseAmendReport,
  type ReleasePlanReport,
  type ReleaseSubcommand,
} from "./release";
import {
  renderProviderFormatUpdateReport,
  runProviderFormatUpdates,
} from "./provider-format-updates";
import { reconcileManagedPath, renderReconcileReport, type ReconcileChoice } from "./reconcile";
import { readClaudeSettingSources, type TryClaudeSettingSources, type TrySubcommand } from "./try";
import {
  isTrySubcommand,
  runTryCommand,
  validateTryFlags,
} from "./try-cli";
import { initSkillset, type SetupInclude, type SetupReport } from "./setup";
import { sourceUnitDisplay, sourceUnitDisplays, sourceUnitSelector } from "@skillset/core/internal/source-unit-selector";
import { renderValidatedJson } from "@skillset/core/internal/structured-output";
import { renderCliDataResult } from "./cli-output";
import { runSkillsetTest, type SkillsetTestReport } from "./test-runner";
import type { BuildScope, CompileBuildMode, JsonRecord, SkillsetOptions, SourceOrigin, TargetName } from "@skillset/core/internal/types";
import type { SchemaJsonRecord, SkillsetCliDiagnostic } from "@skillset/schema";

type Command = CliCommand;
type DistributionSubcommand = "plan";
type MarketplaceSubcommand = "check" | "update";

const USAGE = [
  "usage: skillset build [--yes|--dry-run] [--updated|--all] [--isolated] [--scope <scope>] [--root <path>] [--source <dir>] [--dist <dir>]",
  "       skillset diff [--updated|--all] [--isolated] [--scope <scope>] [--root <path>] [--source <dir>] [--dist <dir>]",
  "       skillset check [--write|--only outputs|--ci [--fix] [--since <ref>] [--report <path>]] [--json] [--root <path>]",
  "       skillset list [--updated|--all] [--scope <scope>] [--root <path>] [--source <dir>] [--dist <dir>]",
  "       skillset status [--json] [--root <path>]",
  "       skillset dev --watch [--apply] [--root <path>] [--source <dir>] [--dist <dir>]",
  "       skillset change status [--since <ref>] [--root <path>] [--source <dir>] [--dist <dir>]",
  "       skillset change check [@ref|--ref <ref>] [--since <ref>] [--root <path>] [--source <dir>] [--dist <dir>]",
  "       skillset change <status|check> --staged [--root <path>] [--source <dir>] [--dist <dir>]",
  "       skillset change add --scope <source-unit> --bump <bump> [--group <group>] [--reason <text>|--reason-file <path>|--reason -] [--since <ref>] [--root <path>] [--source <dir>]",
  "       skillset change reason <@ref> [--append] [--reason <text>|--reason-file <path>|--reason -] [--root <path>] [--source <dir>]",
  "       skillset change amend <@ref> [--reason <text>|--reason-file <path>|--reason -] [--root <path>] [--source <dir>]",
  "       skillset change migrate [--yes|--dry-run] [--root <path>] [--source <dir>]",
  "       skillset change <show|history> [@ref] [--root <path>] [--source <dir>]",
  "       skillset change list [--group <group>] [--root <path>] [--source <dir>]",
  "       skillset release audit [--root <path>] [--source <dir>] [--dist <dir>]",
  "       skillset release plan [--root <path>] [--source <dir>] [--dist <dir>]",
  "       skillset release apply [--yes|--dry-run] [--root <path>] [--source <dir>] [--dist <dir>]",
  "       skillset release amend <@ref> [--reason <text>|--reason-file <path>|--reason -] [--root <path>]",
  "       skillset restore <backup-id> [--yes|--dry-run] [--root <path>]",
  "       skillset reconcile <managed-path> [--use <source|output> --yes] [--root <path>]",
  "       skillset distribute plan [name] [--root <path>] [--source <dir>] [--dist <dir>]",
  "       skillset marketplace check [name] [--json] [--root <path>] [--source <dir>] [--dist <dir>]",
  "       skillset marketplace update [name] [--yes|--dry-run] [--json] [--root <path>] [--source <dir>] [--dist <dir>]",
  "       skillset update [--yes|--dry-run] [--root <path>] [--source <dir>] [--dist <dir>]",
  "       skillset lookup features [feature-id] [--json]",
  "       skillset lookup [subject] [aspect...] [--frontmatter] [--fields] [--field <path>] [--values] [--events] [--compat [claude|codex|cursor...]] [--examples] [--schema] [--claude] [--codex] [--cursor] [--json]",
  "       skillset test [name] [--root <path>] [--source <dir>]",
  "       skillset test --target <claude|codex|cursor> [--prompt <text>|--prompt-file <path>] [--plugin <id>] [--name <name>] [--timeout-ms <ms>] [--claude-setting-sources <isolated|user|project|local>] [--background] [--json] [--root <path>] [--source <dir>]",
  "       skillset test <status|tail> [run-id] [--lines <count>] [--json] [--root <path>]",
  "       skillset test list [--json] [--root <path>]",
  "       skillset hooks print --runner <lefthook|husky|pre-commit|git> [--pre-commit] [--pre-push]",
  "       skillset hooks print --target <claude|codex> --agent-runtime",
  "       skillset hooks run <post-tool-use|stop> [--root <path>]",
  "       skillset hooks context --event <event> [--format env|json] [--context-fields <field,...>] [--root <path>]",
  "       skillset init [destination] [--from <path|git-url>] [--adopt <all|candidate-id>] [--yes] [--targets claude,codex,cursor] [--include ci] [--name <name>] [--root <path>]",
  "       skillset new <skill|agent|hook> [name] [--id <id>] [--name <name>] [--in <container>] [--scope repo] [--preset <preset>] [--yes|--dry-run] [--root <path>] [--source <dir>]",
  "       skillset explain <path> [--json] [--scope <scope>] [--root <path>] [--source <dir>]",
  "       skillset import <path> [--kind <skill|skills|plugin|plugins>] [--from <provider>] [--name <name>] [--root <path>] [--source <dir>]",
  "       skillset import <claude|codex|cursor|agents> [--root <path>] [--source <dir>]",
].join("\n");

export async function runCli(
  rawArgs: readonly string[] = process.argv.slice(2)
): Promise<void> {
  const args = rawArgs;
  if (args.some((arg) => arg === "--help" || arg === "-h")) {
    console.log(USAGE);
    return;
  }
  const {
    command,
    changeAppend,
    changeBump,
    changeGroup,
    changeReason,
    changeRef,
    changeSince,
    changeStaged,
    changeScopes,
    changeSubcommand,
    ciFix,
    ciMode,
    ciReportPath,
    checkOnly,
    checkWrite,
    devApply,
    devWatch,
    dryRun,
    distributionName,
    distributionSubcommand,
    hookAgentRuntime,
    hookContextEvent,
    hookContextFields,
    hookContextFormat,
    hookPreCommit,
    hookPrePush,
    hookRunner,
    hookRunEvent,
    hookSubcommand,
    hookTarget,
    importKind,
    importPath,
    importName,
    importProvider,
    initAdopt,
    initFrom,
    jsonOutput,
    lookupAspects,
    lookupField,
    lookupFeatures,
    lookupSubject,
    lookupTargets,
    lookupViews,
    marketplaceName,
    marketplaceSubcommand,
    newContainer,
    newId,
    newKind,
    newName,
    newPresets,
    newScope,
    options,
    rootPath,
    rootExplicit,
    releaseSubcommand,
    releaseReason,
    releaseRef,
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
    setupIncludes,
    setupTargets,
    reconcileChoice,
    testName,
    yes,
  } = parseCliArgs(args);

  if (command === "build") {
    console.log("skillset: build projects source to generated output");
    if (dryRun || !yes) {
      const result = await diffSkillsetResult(rootPath, options);
      printDiagnostics(result.diagnostics);
      const { data: diff } = result;
      printDiffPlan(diff, dryRun ? "dry run" : "write confirmation required");
      if (!dryRun) console.log("skillset: rerun with --yes to write generated files");
      await rememberKnownSkillsetWorkspace(rootPath, options);
      return;
    }
    const result = await buildSkillsetResult(rootPath, options);
    printDiagnostics(result.diagnostics);
    console.log(`skillset: wrote ${result.writes.writtenPaths.length} generated files`);
    if (result.writes.deletedPaths.length > 0) {
      console.log(`skillset: removed ${result.writes.deletedPaths.length} stale generated files`);
    }
    if (result.writes.backupManifestPath !== undefined) {
      console.log(
        `skillset: backed up ${result.writes.backupRecords?.length ?? 0} overwritten output file` +
          `${result.writes.backupRecords?.length === 1 ? "" : "s"} to ${result.writes.backupManifestPath}`
      );
    }
    await rememberKnownSkillsetWorkspace(rootPath, options);
    return;
  }

  if (command === "dev") {
    if (!devWatch) throw new Error("skillset: dev currently requires --watch");
    await runDevWatch(rootPath, options, process.stdout, devApply ? "apply" : "preview");
    return;
  }

  if (command === "change") {
    const changeOptions = { ...options, ...(changeSince === undefined ? {} : { since: changeSince }) };
    if (changeSubcommand === "status") {
      const report = await changeStatus(rootPath, {
        ...changeOptions,
        ...(changeStaged ? { staged: true } : {}),
      });
      if (jsonOutput) printCliJsonData("change.status", report);
      else printChangeStatus(report);
      return;
    }
    if (changeSubcommand === "check") {
      const report = await changeCheck(rootPath, {
        ...changeOptions,
        ...(changeRef === undefined ? {} : { ref: changeRef }),
        ...(changeStaged ? { staged: true } : {}),
      });
      if (jsonOutput) printCliJsonData("change.check", {
        ...report,
        entries: report.entries.map(serializeChangeEntry),
      }, report.ok ? 0 : 1, report.ok ? "data" : "diagnostics", report.issues.map((issue) => ({
        code: issue.code,
        message: issue.message,
        ...(issue.path === undefined ? {} : { path: issue.path }),
        severity: issue.severity,
      })));
      else printChangeCheck(report);
      return;
    }
    if (changeSubcommand === "add") {
      printChangeEntry("added", (await addChangeEntry(rootPath, {
        ...changeOptions,
        ...(changeBump === undefined ? {} : { bump: changeBump }),
        ...(changeGroup === undefined ? {} : { group: changeGroup }),
        reason: changeReason ?? { kind: "auto" },
        scopes: changeScopes ?? [],
      })).entry);
      return;
    }
    if (changeSubcommand === "reason") {
      if (changeRef === undefined) throw new Error("skillset: change reason requires @ref");
      printChangeEntry("updated", (await updateChangeReason(rootPath, {
        ...changeOptions,
        append: changeAppend,
        reason: changeReason ?? { kind: "auto" },
        ref: changeRef,
      })).entry);
      return;
    }
    if (changeSubcommand === "amend") {
      if (changeRef === undefined) throw new Error("skillset: change amend requires @ref");
      const report = await amendAppliedChange(rootPath, {
        ...changeOptions,
        reason: changeReason ?? { kind: "auto" },
        ref: changeRef,
      });
      printChangeEntry("amended", report.entry);
      console.log(`  amendment: ${report.path}`);
      return;
    }
    if (changeSubcommand === "show") {
      if (changeRef === undefined) throw new Error("skillset: change show requires @ref");
      const report = await showChangeEntry(rootPath, { ...changeOptions, ref: changeRef });
      if (jsonOutput) printCliJsonData("change.show", {
        ...report,
        entry: serializeChangeEntry(report.entry),
      });
      else printChangeEntry("show", report.entry);
      return;
    }
    if (changeSubcommand === "list") {
      const report = await listChangeEntries(rootPath, {
        ...changeOptions,
        ...(changeGroup === undefined ? {} : { group: changeGroup }),
      });
      if (jsonOutput) printCliJsonData("change.list", {
        ...report,
        entries: report.entries.map(serializeChangeEntry),
      });
      else printChangeList(report.entries);
      return;
    }
    if (changeSubcommand === "history") {
      const report = await readChangeHistory(rootPath, {
        ...changeOptions,
        ...(changeRef === undefined ? {} : { ref: changeRef }),
      });
      if (jsonOutput) printCliJsonData("change.history", {
        ...report,
        entries: report.entries.map(serializeChangeEntry),
      });
      else printChangeHistory(report.entries);
      return;
    }
    if (changeSubcommand === "migrate") {
      const report = await migratePendingChangeEntries(rootPath, {
        ...changeOptions,
        write: yes && !dryRun,
      });
      printChangeMigration(report);
      if ((!yes || dryRun) && report.entries.length > 0) console.log("skillset: rerun change migrate with --yes to rewrite pending entries");
      return;
    }
    throw new Error("skillset: expected change subcommand add, amend, check, history, list, migrate, reason, show, or status");
  }

  if (command === "release") {
    if (releaseSubcommand === "audit") {
      const report = await auditVersions(rootPath, options);
      printVersionAudit(report);
      if (report.issues.length > 0) process.exitCode = 1;
      return;
    }
    if (releaseSubcommand === "plan") {
      printReleasePlan(await planRelease(rootPath, options));
      return;
    }
    if (releaseSubcommand === "apply") {
      if (dryRun || !yes) {
        printReleasePlan(await planRelease(rootPath, options));
        if (dryRun) {
          console.log("skillset: release apply dry run wrote no files");
        } else {
          console.log("skillset: rerun release apply with --yes to write release state");
        }
        return;
      }
      const result = await applyRelease(rootPath, options);
      printReleaseApply(result.plan, result.files, result.renderedFiles);
      return;
    }
    if (releaseSubcommand === "amend") {
      if (releaseRef === undefined) throw new Error("skillset: release amend requires @ref");
      printReleaseAmend(await amendReleaseRecord(rootPath, {
        ...options,
        reason: releaseReason ?? { kind: "auto" },
        ref: releaseRef,
      }));
      return;
    }
    throw new Error("skillset: expected release subcommand amend, apply, audit, or plan");
  }

  if (command === "update") {
    const report = await runProviderFormatUpdates(rootPath, "update", {
      ...options,
      write: yes && !dryRun,
    });
    process.stdout.write(renderProviderFormatUpdateReport(report));
    if (!yes || dryRun) console.log("skillset: update preview wrote no files");
    if (!report.ok || report.blocked) process.exitCode = 1;
    return;
  }

  if (command === "restore") {
    if (importPath === undefined) throw new Error("skillset: expected backup id to restore");
    const report = await restoreOutputBackup(rootPath, importPath, { write: yes && !dryRun });
    printRestoreReport(report);
    if (!yes || dryRun) console.log("skillset: rerun restore with --yes to write restored files");
    return;
  }

  if (command === "distribute") {
    if (distributionSubcommand === "plan") {
      const report = await planDistributions(rootPath, {
        ...options,
        ...(distributionName === undefined ? {} : { name: distributionName }),
      });
      if (jsonOutput) printCliJsonData("distribute.plan", { plans: report.plans }, 0, "plan");
      else printDistributionPlan(report);
      return;
    }
    throw new Error("skillset: expected distribute subcommand plan");
  }

  if (command === "marketplace") {
    if (marketplaceSubcommand === "check") {
      const report = await checkMarketplaces(rootPath, {
        ...options,
        ...(marketplaceName === undefined ? {} : { name: marketplaceName }),
      });
      if (jsonOutput) {
        const diagnostics = report.entries
          .filter((entry) => entry.readiness === "not-ready")
          .map((entry): SkillsetCliDiagnostic => ({
            code: "marketplace.not-ready",
            message: `${entry.catalog}/${entry.entryId}: ${entry.reason}`,
            ...(entry.generatedPath === undefined ? {} : { path: entry.generatedPath }),
            severity: "error",
          }));
        printCliJsonData("marketplace.check", report, report.ok ? 0 : 1, "diagnostics", diagnostics);
      } else {
        printMarketplaceCheck(report);
      }
      if (!report.ok) process.exitCode = 1;
      return;
    }
    if (marketplaceSubcommand === "update") {
      const report = await updateMarketplaces(rootPath, {
        ...options,
        ...(marketplaceName === undefined ? {} : { name: marketplaceName }),
        write: yes && !dryRun,
      });
      if (jsonOutput) {
        process.stdout.write(renderValidatedJson(report as unknown as JsonRecord, "skillset marketplace update"));
      } else {
        printMarketplaceUpdate(report);
      }
      if (!jsonOutput && (!yes || dryRun)) console.log("skillset: marketplace update preview wrote no files");
      if (!report.ok) process.exitCode = 1;
      return;
    }
    throw new Error("skillset: expected marketplace subcommand check or update");
  }

  if (command === "hooks") {
    if (hookSubcommand === "print") {
      process.stdout.write(renderHookPrint({
        agentRuntime: hookAgentRuntime,
        preCommit: hookPreCommit,
        prePush: hookPrePush,
        ...(hookRunner === undefined ? {} : { runner: hookRunner }),
        ...(hookTarget === undefined ? {} : { target: hookTarget }),
      }));
      return;
    }
    if (hookSubcommand === "run") {
      const stdinText = await readHookStdin();
      const result = await dispatchHookRun(hookRunEvent, {
        rootPath,
        stderr: process.stderr,
        ...(stdinText === undefined ? {} : { stdinText }),
      });
      if (result.exitCode !== 0) process.exitCode = result.exitCode;
      return;
    }
    if (hookSubcommand === "context") {
      if (hookContextEvent === undefined) throw new Error("skillset: hooks context requires --event");
      process.stdout.write(await renderHookRuntimeContext({
        event: hookContextEvent,
        ...(hookContextFields === undefined ? {} : { fields: hookContextFields }),
        format: hookContextFormat ?? "json",
        rootPath,
      }));
      return;
    }
    throw new Error("skillset: expected hooks subcommand context, print, or run");
  }

  if (command === "test") {
    if (trySubcommand !== undefined || tryTarget !== undefined) {
      await runTryCommand(rootPath, {
        background: tryBackground,
        ...(tryClaudeSettingSources === undefined ? {} : { claudeSettingSources: tryClaudeSettingSources }),
        json: jsonOutput,
        ...(tryLines === undefined ? {} : { lines: tryLines }),
        ...(tryName === undefined ? {} : { name: tryName }),
        plugins: tryPlugins,
        ...(tryPrompt === undefined ? {} : { prompt: tryPrompt }),
        ...(tryPromptFile === undefined ? {} : { promptFile: tryPromptFile }),
        ...(tryRunId === undefined ? {} : { runId: tryRunId }),
        skillsetOptions: options,
        ...(trySubcommand === undefined ? {} : { subcommand: trySubcommand }),
        ...(tryTarget === undefined ? {} : { target: tryTarget }),
        ...(tryTimeoutMs === undefined ? {} : { timeoutMs: tryTimeoutMs }),
      });
      return;
    }
    const report = await runSkillsetTest(rootPath, testName, options);
    if (jsonOutput) printCliJsonData("test", report, report.ok ? 0 : 1, "test");
    else printSkillsetTest(report);
    if (!report.ok) process.exitCode = 1;
    return;
  }

  if (command === "check") {
    if (checkOnly === "outputs") {
      const result = await verifySkillsetResult(rootPath, options);
      if (jsonOutput) {
        printCliJsonData(
          "check",
          result.data,
          result.ok ? 0 : 1,
          "diagnostics",
          serializeDiagnostics(result.diagnostics)
        );
      } else {
        printDiagnostics(result.diagnostics);
        console.log(`skillset: checked ${result.data.checkedFiles} generated files`);
        if (!result.ok) {
          for (const failure of result.data.failures) console.error(failure);
          process.exitCode = 1;
        }
      }
      return;
    }
    const report = await ciSkillset(rootPath, {
      ...options,
      ci: ciMode,
      ...((checkWrite || ciFix) ? { fix: true } : {}),
      ...(changeSince === undefined ? {} : { since: changeSince }),
    });
    if (ciReportPath !== undefined) {
      const reportPath = await resolveCliReportPath(rootPath, ciReportPath, options);
      await mkdir(dirname(reportPath), { recursive: true });
      await writeFile(reportPath, renderCiReportMarkdown(report));
    }
    if (jsonOutput) printCliJsonData("check", report, report.ok ? 0 : 1, "diagnostics", ciReportDiagnostics(report));
    else printCiReport(report);
    if (!report.ok) process.exitCode = 1;
    else if (!ciMode && !jsonOutput) await rememberKnownSkillsetWorkspace(rootPath, options);
    return;
  }

  if (command === "init") {
    if (initAdopt !== undefined || initFrom !== undefined) {
      const writeMode = initAdopt !== undefined && yes && !dryRun;
      const inferredRoot = initFrom === undefined
        ? (await initSkillset({ cwd: rootPath, useGitRoot: !rootExplicit, write: false })).rootPath
        : rootPath;
      const report = await adoptSkillset(initFrom ?? inferredRoot, {
        cwd: rootPath,
        ...(initAdopt === undefined ? {} : { candidates: initAdopt }),
        ...(importPath === undefined ? {} : { destination: resolve(rootPath, importPath) }),
        ...(setupIncludes === undefined ? {} : { include: setupIncludes }),
        ...(importName === undefined ? {} : { name: importName }),
        ...(setupTargets === undefined ? {} : { targets: setupTargets }),
        write: writeMode,
      });
      const reason = writeMode ? report.write ? "written" : "blocked before write" : "write confirmation required";
      printAdoptReport(report, reason);
      if (!writeMode && report.ok && initAdopt !== undefined) console.log("skillset: rerun init with --adopt and --yes to write adopted source");
      if (!report.ok) process.exitCode = 1;
      if (writeMode && report.ok) await rememberKnownSkillsetWorkspace(report.rootPath, options);
      return;
    }
    if (!yes && !dryRun && process.stdin.isTTY && process.stdout.isTTY) {
      const survey = await initSkillset({
        cwd: rootPath,
        ...(importPath === undefined ? {} : { rootPath: importPath }),
        ...(setupIncludes === undefined ? {} : { include: setupIncludes }),
        ...(setupTargets === undefined ? {} : { targets: setupTargets }),
        useGitRoot: !rootExplicit && importPath === undefined,
        write: false,
      });
      if (survey.importCandidates.length > 0) {
        printSetupReport(survey, "interactive preview");
        const selection = await promptForInitAdoption(survey.importCandidates);
        if (selection.confirmed && selection.candidates.length > 0) {
          const report = await adoptSkillset(importPath ?? survey.rootPath, {
            candidates: selection.candidates,
            cwd: rootPath,
            ...(importName === undefined ? {} : { name: importName }),
            ...(setupIncludes === undefined ? {} : { include: setupIncludes }),
            ...(setupTargets === undefined ? {} : { targets: setupTargets }),
            write: true,
          });
          printAdoptReport(report, report.write ? "written" : "blocked before write");
          if (!report.ok) process.exitCode = 1;
          else await rememberKnownSkillsetWorkspace(report.rootPath, options);
          return;
        }
        if (!selection.confirmed) {
          printSetupReport(survey, "write confirmation declined");
          return;
        }
        const setup = await initSkillset({
          cwd: rootPath,
          ...(importPath === undefined ? {} : { rootPath: importPath }),
          ...(importName === undefined ? {} : { name: importName }),
          ...(setupIncludes === undefined ? {} : { include: setupIncludes }),
          ...(setupTargets === undefined ? {} : { targets: setupTargets }),
          useGitRoot: !rootExplicit && importPath === undefined,
          write: true,
        });
        printSetupReport(setup, "written");
        await rememberKnownSkillsetWorkspace(setup.rootPath, options);
        return;
      }
    }
    const setup = await initSkillset({
      cwd: rootPath,
      ...(importPath === undefined ? {} : { rootPath: importPath }),
      ...(importName === undefined ? {} : { name: importName }),
      ...(setupTargets === undefined ? {} : { targets: setupTargets }),
      ...(setupIncludes === undefined ? {} : { include: setupIncludes }),
      useGitRoot: !rootExplicit && importPath === undefined,
      write: yes && !dryRun,
    });
    printSetupReport(setup, dryRun ? "dry run" : yes ? "written" : "write confirmation required");
    if (!yes || dryRun) console.log("skillset: rerun init with --yes to write setup files");
    if (yes && !dryRun) await rememberKnownSkillsetWorkspace(setup.rootPath, options);
    return;
  }

  if (command === "import") {
    const result = await importSources({
      ...(importKind === undefined ? {} : { kind: importKind }),
      ...(importName === undefined ? {} : { name: importName }),
      ...(importPath === undefined ? {} : { sourcePath: importPath }),
      ...(importProvider === undefined ? {} : { provider: importProvider }),
      rootPath,
      ...(options.sourceDir === undefined ? {} : { sourceDir: options.sourceDir }),
    });
    if (result.imports.length === 1) {
      const [single] = result.imports;
      if (single !== undefined) printImportReport(single);
    } else {
      console.log(`skillset: imported ${result.imports.length} ${result.kind} (${result.files} files)`);
      console.log(`  source: ${result.sourcePath}`);
      for (const imported of result.imports) {
        console.log(`  - ${imported.kind} ${imported.name}: ${imported.targetPath} (${imported.files} files)`);
      }
    }
    for (const warning of result.warnings) console.warn(`  warning: ${warning}`);
    return;
  }

  if (command === "new") {
    if (newKind === undefined) throw new Error("skillset: expected new kind skill, agent, or hook");
    const report = await scaffoldSourceUnit(rootPath, {
      ...(newContainer === undefined ? {} : { container: newContainer }),
      ...(newId === undefined ? {} : { id: newId }),
      kind: newKind,
      ...(newName === undefined ? {} : { displayName: newName }),
      ...(importPath === undefined ? {} : { name: importPath }),
      ...(newPresets === undefined ? {} : { presets: newPresets }),
      ...(newScope === undefined ? {} : { scope: newScope }),
      skillsetOptions: options,
      write: yes && !dryRun,
    });
    printNewSourceReport(report, dryRun ? "dry run" : yes ? "written" : "write confirmation required");
    if (!yes || dryRun) console.log("skillset: rerun new with --yes to write source files");
    return;
  }

  if (command === "diff") {
    const result = await diffSkillsetResult(rootPath, options);
    if (jsonOutput) {
      const exitCode = result.ok ? 0 : 1;
      printCliJsonData(
        "diff",
        result.data,
        exitCode,
        "data",
        serializeDiagnostics(result.diagnostics)
      );
      return;
    }
    printDiagnostics(result.diagnostics);
    const { data: diff } = result;
    const total = diff.added.length + diff.changed.length + diff.missing.length + diff.removed.length;
    if (total === 0) {
      console.log("skillset: no generated changes");
      return;
    }
    for (const path of diff.added) console.log(`  + ${path}`);
    for (const path of diff.changed) console.log(`  ~ ${path}`);
    for (const path of diff.missing) console.log(`  ! ${path}`);
    for (const path of diff.removed) console.log(`  - ${path}`);
    console.log(
      `skillset: ${diff.added.length} added, ${diff.changed.length} changed, ${diff.missing.length} missing, ${diff.removed.length} removed (run skillset build --yes to apply)`
    );
    printGeneratedChangelogDriftHint(diff);
    return;
  }

  if (command === "list") {
    const entries = await listGeneratedEntries(rootPath, options);
    if (jsonOutput) {
      printCliJsonData("list", { entries });
      return;
    }
    for (const entry of entries) {
      const feature = entry.feature === undefined ? "" : ` ${entry.feature}`;
      const origin = entry.origin === undefined ? "" : ` (${entry.origin})`;
      const dependencies = entry.dependencies === undefined || entry.dependencies.length === 0
        ? ""
        : ` deps:${entry.dependencies.join(";")}`;
      console.log(`  [${entry.target}] ${entry.kind ?? "generated"}${feature}${origin} ${entry.sourcePath} -> ${entry.outputPath}${dependencies}`);
    }
    console.log(`skillset: listed ${entries.length} generated entries`);
    return;
  }

  if (command === "lookup" && lookupFeatures) {
    const features = listFeatureCapabilities(importPath);
    if (jsonOutput) {
      const exitCode = importPath !== undefined && features.length === 0 ? 1 : 0;
      printCliJsonData("features", { features }, exitCode);
      if (exitCode !== 0) process.exitCode = exitCode;
      return;
    }
    if (features.length === 0) {
      console.log(`skillset: feature ${importPath ?? ""} not found`);
      process.exitCode = 1;
      return;
    }
    for (const feature of features) {
      printFeatureCapability(feature);
    }
    console.log(`skillset: listed ${features.length} feature${features.length === 1 ? "" : "s"}`);
    return;
  }

  if (command === "lookup") {
    runLookupCommand({
      aspects: lookupAspects,
      ...(lookupField === undefined ? {} : { field: lookupField }),
      json: jsonOutput,
      ...(lookupSubject === undefined ? {} : { subject: lookupSubject }),
      targets: lookupTargets,
      views: lookupViews,
    });
    return;
  }

  if (command === "explain") {
    if (importPath === undefined) {
      throw new Error("skillset: expected a path to explain");
    }
    const result = await explainPath(rootPath, importPath, options);
    if (jsonOutput) {
      const exitCode = result.kind === "unknown" ? 1 : 0;
      const diagnostics = result.kind === "unknown"
        ? result.notes.map((message): SkillsetCliDiagnostic => ({
            code: "explain.path-unknown",
            message,
            path: result.path,
            severity: "error",
          }))
        : [];
      printCliJsonData(
        "explain",
        result,
        exitCode,
        result.kind === "unknown" ? "diagnostics" : "data",
        diagnostics
      );
      if (exitCode !== 0) process.exitCode = exitCode;
      return;
    }
    console.log(`skillset: ${result.path} (${result.kind})`);
    for (const entry of result.entries) {
      console.log(`  [${entry.target}] ${entry.sourcePath} -> ${entry.outputPath}`);
      if (entry.version !== undefined) console.log(`    version: ${entry.version}`);
      if (entry.targetState !== undefined) console.log(`    target state: ${entry.targetState}`);
      if (entry.validation !== undefined) console.log(`    validation: ${entry.validation}`);
      if (entry.feature !== undefined) console.log(`    feature: ${entry.feature}`);
      if (entry.origin !== undefined) console.log(`    origin: ${entry.origin}`);
      if (entry.sourceOrigin !== undefined) console.log(`    source origin: ${formatSourceOrigin(entry.sourceOrigin)}`);
      if (entry.sourcePointer !== undefined) console.log(`    source pointer: ${entry.sourcePointer}`);
      if (entry.dependencies !== undefined && entry.dependencies.length > 0) {
        console.log(`    dependencies: ${entry.dependencies.join(", ")}`);
      }
      if (entry.preprocessDependencies !== undefined && entry.preprocessDependencies.length > 0) {
        console.log(`    preprocess dependencies: ${entry.preprocessDependencies.join(", ")}`);
      }
      if (entry.transforms !== undefined && entry.transforms.length > 0) {
        console.log(
          `    transforms: ${entry.transforms.map((transform) => `${transform.intent} x${transform.count}`).join(", ")}`
        );
      }
      if (entry.sourceHash !== undefined) console.log(`    source hash: ${entry.sourceHash}`);
      if (entry.outputHash !== undefined) console.log(`    output hash: ${entry.outputHash}`);
    }
    for (const feature of result.features) {
      console.log(`  feature ${feature.id}: ${feature.title}`);
      console.log(`    claude: ${feature.targetSupport.claude.status}`);
      console.log(`    codex: ${feature.targetSupport.codex.status}`);
    }
    for (const outcome of result.renderResults) {
      printRenderResult(outcome);
    }
    for (const realization of result.toolsRealization) {
      if (realization.entries.length === 0) continue;
      const macro = realization.macro === undefined ? "" : ` (macro: ${realization.macro})`;
      console.log(`  tools realization [${realization.target}]${macro}:`);
      for (const entry of realization.entries) {
        const name = entry.kind === "native-overlay"
          ? `native ${entry.ruleDirection ?? ""} ${entry.rule ?? ""}`.trim()
          : entry.aspect ?? "unknown";
        const classified = entry.unclassified === true ? " (unclassified)" : "";
        const emits = entry.emits.length === 0 ? "" : ` -> ${entry.emits.join(", ")}`;
        console.log(`    ${name}${classified}: ${entry.decidingLayer} -> ${entry.tier} via ${entry.surface}${emits}`);
        for (const diagnostic of entry.diagnostics) {
          console.log(`      risk: ${diagnostic}`);
        }
      }
    }
    for (const note of result.notes) console.log(`  note: ${note}`);
    if (result.kind === "unknown") process.exitCode = 1;
    return;
  }

  if (command === "reconcile") {
    if (importPath === undefined) {
      throw new Error("skillset: expected a managed path to reconcile");
    }
    const report = await reconcileManagedPath(rootPath, importPath, {
      ...options,
      ...(reconcileChoice === undefined ? {} : { choice: reconcileChoice }),
      write: reconcileChoice !== undefined && yes,
    });
    if (jsonOutput) {
      printCliJsonData("reconcile", report, 0, report.applied ? "mutation" : "plan");
    } else {
      process.stdout.write(renderReconcileReport(report));
    }
    return;
  }

  if (command === "status") {
    // doctorSkillset carries source warnings in the structured report; the CLI
    // renders them below instead of relying on core operations to print.
    const report = await doctorSkillset(rootPath, options);
    if (jsonOutput) {
      const exitCode = report.ok ? 0 : 1;
      printCliJsonData("status", report, exitCode, "diagnostics");
      if (exitCode !== 0) process.exitCode = exitCode;
      return;
    }
    for (const issue of report.lintIssues) {
      console.log(`  lint ${issue.severity}: ${issue.path}: ${issue.code}: ${issue.message}`);
    }
    if (report.buildError !== undefined) {
      console.log(`  build error: ${report.buildError}`);
    }
    const { added, changed, removed } = report.drift;
    const { missing } = report.drift;
    const driftCount = added.length + changed.length + missing.length + removed.length;
    if (driftCount > 0) {
      console.log(
        `  drift: ${added.length} added, ${changed.length} changed, ${missing.length} missing, ${removed.length} removed (run skillset build --yes)`
      );
    }
    console.log(
      `  features: ${report.featureCapabilities.total} registry entries; status ${formatCountSummary(report.featureCapabilities.byFeatureStatus)}`
    );
    console.log(`  feature support: claude ${formatCountSummary(report.featureCapabilities.byTargetSupport.claude)}`);
    console.log(`  feature support: codex ${formatCountSummary(report.featureCapabilities.byTargetSupport.codex)}`);
    for (const outcome of report.notableRenderResults) {
      printRenderResult(outcome);
    }
    if (report.ok) {
      if (report.notableRenderResults.length === 0) {
        console.log("skillset: status found no problems");
      } else {
        console.log(
          `skillset: status found ${report.notableRenderResults.length} render result advisor${report.notableRenderResults.length === 1 ? "y" : "ies"}`
        );
      }
    } else {
      const problems: string[] = [];
      if (report.lintIssues.length > 0) problems.push(`${report.lintIssues.length} lint issue(s)`);
      if (driftCount > 0) problems.push("generated-output drift");
      if (report.buildError !== undefined) problems.push("a build error");
      if (report.notableRenderResults.length > 0) {
        problems.push(`${report.notableRenderResults.length} render result advisor${report.notableRenderResults.length === 1 ? "y" : "ies"}`);
      }
      console.log(`skillset: status found ${problems.join(" and ")}`);
      process.exitCode = 1;
    }
    return;
  }

  throw new Error(`skillset: unhandled command ${command}`);
}

export function readInitAdoptionSelection(
  answer: string,
  candidates: readonly { readonly kind: string; readonly path: string }[]
): readonly string[] {
  const value = answer.trim();
  if (value === "" || value === "none") return [];
  const available = new Set(candidates.map((candidate) => `${candidate.kind}:${candidate.path}`));
  const selected = value === "all" ? [...available] : value.split(",").map((item) => item.trim()).filter(Boolean);
  for (const id of selected) if (!available.has(id)) throw new Error(`skillset: unknown adoption candidate ${id}`);
  return [...new Set(selected)];
}

async function promptForInitAdoption(
  candidates: readonly { readonly kind: string; readonly path: string }[]
): Promise<{ readonly candidates: readonly string[]; readonly confirmed: boolean }> {
  console.log("skillset: detected adoptable sources");
  for (const candidate of candidates) console.log(`  ${adoptCandidateId(candidate)}`);
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await prompt.question("Adopt all, comma-separated candidate ids, or none [none]: ");
    const selected = readInitAdoptionSelection(answer, candidates);
    const confirmation = await prompt.question(`Write init plan (${selected.length === 0 ? "scaffold only" : `${selected.length} adoption candidate(s)`})? [y/N]: `);
    return { candidates: selected, confirmed: /^(?:y|yes)$/iu.test(confirmation.trim()) };
  } finally {
    prompt.close();
  }
}

export function reportCliError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
}

function printCliJsonData(
  command: string,
  data: unknown,
  exitCode = 0,
  kind = "data",
  diagnostics: readonly SkillsetCliDiagnostic[] = []
): void {
  process.stdout.write(renderCliDataResult({
    command,
    data: data as SchemaJsonRecord,
    diagnostics,
    exitCode,
    kind,
  }));
  if (exitCode !== 0) process.exitCode = exitCode;
}

function serializeChangeEntry<
  T extends { readonly sourceHashes: ReadonlyMap<string, readonly string[]> },
>(entry: T): Omit<T, "sourceHashes"> & {
  readonly sourceHashes: Readonly<Record<string, readonly string[]>>;
} {
  return {
    ...entry,
    sourceHashes: Object.fromEntries(
      [...entry.sourceHashes].sort(([left], [right]) => left.localeCompare(right))
    ),
  };
}

function serializeDiagnostics(
  diagnostics: readonly SkillsetDiagnostic[]
): readonly SkillsetCliDiagnostic[] {
  return diagnostics.map((diagnostic) => ({
    code: diagnostic.code,
    message: diagnostic.message,
    ...(diagnostic.path === undefined && diagnostic.outputPath === undefined
      ? {}
      : { path: diagnostic.path ?? diagnostic.outputPath }),
    severity: diagnostic.severity,
  }));
}

function ciReportDiagnostics(report: CiReport): readonly SkillsetCliDiagnostic[] {
  const diagnostics: SkillsetCliDiagnostic[] = [
    ...serializeDiagnostics(report.outputDiagnostics),
    ...report.lintIssues.map((issue) => ({
      code: issue.code,
      message: issue.message,
      ...(issue.path === undefined ? {} : { path: issue.path }),
      severity: issue.severity === "warn" ? "warning" as const : "error" as const,
    })),
    ...report.changeIssues.map((issue) => ({
      code: issue.code,
      message: issue.message,
      ...(issue.path === undefined ? {} : { path: issue.path }),
      severity: issue.severity,
    })),
    ...report.warnings.map((message) => ({ code: "source-warning", message, severity: "warning" as const })),
  ];
  for (const [code, message] of [
    ["check-build-error", report.buildError],
    ["check-change-error", report.changeError],
    ["check-changeset-error", report.changesetError],
  ] as const) {
    if (message !== undefined) diagnostics.push({ code, message, severity: "error" });
  }
  for (const message of report.changesetIssues ?? []) {
    diagnostics.push({ code: "check-changeset", message, severity: "error" });
  }
  for (const [state, paths] of Object.entries(report.drift)) {
    for (const path of paths) {
      diagnostics.push({
        code: "check-generated-drift",
        message: `generated output is ${state}`,
        path,
        severity: "error",
      });
    }
  }
  return diagnostics;
}

async function rememberKnownSkillsetWorkspace(rootPath: string, options: SkillsetOptions): Promise<void> {
  if (process.env.NODE_ENV === "test" && process.env.XDG_CONFIG_HOME === undefined) return;
  try {
    await recordKnownSkillsetWorkspace(rootPath, options.xdg);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`  warning: could not update known Skillsets index: ${message}`);
  }
}

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
  readonly devWatch: boolean;
  readonly devApply: boolean;
  readonly distributionName?: string;
  readonly distributionSubcommand?: DistributionSubcommand;
  readonly dryRun: boolean;
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

function printChangeEntry(verb: string, entry: ChangeEntryView): void {
  if (verb === "show") {
    console.log(`skillset: change ${entry.ref}`);
  } else {
    console.log(`skillset: ${verb} change ${entry.ref} ${entry.path}`);
  }
  console.log(`  status: ${entry.status}`);
  console.log(`  id: ${entry.id}`);
  if (entry.bump !== undefined) console.log(`  bump: ${entry.bump}`);
  const group = groupRef(entry.group);
  if (group !== undefined) console.log(`  group: ${group}`);
  if (entry.scopes.length > 0) console.log(`  scopes: ${sourceUnitDisplays(entry.scopes)}`);
  for (const [scope, hashes] of entry.sourceHashes) {
    for (const hash of hashes) console.log(`  source hash: ${sourceUnitDisplay(scope)} ${hash}`);
  }
  if (entry.reason.length > 0) {
    console.log("  reason:");
    for (const line of entry.reason.split("\n")) console.log(`    ${line}`);
  }
}

function printChangeList(entries: readonly ChangeEntryView[]): void {
  for (const entry of entries) {
    const group = groupRef(entry.group) ?? "-";
    const bump = entry.bump ?? "-";
    console.log(`${entry.ref} ${entry.status} ${bump} ${group} ${sourceUnitDisplays(entry.scopes)} ${entry.path}`);
  }
  console.log(`skillset: listed ${entries.length} pending change entr${entries.length === 1 ? "y" : "ies"}`);
}

function printChangeHistory(entries: readonly ChangeEntryView[]): void {
  for (const entry of entries) printChangeEntry("show", entry);
  console.log(`skillset: listed ${entries.length} history entr${entries.length === 1 ? "y" : "ies"}`);
}

function printChangeMigration(report: ChangeMigrationReport): void {
  for (const entry of report.entries) {
    const action = report.written ? "migrated" : "would migrate";
    console.log(`${action}: ${entry.fromPath} -> ${entry.toPath}`);
  }
  if (report.written && report.entries.length > 0) console.log(`  ledger: ${report.ledgerPath}`);
  console.log(
    `skillset: ${report.written ? "migrated" : "previewed"} ${report.entries.length} frontmatter pending entr${report.entries.length === 1 ? "y" : "ies"}`
  );
}

function printChangeCheck(report: ChangeCheckReport): void {
  for (const issue of report.issues) {
    const path = issue.path === undefined ? "" : `${issue.path}: `;
    console.log(`  ${issue.severity}: ${path}${issue.code}: ${issue.message}`);
  }
  for (const group of report.stackedEvidence) {
    console.log(
      `  stacked evidence: ${sourceUnitDisplay(group.scope)} ${group.sourceHash} shared by ${group.paths.length} pending entries: ${group.paths.join(", ")}`
    );
  }
  const errors = report.issues.filter((issue) => issue.severity === "error").length;
  const warnings = report.issues.length - errors;
  if (errors === 0) {
    console.log(`skillset: change check passed (${report.entries.length} pending entr${report.entries.length === 1 ? "y" : "ies"}, ${warnings} warning${warnings === 1 ? "" : "s"})`);
    return;
  }
  console.log(`skillset: change check found ${errors} error${errors === 1 ? "" : "s"} and ${warnings} warning${warnings === 1 ? "" : "s"}`);
  process.exitCode = 1;
}

function printChangeStatus(report: ChangeStatusReport): void {
  const baseline =
    report.baseline.kind === "git-ref"
      ? `git ref ${report.baseline.ref}${report.baseline.resolvedRef === undefined ? "" : ` (${report.baseline.resolvedRef.slice(0, 12)})`}`
      : `${report.baseline.label} (${report.baseline.hashSchema})`;
  console.log(`skillset: source hash schema ${report.hashSchema}`);
  console.log(`skillset: baseline ${baseline}`);

  if (report.sourceChanges.length === 0) {
    console.log("skillset: no source changes needing entries");
  } else {
    for (const change of report.sourceChanges) {
      const marker = change.status === "added" ? "+" : change.status === "removed" ? "-" : "~";
      console.log(`  ${marker} ${sourceUnitDisplay(change.id)} ${change.sourcePath}`);
    }
    console.log(`skillset: ${report.sourceChanges.length} source change(s) needing entries`);
  }

  const drift = report.generatedDrift;
  const driftCount = drift.added.length + drift.changed.length + drift.missing.length + drift.removed.length;
  if (driftCount === 0) {
    console.log("skillset: no generated-output drift");
    return;
  }
  for (const path of drift.added) console.log(`  generated + ${path}`);
  for (const path of drift.changed) console.log(`  generated ~ ${path}`);
  for (const path of drift.missing) console.log(`  generated ! ${path}`);
  for (const path of drift.removed) console.log(`  generated - ${path}`);
  console.log(
    `skillset: generated-output drift ${drift.added.length} added, ${drift.changed.length} changed, ${drift.missing.length} missing, ${drift.removed.length} removed`
  );
  printGeneratedChangelogDriftHint(drift);
}

function printCiReport(report: CiReport): void {
  printDiagnostics(report.outputDiagnostics);
  for (const issue of report.lintIssues) {
    console.log(`  lint ${issue.severity}: ${issue.path}: ${issue.code}: ${issue.message}`);
  }
  if (report.changeError !== undefined) {
    console.log(`  change check error: ${report.changeError}`);
  }
  for (const issue of report.changeIssues) {
    const path = issue.path === undefined ? "" : `${issue.path}: `;
    console.log(`  change ${issue.severity}: ${path}${issue.code}: ${issue.message}`);
  }
  if (report.changesetError !== undefined) {
    console.log(`  changeset error: ${report.changesetError}`);
  }
  for (const issue of report.changesetIssues ?? []) {
    console.log(`  changeset error: ${issue}`);
  }
  for (const path of report.fixedPaths) console.log(`  fixed ${path}`);
  for (const path of report.outputEditedPaths) console.log(`  target-side generated edit ${path}`);
  for (const path of report.providerUpdatePaths) console.log(`  provider-format update ${path} (run skillset update)`);
  printGeneratedChangelogPathHint(report.fixedPaths);
  const drift = report.drift;
  for (const path of drift.added) console.log(`  generated + ${path}`);
  for (const path of drift.changed) console.log(`  generated ~ ${path}`);
  for (const path of drift.missing) console.log(`  generated ! ${path}`);
  for (const path of drift.removed) console.log(`  generated - ${path}`);
  printGeneratedChangelogDriftHint(drift);
  for (const suggestion of report.sourceSuggestions ?? []) {
    console.log(`  reconcile output ${suggestion.status}: ${suggestion.generatedPath}`);
    if (suggestion.sourcePath !== undefined) console.log(`    source: ${suggestion.sourcePath}`);
    console.log(`    ${suggestion.message}`);
  }
  if (report.buildError !== undefined) {
    console.log(`  build error: ${report.buildError}`);
  }

  if (report.ok) {
    console.log(
      report.fixedPaths.length === 0
        ? "skillset: check passed"
        : `skillset: check passed after rebuilding ${report.fixedPaths.length} generated file${report.fixedPaths.length === 1 ? "" : "s"}`
    );
    return;
  }
  const changeErrors = report.changeIssues.filter((issue) => issue.severity === "error").length;
  const lintErrors = report.lintIssues.filter((issue) => issue.severity === "error").length;
  const problems: string[] = [];
  if (lintErrors > 0) problems.push(`${lintErrors} lint issue(s)`);
  if (report.changeError !== undefined) problems.push("a change check error");
  if (changeErrors > 0) problems.push(`${changeErrors} change entry error(s)`);
  if (report.changesetError !== undefined) problems.push("a Changesets check error");
  if ((report.changesetIssues ?? []).length > 0) problems.push(`${report.changesetIssues?.length} Changesets issue(s)`);
  if (report.outputEditedPaths.length > 0) problems.push(`${report.outputEditedPaths.length} target-side generated edit(s) to reconcile`);
  if (report.providerUpdatePaths.length > 0) problems.push(`${report.providerUpdatePaths.length} provider-format update(s)`);
  const outputErrors = report.outputDiagnostics.filter((diagnostic) => diagnostic.severity === "error").length;
  if (outputErrors > 0) problems.push(`${outputErrors} generated-output diagnostic(s)`);
  if (hasDrift(report.drift)) problems.push("generated-output drift (run skillset check --write, or check --ci --fix in CI)");
  if (report.buildError !== undefined) problems.push("a build error");
  console.log(`skillset: check found ${problems.join(" and ")}`);
}

async function resolveCliReportPath(
  rootPath: string,
  reportPath: string,
  options: SkillsetOptions
): Promise<string> {
  if (!isRepoOperationalCachePath(reportPath)) return resolve(reportPath);
  const graph = await loadBuildGraph(rootPath, options);
  return resolveOperationalPath(
    createOperationalPathContext(rootPath, {
      ...(graph.root.workspace.cacheKey === undefined ? {} : { workspaceCacheKey: graph.root.workspace.cacheKey }),
    }),
    reportPath
  );
}

function printReleasePlan(report: ReleasePlanReport): void {
  if (report.entries.length === 0) {
    console.log("skillset: no pending changes to release");
    return;
  }
  for (const entry of report.entries) {
    const marker = entry.ignored ? "ignored" : "pending";
    console.log(`${entry.ref} ${marker} ${entry.bump} ${sourceUnitDisplays(entry.scopes)} ${entry.path}`);
  }
  if (report.scopes.length === 0) {
    console.log(`skillset: release plan has ${report.entries.length} pending entr${report.entries.length === 1 ? "y" : "ies"} and no release scopes`);
    return;
  }
  if (report.releaseId !== undefined) console.log(`skillset: release ${report.releaseId}`);
  for (const scope of report.scopes) {
    const sourceHash = scope.sourceHash === undefined ? "" : ` ${scope.sourceHash}`;
    console.log(`  ${sourceUnitDisplay(scope.scope)}: ${scope.currentVersion} -> ${scope.nextVersion} (${scope.bump}) entries ${scope.entries.join(",")}${sourceHash}`);
  }
  console.log(`skillset: release plan has ${report.entries.length} pending entr${report.entries.length === 1 ? "y" : "ies"} and ${report.scopes.length} release scope${report.scopes.length === 1 ? "" : "s"}`);
}

function printVersionAudit(report: VersionAuditReport): void {
  for (const locus of report.loci) {
    const target = locus.target === undefined ? "" : ` [${locus.target}]`;
    const actual = locus.actualVersion ?? "missing";
    const expected = locus.expectedVersion ?? "n/a";
    console.log(`${locus.status}:${target} ${locus.scope} ${locus.path} ${locus.field} actual ${actual} expected ${expected} authority ${locus.authority}`);
  }
  if (report.issues.length === 0) {
    console.log(`skillset: version audit passed (${report.loci.length} loci)`);
  } else {
    console.log(`skillset: version audit found ${report.issues.length} issue${report.issues.length === 1 ? "" : "s"} across ${report.loci.length} loci`);
  }
}

function printReleaseApply(
  plan: ReleasePlanReport,
  files: readonly string[],
  renderedFiles: number
): void {
  if (plan.entries.length === 0) {
    console.log("skillset: no pending changes to release");
    return;
  }
  console.log(`skillset: applied release ${plan.releaseId ?? "audit-only"} (${renderedFiles} generated files refreshed)`);
  for (const file of files) console.log(`  ${file}`);
}

function printReleaseAmend(report: ReleaseAmendReport): void {
  console.log(`skillset: amended release ${report.release.ref} ${report.release.path}`);
  console.log(`  id: ${report.release.id}`);
  console.log(`  amendment: ${report.amendmentPath}`);
  if (report.release.appliedAt !== undefined) console.log(`  applied: ${report.release.appliedAt}`);
  if (report.release.entries.length > 0) console.log(`  entries: ${report.release.entries.join(",")}`);
  for (const scope of report.release.scopes) {
    const version = scope.previousVersion === undefined || scope.nextVersion === undefined
      ? ""
      : ` ${scope.previousVersion} -> ${scope.nextVersion}`;
    const bump = scope.bump === undefined ? "" : ` (${scope.bump})`;
    console.log(`  scope: ${sourceUnitDisplay(scope.scope)}${version}${bump}`);
  }
  if (report.release.notes !== undefined) {
    console.log("  notes:");
    for (const line of report.release.notes.split("\n")) console.log(`    ${line}`);
  }
}

function printDistributionPlan(report: DistributionPlanReport): void {
  if (report.plans.length === 0) {
    console.log("skillset: no distributions configured");
    return;
  }
  for (const plan of report.plans) {
    console.log(`skillset: distribution ${plan.name} planned ${plan.files.length} file${plan.files.length === 1 ? "" : "s"} (${formatDistributionNoOp(plan.noOp)})`);
    console.log(`  from: ${plan.from.target} ${plan.from.selector} (${plan.from.outputRoot})`);
    if (plan.from.runtime !== undefined) console.log(`  runtime: ${plan.from.runtime}`);
    console.log(`  to: ${plan.destination.kind} ${plan.destination.root}`);
    if (plan.destination.branch !== undefined) console.log(`  branch: ${plan.destination.branch}`);
    if (plan.destination.subdirectory !== undefined) console.log(`  subdirectory: ${plan.destination.subdirectory}`);
    console.log(`  digest: ${plan.sourceDigest}`);
    for (const file of plan.files) {
      console.log(`  ${file.status}: ${file.sourcePath} -> ${file.destinationPath} (${file.bytes} bytes, ${file.hash.slice(0, 12)})`);
      const ownership = formatOwnershipSummary(file.ownership);
      if (ownership !== undefined) console.log(`    ownership: ${ownership}`);
    }
  }
}

function printMarketplaceCheck(report: MarketplaceCheckReport): void {
  if (report.marketplaces.length === 0) {
    console.log("skillset: no marketplaces configured");
    return;
  }
  console.log(
    `skillset: marketplace check ${report.ok ? "passed" : "failed"} ` +
      `(${report.entries.length} target entr${report.entries.length === 1 ? "y" : "ies"})`
  );
  for (const entry of report.entries) {
    const source = entry.repo ?? entry.source.repository ?? entry.source.kind;
    console.log(
      `  ${entry.readiness}: ${entry.catalog}/${entry.entryId} ${entry.requestedTarget} ` +
        `plugin ${entry.plugin} source ${source}`
    );
    console.log(`    reason: ${entry.reason}`);
    if (entry.lock.state !== "locked") {
      console.log(`    lock: ${entry.lock.state} ${entry.lock.policy} (${entry.lock.reason})`);
    }
    if (entry.generatedPath !== undefined) console.log(`    generated: ${entry.generatedPath}`);
    if (entry.generatedPaths.length > 1) {
      console.log(`    generated bundle: ${entry.generatedPaths.join(", ")}`);
    }
  }
}

function printMarketplaceUpdate(report: MarketplaceUpdateReport): void {
  if (report.check.marketplaces.length === 0) {
    console.log("skillset: no marketplaces configured");
    return;
  }
  console.log(
    `skillset: marketplace update ${report.ok ? "passed" : "failed"} ` +
      `(${report.check.entries.length} target entr${report.check.entries.length === 1 ? "y" : "ies"})`
  );
  for (const file of report.files) {
    const state = report.write ? (report.writtenPaths.includes(file.path) ? "wrote" : "unchanged") : "would write";
    console.log(`  ${state}: ${file.path} (${file.catalog} ${file.target})`);
  }
  if (report.ok) {
    const state = report.write ? "wrote" : "would write";
    console.log(`  ${state}: ${report.lockPath}`);
    return;
  }
  printMarketplaceCheck(report.check);
}

function formatDistributionNoOp(noOp: boolean | "unknown"): string {
  if (noOp === "unknown") return "destination state unknown";
  return noOp ? "no-op" : "would change";
}

function formatOwnershipSummary(
  ownership: DistributionPlanReport["plans"][number]["files"][number]["ownership"]
): string | undefined {
  if (ownership.fields.length === 0) return undefined;
  const counts = new Map<string, number>();
  for (const field of ownership.fields) {
    counts.set(field.owner, (counts.get(field.owner) ?? 0) + 1);
  }
  const summary = [...counts.entries()]
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([owner, count]) => `${owner}:${count}`)
    .join(" ");
  return `file:${ownership.file.owner} fields:${summary}`;
}

function printImportReport(result: ImportReport): void {
  console.log(`skillset: imported ${result.kind} ${result.name} (${result.files} files)`);
  console.log(`  target: ${result.targetPath}`);
  if (result.inferredSourceFields.length > 0) {
    console.log(`  source fields: ${result.inferredSourceFields.join(", ")}`);
  }
  if (result.preservedTargetNativeFields.length > 0) {
    console.log(`  preserved target-native: ${result.preservedTargetNativeFields.join(", ")}`);
  }
  if (result.unsupportedFields.length > 0) {
    console.log(`  unsupported (kept verbatim): ${result.unsupportedFields.join(", ")}`);
  }
  for (const baseline of result.baselines) {
    if (baseline.status === "create") {
      console.log(`  baseline: ${sourceUnitDisplay(baseline.scope)} ${baseline.version}`);
    }
  }
  for (const warning of result.warnings) {
    console.warn(`  warning: ${warning}`);
  }
  console.log(`  next: ${result.nextChecks.join(", ")}`);
}

function printAdoptReport(report: AdoptReport, reason: string): void {
  console.log(`skillset: adopt ${report.rootPath} (${reason})`);
  if (report.acquisition.kind === "git") {
    console.log(`  source: git ${report.acquisition.repo} @ ${report.acquisition.ref}`);
  }
  if (report.alreadyAdopted) {
    console.log("  note: repo already has a Skillset workspace marker; adopting against existing source");
  }
  for (const file of report.setupFiles) {
    console.log(`  ${file.status === "create" ? "+" : "="} ${file.path}`);
  }
  for (const candidate of report.candidates) {
    const sources = candidate.plugin === undefined ? "" : ` (${candidate.plugin.paths.join(", ")})`;
    console.log(`  ? import candidate ${candidate.kind} ${candidate.path}${sources} (id: ${adoptCandidateId(candidate)})`);
  }
  for (const diagnostic of report.surveyDiagnostics) {
    const marker = diagnostic.severity === "error" ? "FAIL" : "warning";
    console.log(`  ${marker} ${diagnostic.code} ${diagnostic.paths.join(", ")}: ${diagnostic.message}`);
    console.log(`    resolution: ${diagnostic.recommendation}`);
  }
  for (const skip of report.surveySkips) {
    console.log(`  ! skipped ${skip.surface} ${skip.path}: ${skip.reason}`);
  }
  if (!report.write) return;

  for (const result of report.imports) {
    const marker = result.ok ? "ok" : "FAIL";
    console.log(`  ${marker} import ${result.candidate.kind}:${result.candidate.path}${result.ok ? ` -> ${result.detail}` : `: ${result.detail}`}`);
  }
  const lintErrors = report.lintIssues.filter((issue) => issue.severity === "error").length;
  const lintWarnings = report.lintIssues.length - lintErrors;
  console.log(`  ${lintErrors === 0 ? "ok" : "FAIL"} lint: ${lintErrors} error(s), ${lintWarnings} warning(s)`);
  console.log(
    report.buildError === undefined
      ? `  ok build: wrote ${report.builtFiles} generated files under logical .skillset/cache/latest/ (XDG-backed)`
      : `  FAIL build: ${report.buildError.split("\n")[0]}`
  );
  if (report.cutover.length > 0) {
    console.log(`  cutover: ${report.cutover.join(", ")} (see report)`);
  }
  console.log(`  report: ${ADOPT_REPORT_DIR}/report.md`);
  console.log(`skillset: adopt ${report.ok ? "passed" : "found problems"}`);
}

function formatSourceOrigin(origin: SourceOrigin): string {
  const remote = origin.repo === undefined || origin.ref === undefined
    ? ""
    : `${origin.repo} @ ${origin.ref} `;
  return `${remote}path ${origin.path}`;
}

function printSetupReport(result: SetupReport, reason: string): void {
  for (const file of result.files) {
    const marker = file.status === "create" ? "+" : "=";
    console.log(`  ${marker} ${file.path}`);
  }
  if (result.git !== undefined) {
    const marker = result.git.status === "create" ? "+" : "=";
    console.log(`  ${marker} ${result.git.path}`);
  }
  for (const baseline of result.baselines) {
    const marker = baseline.status === "create" ? "+" : "=";
    console.log(`  ${marker} baseline ${sourceUnitDisplay(baseline.scope)} ${baseline.version}`);
  }
  for (const candidate of result.importCandidates) {
    console.log(`  ? import candidate ${candidate.kind} ${candidate.path} (id: ${adoptCandidateId(candidate)})`);
  }
  for (const diagnostic of result.surveyDiagnostics) {
    const marker = diagnostic.severity === "error" ? "FAIL" : "warning";
    console.log(`  ${marker} ${diagnostic.code} ${diagnostic.paths.join(", ")}: ${diagnostic.message}`);
    console.log(`    resolution: ${diagnostic.recommendation}`);
  }
  for (const skip of result.surveySkips) {
    console.log(`  ! skipped ${skip.surface} ${skip.path}: ${skip.reason}`);
  }
  const created = result.files.filter((file) => file.status === "create").length;
  const existing = result.files.length - created;
  const gitCreated = result.git?.status === "create" ? 1 : 0;
  const gitExisting = result.git?.status === "exists" ? 1 : 0;
  const baselines = result.baselines.filter((baseline) => baseline.status === "create").length;
  const candidates = result.importCandidates.length;
  const details = [
    `${created + gitCreated} to create`,
    `${existing + gitExisting} already present`,
    ...(baselines === 0 ? [] : [`${baselines} baseline${baselines === 1 ? "" : "s"} to adopt`]),
    ...(candidates === 0 ? [] : [`${candidates} import candidate${candidates === 1 ? "" : "s"}`]),
  ];
  console.log(`skillset: ${result.kind} ${details.join(", ")} (${reason})`);
  console.log(`  root: ${result.rootPath}`);
}

function printNewSourceReport(result: NewSourceReport, reason: string): void {
  for (const file of result.files) console.log(`  + ${file.path}`);
  const action = result.write ? "created" : "planned";
  console.log(`skillset: ${action} ${result.kind} ${result.id} (${reason})`);
  console.log(`  source: ${result.sourceRoot}`);
  console.log(`  name: ${result.displayName}`);
  if (result.write) {
    console.log("  next: skillset build --yes");
    console.log("  next: skillset check");
  }
}

function printRestoreReport(report: OutputBackupRestoreReport): void {
  const mode = report.write ? "restored" : "restore preview";
  console.log(`skillset: ${mode} ${report.restoredPaths.length} file${report.restoredPaths.length === 1 ? "" : "s"} from backup ${report.runId}`);
  console.log(`  manifest: ${report.manifestPath}`);
  for (const path of report.restoredPaths) console.log(`  restore: ${path}`);
}

function printSkillsetTest(report: SkillsetTestReport): void {
  for (const check of report.checks) {
    const marker = check.ok ? "pass" : "fail";
    const path = check.path === undefined ? "" : ` ${check.path}`;
    const detail = check.detail === undefined ? "" : ` (${check.detail})`;
    console.log(`  ${marker}: ${check.kind}${path}${detail}`);
  }
  console.log(`skillset: test ${report.name} ${report.ok ? "passed" : "failed"}`);
  console.log(`  run: ${report.runPath}`);
  console.log(`  latest: ${report.latestPath}`);
  console.log(`  report: ${report.reportPath}`);
  console.log(`  selection: ${formatTestSelection(report.selection)}`);
  console.log(`  generated files: ${report.generatedFiles}`);
  console.log(`  activation probes: ${report.activationProbes}`);
  if (report.activationPath !== undefined) console.log(`  activation: ${report.activationPath}`);
  console.log(`  runtime tests: ${report.runtimeTests.length}`);
  for (const runtimeTest of report.runtimeTests) {
    const failure = runtimeTest.failureClass === undefined ? "" : ` (${runtimeTest.failureClass})`;
    const detail = runtimeTest.detail === undefined ? "" : ` - ${runtimeTest.detail}`;
    console.log(`  ${runtimeTest.ok ? "pass" : "fail"}: runtime ${runtimeTest.name} [${runtimeTest.target}]${failure}${detail}`);
    if (runtimeTest.outputPath !== undefined) console.log(`    output: ${runtimeTest.outputPath}`);
  }
}

function formatTestSelection(selection: SkillsetTestReport["selection"]): string {
  const parts = [
    selection.agents.length === 0 ? undefined : `agents ${selection.agents.join(", ")}`,
    selection.plugins.length === 0 ? undefined : `plugins ${selection.plugins.join(", ")}`,
    selection.primarySkills.length === 0 ? undefined : `primary skills ${selection.primarySkills.join(", ")}`,
    selection.pluginSkills.length === 0 ? undefined : `plugin skills ${selection.pluginSkills.join(", ")}`,
  ].filter((part): part is string => part !== undefined);
  return parts.length === 0 ? "none" : parts.join("; ");
}

function printFeatureCapability(feature: FeatureCapability): void {
  console.log(`feature ${feature.id}: ${feature.title}`);
  console.log(`  status: ${feature.status}`);
  console.log(`  claude: ${formatFeatureSupport(feature.targetSupport.claude)}`);
  console.log(`  codex: ${formatFeatureSupport(feature.targetSupport.codex)}`);
  if (feature.docs.length > 0) console.log(`  docs: ${feature.docs.join(", ")}`);
}

function formatFeatureSupport(support: FeatureCapability["targetSupport"]["claude"]): string {
  const reason = support.reason === undefined ? "" : ` (${support.reason})`;
  const note = support.note === undefined ? "" : ` note: ${support.note}`;
  return `${support.status}${reason}${note}`;
}

function formatCountSummary(counts: Readonly<Record<string, number>>): string {
  return Object.entries(counts)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, count]) => `${key} ${count}`)
    .join(", ");
}

function printRenderResult(outcome: {
  readonly destination?: string;
  readonly diagnostics?: readonly { readonly code: string; readonly path?: string }[];
  readonly featureId: string;
  readonly outputs?: readonly { readonly path: string }[];
  readonly policy?: string;
  readonly reason?: string;
  readonly sourceUnit: string;
  readonly status: string;
  readonly target?: string;
}): void {
  const target = outcome.target ?? "workspace";
  const destination = outcome.destination === undefined ? "" : ` -> ${outcome.destination}`;
  const policy = outcome.policy === undefined ? "" : ` policy: ${outcome.policy}`;
  const reason = outcome.reason === undefined ? "" : ` reason: ${outcome.reason}`;
  console.log(`  render [${target}] ${outcome.sourceUnit}: ${outcome.featureId}${destination} ${outcome.status}${policy}${reason}`);
  if (outcome.outputs !== undefined && outcome.outputs.length > 0) {
    console.log(`    outputs: ${outcome.outputs.map((output) => output.path).join(", ")}`);
  }
  if (outcome.diagnostics !== undefined && outcome.diagnostics.length > 0) {
    console.log(
      `    diagnostics: ${outcome.diagnostics.map((diagnostic) => `${diagnostic.code}${diagnostic.path === undefined ? "" : ` ${diagnostic.path}`}`).join(", ")}`
    );
  }
}

function parseArgs(args: readonly string[]): ParsedArgs {
  const command = args[0];
  if (!isCliCommand(command)) {
    throw new Error(
        `skillset: expected command ${renderExpectedCliCommands()}\n` +
        USAGE
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
  let devApply = false;
  let devWatch = false;
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
  let dryRun = false;
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
      throw new Error("skillset: expected change subcommand add, amend, check, history, list, reason, show, or status");
    }
    changeSubcommand = subcommand;
    index += 1;
    const rawRef = args[index];
    if ((subcommand === "amend" || subcommand === "check" || subcommand === "history" || subcommand === "reason" || subcommand === "show") && rawRef !== undefined && !rawRef.startsWith("--")) {
      changeRef = rawRef;
      index += 1;
    }
  }

  if (command === "release") {
    const subcommand = args[index];
    if (!isReleaseSubcommand(subcommand)) {
      throw new Error("skillset: expected release subcommand amend, apply, audit, or plan");
    }
    releaseSubcommand = subcommand;
    index += 1;
    const rawRef = args[index];
    if (subcommand === "amend" && rawRef !== undefined && !rawRef.startsWith("--")) {
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
      throw new Error("skillset: expected marketplace subcommand check or update");
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
    if (subcommand !== "context" && subcommand !== "print" && subcommand !== "run") {
      throw new Error("skillset: expected hooks subcommand context, print, or run");
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
    if ((trySubcommand === "status" || trySubcommand === "tail" || trySubcommand === "worker") && rawRunId !== undefined && !rawRunId.startsWith("--")) {
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
    } else
    if (rawSubject !== undefined && !rawSubject.startsWith("--")) {
      lookupSubject = readLookupSubject(rawSubject);
      index += 1;
      while (args[index] !== undefined && !args[index]?.startsWith("--")) {
        const aspect = args[index];
        if (aspect !== undefined) lookupAspects = [...lookupAspects, aspect];
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
    if (arg === undefined) break;
    const equalsIndex = arg.indexOf("=");
    const flag = equalsIndex === -1 ? arg : arg.slice(0, equalsIndex);
    const inlineValue = equalsIndex === -1 ? undefined : arg.slice(equalsIndex + 1);
    if (
      flag !== "--root" &&
      flag !== "--source" &&
      flag !== "--dist" &&
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
      flag !== "--dry-run" &&
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
      flag !== "--apply" &&
      flag !== "--runner" &&
      flag !== "--target" &&
      flag !== "--agent-runtime" &&
      flag !== "--pre-commit" &&
      flag !== "--pre-push" &&
      flag !== "--write" &&
      flag !== "--watch" &&
      flag !== "--frontmatter" &&
      flag !== "--fields" &&
      flag !== "--field" &&
      flag !== "--values" &&
      flag !== "--events" &&
      flag !== "--compat" &&
      flag !== "--examples" &&
      flag !== "--schema" &&
      flag !== "--claude" &&
      flag !== "--codex" &&
      flag !== "--cursor" &&
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
      while (args[index + 1] !== undefined && !args[index + 1]?.startsWith("--")) {
        const value = args[index + 1];
        if (value === undefined) break;
        lookupTargets = addLookupTargets(lookupTargets, value);
        index += 1;
      }
      continue;
    }

    if (
      flag === "--yes" ||
      flag === "--dry-run" ||
      flag === "--updated" ||
      flag === "--all" ||
      flag === "--isolated" ||
      flag === "--append" ||
      flag === "--staged" ||
      flag === "--fix" ||
      flag === "--ci" ||
      flag === "--json" ||
      flag === "--jsonl" ||
      flag === "--apply" ||
      flag === "--agent-runtime" ||
      flag === "--pre-commit" ||
      flag === "--pre-push" ||
      flag === "--write" ||
      flag === "--watch" ||
      flag === "--frontmatter" ||
      flag === "--fields" ||
      flag === "--values" ||
      flag === "--events" ||
      flag === "--examples" ||
      flag === "--schema" ||
      flag === "--claude" ||
      flag === "--codex" ||
      flag === "--cursor" ||
      flag === "--background"
    ) {
      if (inlineValue !== undefined) throw new Error(`skillset: ${flag} does not take a value`);
      if (flag === "--yes") yes = true;
      if (flag === "--dry-run") dryRun = true;
      if (flag === "--updated") buildMode = setBuildMode(buildMode, "updated");
      if (flag === "--all") buildMode = setBuildMode(buildMode, "all");
      if (flag === "--isolated") isolated = true;
      if (flag === "--append") changeAppend = true;
      if (flag === "--staged") changeStaged = true;
      if (flag === "--fix") ciFix = true;
      if (flag === "--ci") ciMode = true;
      if (flag === "--json") jsonOutput = true;
      if (flag === "--jsonl") jsonlOutput = true;
      if (flag === "--apply") devApply = true;
      if (flag === "--agent-runtime") hookAgentRuntime = true;
      if (flag === "--pre-commit") hookPreCommit = true;
      if (flag === "--pre-push") hookPrePush = true;
      if (flag === "--write") {
        if (command !== "check") throw new Error("skillset: --write is only supported with check");
        checkWrite = true;
      }
      if (flag === "--watch") devWatch = true;
      if (flag === "--frontmatter") lookupViews = addLookupView(lookupViews, "frontmatter");
      if (flag === "--fields") lookupViews = addLookupView(lookupViews, "fields");
      if (flag === "--values") lookupViews = addLookupView(lookupViews, "values");
      if (flag === "--events") lookupViews = addLookupView(lookupViews, "events");
      if (flag === "--examples") lookupViews = addLookupView(lookupViews, "examples");
      if (flag === "--schema") lookupViews = addLookupView(lookupViews, "schema");
      if (flag === "--claude") lookupTargets = addLookupTarget(lookupTargets, "claude");
      if (flag === "--codex") lookupTargets = addLookupTarget(lookupTargets, "codex");
      if (flag === "--cursor") lookupTargets = addLookupTarget(lookupTargets, "cursor");
      if (flag === "--background") tryBackground = true;
      continue;
    }

    const value = inlineValue ?? args[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`skillset: expected value after ${flag}`);
    }
    if (inlineValue === undefined) index += 1;

    if (flag === "--root") {
      rootPath = value;
      rootExplicit = true;
    }
    if (flag === "--source") sourceDir = value;
    if (flag === "--dist") distDir = value;
    if (flag === "--ref") {
      if (command === "release" && releaseSubcommand === "amend") releaseRef = value;
      else changeRef = value;
    }
    if (flag === "--since") changeSince = value;
    if (flag === "--scope") {
      if (command === "change" && changeSubcommand === "add") {
        changeScopes = [...(changeScopes ?? []), ...readChangeScopes(value)];
      } else if (command === "change" && (changeSubcommand === "status" || changeSubcommand === "check")) {
        throw new Error(`skillset: change ${changeSubcommand} is a whole-source command; --scope is not supported`);
      } else if (command === "change") {
        throw new Error("skillset: --scope is only supported with change add source-unit entries");
      } else if (command === "new") {
        newScope = readNewSourceScope(value);
      } else {
        scopes = readBuildScopes(value);
      }
    }
    if (flag === "--group") changeGroup = value;
    if (flag === "--reason") {
      const reason = value === "-" ? { kind: "stdin" } as const : { kind: "inline", value } as const;
      if (command === "release" && releaseSubcommand === "amend") releaseReason = setChangeReason(releaseReason, reason);
      else changeReason = setChangeReason(changeReason, reason);
    }
    if (flag === "--reason-file") {
      const reason = { kind: "file", path: value } as const;
      if (command === "release" && releaseSubcommand === "amend") releaseReason = setChangeReason(releaseReason, reason);
      else changeReason = setChangeReason(changeReason, reason);
    }
    if (flag === "--bump") changeBump = readChangeBump(value);
    if (flag === "--report") ciReportPath = value;
    if (flag === "--only") {
      if (value !== "outputs") throw new Error("skillset: expected --only outputs");
      checkOnly = value;
    }
    if (flag === "--use") {
      if (value !== "source" && value !== "output") throw new Error("skillset: --use expects source or output");
      reconcileChoice = value;
    }
    if (flag === "--field") lookupField = setLookupField(lookupField, value);
    if (flag === "--runner") hookRunner = readHookRunner(value);
    if (flag === "--event") hookContextEvent = value;
    if (flag === "--format") hookContextFormat = readHookRuntimeContextFormat(value);
    if (flag === "--context-fields") hookContextFields = readHookRuntimeContextFields(value);
    if (flag === "--target") {
      if (command === "test") tryTarget = readTargetName(value);
      else hookTarget = readHookTarget(value);
    }
    if (flag === "--prompt") tryPrompt = value;
    if (flag === "--prompt-file") tryPromptFile = value;
    if (flag === "--plugin") tryPlugins = [...tryPlugins, value];
    if (flag === "--claude-setting-sources") {
      tryClaudeSettingSources = readClaudeSettingSources(value, "--claude-setting-sources");
    }
    if (flag === "--timeout-ms") tryTimeoutMs = readPositiveInteger(value, "--timeout-ms");
    if (flag === "--lines") tryLines = readPositiveInteger(value, "--lines");
    if (flag === "--targets") setupTargets = readSetupTargets(value);
    if (flag === "--include") setupIncludes = mergeSetupIncludes(setupIncludes, value);
    if (flag === "--id") newId = value;
    if (flag === "--in") newContainer = value;
    if (flag === "--name") {
      if (command === "new") newName = value;
      else if (command === "test") tryName = value;
      else importName = value;
    }
    if (flag === "--preset") newPresets = [...(newPresets ?? []), value];
    if (flag === "--kind") {
      if (!isImportKind(value)) {
        throw new Error("skillset: expected --kind skill, skills, plugin, or plugins");
      }
      if (importKind !== undefined && importKind !== value) {
        throw new Error(`skillset: conflicting import kinds ${importKind} and ${value}`);
      }
      importKind = value;
    }
    if (flag === "--from") {
      if (command === "init") {
        initFrom = value;
      } else if (!isImportProvider(value)) {
        throw new Error("skillset: expected --from claude, codex, cursor, agents, or skillset");
      } else {
        importProvider = value;
      }
    }
    if (flag === "--adopt") initAdopt = [...(initAdopt ?? []), value];
  }

  validateChangeFlags(command, changeSubcommand, {
    append: changeAppend,
    ...(changeBump === undefined ? {} : { bump: changeBump }),
    ...(changeGroup === undefined ? {} : { group: changeGroup }),
    ...(changeReason === undefined ? {} : { reason: changeReason }),
    ...(changeRef === undefined ? {} : { ref: changeRef }),
    staged: changeStaged,
    ...(changeScopes === undefined ? {} : { scopes: changeScopes }),
    dryRun,
    yes,
  });

  validateHookFlags(command, {
    agentRuntime: hookAgentRuntime,
    ...(buildMode === undefined ? {} : { buildMode }),
    ...(changeSince === undefined ? {} : { changeSince }),
    ...(distDir === undefined ? {} : { distDir }),
    dryRun,
    ...(hookContextEvent === undefined ? {} : { contextEvent: hookContextEvent }),
    ...(hookContextFields === undefined ? {} : { contextFields: hookContextFields }),
    ...(hookContextFormat === undefined ? {} : { contextFormat: hookContextFormat }),
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
  if (command !== "init" && (initAdopt !== undefined || initFrom !== undefined)) {
    throw new Error("skillset: --adopt and init acquisition --from are only supported with init");
  }

  validateCiFlags(command, {
    ci: ciMode,
    dryRun,
    fix: ciFix,
    ...(checkOnly === undefined ? {} : { only: checkOnly }),
    ...(ciReportPath === undefined ? {} : { reportPath: ciReportPath }),
    ...(changeSince === undefined ? {} : { since: changeSince }),
    write: checkWrite,
    yes,
  });
  validateDevFlags(command, {
    apply: devApply,
    ...(buildMode === undefined ? {} : { buildMode }),
    dryRun,
    ...(scopes === undefined ? {} : { scopes }),
    watch: devWatch,
    yes,
  });
  validateUpdateFlags(command, {
    ...(buildMode === undefined ? {} : { buildMode }),
    dryRun,
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
    ...(tryClaudeSettingSources === undefined ? {} : { claudeSettingSources: tryClaudeSettingSources }),
    ...(distDir === undefined ? {} : { distDir }),
    dryRun,
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
  });
  if (jsonlOutput) throw new Error("skillset: --jsonl is not supported until a streaming route is enabled");
  validateLookupFlags(command, {
    features: lookupFeatures,
    ...(lookupField === undefined ? {} : { field: lookupField }),
    targets: lookupTargets,
    views: lookupViews,
  });
  validateSourceDiagnosticFlags(command, {
    ...(buildMode === undefined ? {} : { buildMode }),
    dryRun,
    ...(checkOnly === undefined ? {} : { only: checkOnly }),
    ...(scopes === undefined ? {} : { scopes }),
    yes,
  });

  validateIsolatedFlag(command, isolated, checkOnly);
  validateDistributionFlags(command, {
    ...(buildMode === undefined ? {} : { buildMode }),
    dryRun,
    ...(distributionName === undefined ? {} : { name: distributionName }),
    ...(distributionSubcommand === undefined ? {} : { subcommand: distributionSubcommand }),
    ...(scopes === undefined ? {} : { scopes }),
    yes,
  });
  validateMarketplaceFlags(command, {
    ...(buildMode === undefined ? {} : { buildMode }),
    dryRun,
    ...(marketplaceName === undefined ? {} : { name: marketplaceName }),
    ...(scopes === undefined ? {} : { scopes }),
    ...(marketplaceSubcommand === undefined ? {} : { subcommand: marketplaceSubcommand }),
    yes,
  });

  if (command === "release" && scopes !== undefined) {
    throw new Error("skillset: --scope is not supported with release commands yet");
  }
  if (command === "release" && releaseSubcommand !== "apply" && (dryRun || yes)) {
    throw new Error("skillset: --yes and --dry-run are only supported with release apply");
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
    dryRun,
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
  if (command === "status" && (buildMode !== undefined || distDir !== undefined || dryRun || scopes !== undefined || sourceDir !== undefined || yes)) {
    throw new Error("skillset: status only supports --root and --json");
  }
  validateReconcileFlags(command, {
    ...(buildMode === undefined ? {} : { buildMode }),
    ...(changeSince === undefined ? {} : { changeSince }),
    ...(distDir === undefined ? {} : { distDir }),
    dryRun,
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
    devApply,
    devWatch,
    ...(distributionName === undefined ? {} : { distributionName }),
    ...(distributionSubcommand === undefined ? {} : { distributionSubcommand }),
    dryRun,
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
    ...(tryClaudeSettingSources === undefined ? {} : { tryClaudeSettingSources }),
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

function parseCliArgs(args: readonly string[]): ParsedArgs {
  try {
    return parseArgs(args);
  } catch (error) {
    if (error instanceof CliOutputError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw new CliOutputError(message, 2, readCliCommand(args));
  }
}

function isReleaseSubcommand(value: string | undefined): value is ReleaseSubcommand {
  return value === "amend" || value === "apply" || value === "audit" || value === "plan";
}

function isChangeSubcommand(value: string | undefined): value is ChangeSubcommand {
  return value === "add" ||
    value === "amend" ||
    value === "check" ||
    value === "history" ||
    value === "list" ||
    value === "migrate" ||
    value === "reason" ||
    value === "show" ||
    value === "status";
}

function isNewSourceKind(value: string | undefined): value is NewSourceKind {
  return value === "agent" || value === "hook" || value === "skill";
}

function readNewSourceScope(value: string): NewSourceScope {
  if (value === "repo") return value;
  throw new Error("skillset: new currently supports only --scope repo");
}

function readChangeScopes(value: string): readonly string[] {
  const scopes = value.split(",").map((scope) => scope.trim()).filter((scope) => scope.length > 0);
  if (scopes.length === 0) throw new Error("skillset: --scope requires at least one source unit scope");
  return scopes.map(sourceUnitSelector);
}

function readHookRuntimeContextFields(value: string): readonly HookRuntimeContextField[] {
  const fields = value.split(",").map((field) => field.trim()).filter((field) => field.length > 0);
  if (fields.length === 0) throw new Error("skillset: --context-fields requires at least one field");
  return fields.map(readHookRuntimeContextField);
}

function readChangeBump(value: string): ChangeBump {
  if (value === "major" || value === "minor" || value === "none" || value === "patch") return value;
  throw new Error("skillset: expected --bump major, minor, patch, or none");
}

function readPositiveInteger(value: string, flag: string): number {
  if (!/^[0-9]+$/u.test(value)) throw new Error(`skillset: expected ${flag} to be a positive integer`);
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`skillset: expected ${flag} to be a positive integer`);
  }
  return parsed;
}

function setChangeReason(current: ChangeReasonInput | undefined, next: ChangeReasonInput): ChangeReasonInput {
  if (current !== undefined) throw new Error("skillset: pass only one of --reason or --reason-file");
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
    readonly dryRun: boolean;
    readonly yes: boolean;
  }
): void {
  const hasChangeFlag = change.append ||
    change.bump !== undefined ||
    change.group !== undefined ||
    change.reason !== undefined ||
    change.ref !== undefined ||
    change.scopes !== undefined ||
    change.staged;
  if (hasChangeFlag && command !== "change") {
    throw new Error("skillset: change options are only supported with change commands");
  }
  if (command !== "change") return;
  if ((change.yes || change.dryRun) && subcommand !== "migrate") {
    throw new Error("skillset: --yes and --dry-run are only supported with change migrate");
  }
  if (change.yes && change.dryRun) {
    throw new Error("skillset: pass either --yes or --dry-run for change migrate, not both");
  }

  const allowed = {
    append: subcommand === "reason",
    bump: subcommand === "add",
    group: subcommand === "add" || subcommand === "list",
    reason: subcommand === "add" || subcommand === "amend" || subcommand === "reason",
    ref: subcommand === "amend" || subcommand === "check" || subcommand === "history" || subcommand === "reason" || subcommand === "show",
    scopes: subcommand === "add",
    staged: subcommand === "check" || subcommand === "status",
  };
  if (change.append && !allowed.append) throw new Error("skillset: --append is only supported with change reason");
  if (change.bump !== undefined && !allowed.bump) throw new Error("skillset: --bump is only supported with change add");
  if (change.group !== undefined && !allowed.group) throw new Error("skillset: --group is only supported with change add or change list");
  if (change.reason !== undefined && !allowed.reason) throw new Error("skillset: --reason and --reason-file are only supported with change add, change amend, or change reason");
  if (change.ref !== undefined && !allowed.ref) throw new Error("skillset: --ref is only supported with change amend, change check, change history, change reason, or change show");
  if (change.scopes !== undefined && !allowed.scopes) throw new Error("skillset: source-unit --scope is only supported with change add");
  if (change.staged && !allowed.staged) throw new Error("skillset: --staged is only supported with change status or change check");
}

function validateReleaseFlags(
  command: Command,
  subcommand: ReleaseSubcommand | undefined,
  release: {
    readonly reason?: ChangeReasonInput;
    readonly ref?: string;
  }
): void {
  const hasReleaseFlag = release.reason !== undefined || release.ref !== undefined;
  if (hasReleaseFlag && command !== "release") {
    throw new Error("skillset: release options are only supported with release commands");
  }
  if (command !== "release") return;

  if (release.reason !== undefined && subcommand !== "amend") {
    throw new Error("skillset: --reason and --reason-file are only supported with release amend");
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
    readonly dryRun: boolean;
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
  if (hasHookPrintFlag && (command !== "hooks" || hooks.subcommand !== "print")) {
    throw new Error("skillset: hook options are only supported with hooks print");
  }
  if (hasHookContextFlag && (command !== "hooks" || hooks.subcommand !== "context")) {
    throw new Error("skillset: hook context options are only supported with hooks context");
  }
  if (command !== "hooks") return;
  if (hooks.subcommand !== "context" && hooks.subcommand !== "print" && hooks.subcommand !== "run") {
    throw new Error("skillset: expected hooks subcommand context, print, or run");
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
    hooks.dryRun ||
    hooks.yes
  ) {
    throw new Error(`skillset: non-hook options are not supported with hooks ${hooks.subcommand}`);
  }
}

function validateDistributionFlags(
  command: Command,
  distribution: {
    readonly buildMode?: CompileBuildMode;
    readonly dryRun: boolean;
    readonly name?: string;
    readonly scopes?: readonly BuildScope[];
    readonly subcommand?: DistributionSubcommand;
    readonly yes: boolean;
  }
): void {
  if (command !== "distribute") return;
  if (distribution.subcommand !== "plan") throw new Error("skillset: expected distribute subcommand plan");
  if (distribution.name !== undefined && !/^[a-z0-9][a-z0-9._-]*$/.test(distribution.name)) {
    throw new Error("skillset: expected distribution name to be a lowercase id");
  }
  if (
    distribution.buildMode !== undefined ||
    distribution.dryRun ||
    distribution.scopes !== undefined ||
    distribution.yes
  ) {
    throw new Error("skillset: build/write options are not supported with distribute plan; it is always read-only");
  }
}

function validateMarketplaceFlags(
  command: Command,
  marketplace: {
    readonly buildMode?: CompileBuildMode;
    readonly dryRun: boolean;
    readonly name?: string;
    readonly scopes?: readonly BuildScope[];
    readonly subcommand?: MarketplaceSubcommand;
    readonly yes: boolean;
  }
): void {
  if (command !== "marketplace") return;
  if (marketplace.subcommand !== "check" && marketplace.subcommand !== "update") {
    throw new Error("skillset: expected marketplace subcommand check or update");
  }
  if (marketplace.name !== undefined && !/^[a-z0-9][a-z0-9._-]*$/.test(marketplace.name)) {
    throw new Error("skillset: expected marketplace name to be a lowercase id");
  }
  if (marketplace.subcommand === "check" && (marketplace.dryRun || marketplace.yes)) {
    throw new Error("skillset: build/write options are not supported with marketplace check; it is always read-only");
  }
  if (
    marketplace.buildMode !== undefined ||
    marketplace.scopes !== undefined
  ) {
    throw new Error(`skillset: build scope options are not supported with marketplace ${marketplace.subcommand}`);
  }
}

function validateTestFlags(
  command: Command,
  test: {
    readonly adHoc: boolean;
    readonly buildMode?: CompileBuildMode;
    readonly declaredName?: string;
    readonly distDir?: string;
    readonly dryRun: boolean;
    readonly scopes?: readonly BuildScope[];
    readonly yes: boolean;
  }
): void {
  if (command !== "test") return;
  if (test.declaredName !== undefined && test.adHoc) {
    throw new Error(
      `skillset: declared test ${test.declaredName} cannot be combined with ad hoc test flags`
    );
  }
  if (
    test.buildMode !== undefined ||
    test.distDir !== undefined ||
    test.dryRun ||
    test.scopes !== undefined ||
    test.yes
  ) {
    throw new Error("skillset: build/write options are not supported with test; test output always writes under logical .skillset/cache/tests");
  }
}

function validateSourceDiagnosticFlags(
  command: Command,
  sourceCheck: {
    readonly buildMode?: CompileBuildMode;
    readonly dryRun: boolean;
    readonly only?: "outputs";
    readonly scopes?: readonly BuildScope[];
    readonly yes: boolean;
  }
): void {
  if (command !== "check") return;
  const label = `skillset ${command}`;
  if (sourceCheck.only === "outputs") {
    if (sourceCheck.dryRun || sourceCheck.yes) {
      throw new Error(`${label} --only outputs is read-only and does not support --yes or --dry-run`);
    }
    return;
  }
  if (sourceCheck.buildMode !== undefined) {
    throw new Error(`${label} does not support --updated or --all; it checks source diagnostics`);
  }
  if (sourceCheck.scopes !== undefined) {
    throw new Error(`${label} does not support --scope; it checks source diagnostics`);
  }
  if (sourceCheck.dryRun || sourceCheck.yes) {
    throw new Error(`${label} is read-only and does not support --yes or --dry-run`);
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
  if (command !== "restore") return;
  if (
    restore.buildMode !== undefined ||
    restore.changeSince !== undefined ||
    restore.distDir !== undefined ||
    restore.scopes !== undefined ||
    restore.sourceDir !== undefined
  ) {
    throw new Error("skillset: restore only supports --root, --yes, and --dry-run");
  }
}

function validateReconcileFlags(
  command: Command,
  reconcile: {
    readonly buildMode?: CompileBuildMode;
    readonly changeSince?: string;
    readonly distDir?: string;
    readonly dryRun: boolean;
    readonly scopes?: readonly BuildScope[];
    readonly choice?: ReconcileChoice;
    readonly sourceDir?: string;
    readonly yes: boolean;
  }
): void {
  if (reconcile.choice !== undefined && command !== "reconcile") throw new Error("skillset: --use is only supported with reconcile");
  if (command !== "reconcile") return;
  if (reconcile.buildMode !== undefined) throw new Error("skillset: --updated and --all are not supported with reconcile");
  if (reconcile.changeSince !== undefined) throw new Error("skillset: --since is not supported with reconcile");
  if (reconcile.distDir !== undefined || reconcile.sourceDir !== undefined) {
    throw new Error("skillset: reconcile does not support --source or --dist overrides");
  }
  if (reconcile.dryRun) throw new Error("skillset: --dry-run is redundant for reconcile preview mode");
  if (reconcile.scopes !== undefined) throw new Error("skillset: --scope is not supported with reconcile");
  if (reconcile.yes && reconcile.choice === undefined) throw new Error("skillset: reconcile --yes requires --use source or --use output");
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
  const hasNewFlag = source.container !== undefined ||
    source.id !== undefined ||
    source.kind !== undefined ||
    source.name !== undefined ||
    source.presets !== undefined ||
    source.scope !== undefined;
  if (hasNewFlag && command !== "new") {
    throw new Error("skillset: new options are only supported with new");
  }
  if (command !== "new") return;
  if (source.buildMode !== undefined) throw new Error("skillset: --updated and --all are not supported with new");
  if (source.distDir !== undefined) throw new Error("skillset: --dist is not supported with new");
  if (source.importKind !== undefined) throw new Error("skillset: --kind is only supported with import");
  if (source.importProvider !== undefined) throw new Error("skillset: --from is only supported with import");
  if (source.kind === undefined) throw new Error("skillset: expected new kind skill, agent, or hook");
}

function setBuildMode(current: CompileBuildMode | undefined, next: CompileBuildMode): CompileBuildMode {
  if (current !== undefined && current !== next) {
    throw new Error(`skillset: conflicting build mode flags --${current} and --${next}`);
  }
  return next;
}

function readBuildScopes(value: string): readonly BuildScope[] {
  const scopes = value.split(",").map((scope) => scope.trim()).filter((scope) => scope.length > 0);
  if (scopes.length === 0) throw new Error("skillset: --scope requires at least one scope");
  if (scopes.includes("all")) {
    if (scopes.length > 1) throw new Error("skillset: --scope all cannot be combined with other scopes");
    return ["repo", "plugins", "project", "user"];
  }
  const seen = new Set<BuildScope>();
  for (const scope of scopes) {
    if (!isBuildScope(scope)) {
      throw new Error("skillset: expected --scope repo, plugins, project, user, all, or a comma-separated combination");
    }
    seen.add(scope);
  }
  return [...seen];
}

function isBuildScope(value: string): value is BuildScope {
  return value === "repo" || value === "plugins" || value === "project" || value === "user";
}

function readHookRunner(value: string): HookRunner {
  if (value === "git" || value === "husky" || value === "lefthook" || value === "pre-commit") return value;
  throw new Error("skillset: expected --runner lefthook, husky, pre-commit, or git");
}

function readHookTarget(value: string): TargetName {
  if (value === "claude" || value === "codex") return value;
  throw new Error("skillset: expected --target claude or codex");
}

function readTargetName(value: string): TargetName {
  if (isTargetName(value)) return value;
  throw new Error(`skillset: expected --target ${targetNames().join(", ")}`);
}

function mergeSetupIncludes(
  current: readonly SetupInclude[] | undefined,
  value: string
): readonly SetupInclude[] {
  const includes = value.split(",").map((item) => item.trim()).filter((item) => item.length > 0);
  if (includes.length === 0) throw new Error("skillset: --include requires at least one value");
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
  const targets = value.split(",").map((target) => target.trim()).filter((target) => target.length > 0);
  if (targets.length === 0) throw new Error("skillset: --targets requires at least one target");
  const seen = new Set<TargetName>();
  for (const target of targets) {
    if (!isTargetName(target)) {
      throw new Error(`skillset: expected --targets ${targetNames().join(", ")}`);
    }
    seen.add(target);
  }
  return [...seen];
}

function validateIsolatedFlag(command: Command, isolated: boolean, checkOnly?: "outputs"): void {
  if (!isolated) return;
  if (command === "build" || command === "diff" || (command === "check" && checkOnly === "outputs")) return;
  throw new Error("skillset: --isolated is only supported with build, check --only outputs, or diff");
}

function validateCiFlags(
  command: Command,
  ci: {
    readonly ci: boolean;
    readonly dryRun: boolean;
    readonly fix: boolean;
    readonly only?: "outputs";
    readonly reportPath?: string;
    readonly since?: string;
    readonly write: boolean;
    readonly yes: boolean;
  }
): void {
  if (command !== "check") {
    if (ci.ci || ci.fix || ci.only !== undefined || ci.reportPath !== undefined || ci.write) {
      throw new Error("skillset: readiness flags are only supported with check");
    }
    if (ci.since !== undefined && command !== "change" && command !== "hooks") {
      throw new Error("skillset: --since is only supported with check --ci or change commands");
    }
    return;
  }
  if (ci.yes || ci.dryRun) throw new Error("skillset: check does not take --yes or --dry-run");
  if (ci.fix && !ci.ci) throw new Error("skillset: check --fix requires --ci");
  if (ci.write && ci.ci) throw new Error("skillset: check --ci uses --fix instead of --write");
  if ((ci.reportPath !== undefined || ci.since !== undefined) && !ci.ci) throw new Error("skillset: --report and --since require check --ci");
  if (ci.only !== undefined && (ci.ci || ci.fix || ci.write || ci.reportPath !== undefined || ci.since !== undefined)) {
    throw new Error("skillset: check --only outputs cannot be combined with CI or write flags");
  }
}

function validateDevFlags(
  command: Command,
  dev: {
    readonly apply: boolean;
    readonly buildMode?: CompileBuildMode;
    readonly dryRun: boolean;
    readonly scopes?: readonly BuildScope[];
    readonly watch: boolean;
    readonly yes: boolean;
  }
): void {
  if (dev.watch && command !== "dev") {
    throw new Error("skillset: --watch is only supported with dev");
  }
  if (dev.apply && command !== "dev") {
    throw new Error("skillset: --apply is only supported with dev");
  }
  if (command !== "dev") return;
  if (!dev.watch) throw new Error("skillset: dev currently requires --watch");
  if (dev.buildMode !== undefined) throw new Error("skillset: dev --watch does not support --updated or --all");
  if (dev.scopes !== undefined) throw new Error("skillset: dev --watch does not support --scope yet");
  if (dev.yes || dev.dryRun) {
    throw new Error("skillset: dev --watch uses preview mode by default or write mode with --apply; it does not support --yes or --dry-run");
  }
}

function validateUpdateFlags(
  command: Command,
  update: {
    readonly buildMode?: CompileBuildMode;
    readonly dryRun: boolean;
    readonly scopes?: readonly BuildScope[];
    readonly yes: boolean;
  }
): void {
  if (command !== "update") return;
  if (update.buildMode !== undefined) {
    throw new Error("skillset: update does not support --updated or --all");
  }
  if (update.scopes !== undefined) {
    throw new Error("skillset: update does not support --scope; provider format updates require a whole-workspace safety preflight");
  }
  if (update.yes && update.dryRun) {
    throw new Error("skillset: pass either --yes or --dry-run for update, not both");
  }
}

function validateSetupFlags(
  command: Command,
  setup: {
    readonly includes?: readonly SetupInclude[];
    readonly targets?: readonly TargetName[];
  }
): void {
  const hasSetupFlag = setup.includes !== undefined || setup.targets !== undefined;
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
  if (command !== "init") return;
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
  }
): void {
  if (!jsonOutput) return;
  if (command === "check") return;
  if (command === "change" && (route.changeSubcommand === "check" || route.changeSubcommand === "history" || route.changeSubcommand === "list" || route.changeSubcommand === "show" || route.changeSubcommand === "status")) return;
  if (command === "diff" || command === "status" || command === "explain" || command === "list" || command === "lookup" || command === "marketplace" || command === "reconcile" || command === "test") return;
  if (command === "distribute" && route.distributionSubcommand === "plan") return;
  throw new Error("skillset: --json is not supported for this command route");
}

function validateLookupFlags(
  command: Command,
  lookup: {
    readonly features: boolean;
    readonly field?: string;
    readonly targets: readonly TargetName[];
    readonly views: readonly LookupView[];
  }
): void {
  if (command === "lookup") {
    if (lookup.features && (lookup.field !== undefined || lookup.targets.length > 0 || lookup.views.length > 0)) {
      throw new Error("skillset: lookup features only supports an optional feature id and --json");
    }
    return;
  }
  if (lookup.field !== undefined || lookup.targets.length > 0 || lookup.views.length > 0) {
    throw new Error("skillset: lookup flags are only supported with lookup");
  }
}

function isImportKind(value: string): value is ImportKind {
  return value === "skill" || value === "skills" || value === "plugin" || value === "plugins";
}

function isImportProvider(value: string): value is ImportProvider {
  return value === "agents" || value === "claude" || value === "codex" || value === "cursor" || value === "skillset";
}
