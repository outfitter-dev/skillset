import { mkdir, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";

import { buildSkillsetResult, checkSkillsetResult, diffSkillsetResult } from "@skillset/core";

import { changeCheck, type ChangeBump, type ChangeCheckReport } from "./change-entries";
import { changeStatus, type ChangeStatusReport } from "./change-status";
import { ADOPT_REPORT_DIR, adoptSkillset, type AdoptReport } from "./adopt";
import {
  addChangeEntry,
  groupRef,
  listChangeEntries,
  readChangeHistory,
  showChangeEntry,
  updateChangeReason,
  type ChangeEntryView,
  type ChangeReasonInput,
  type ChangeSubcommand,
} from "./change-workflow";
import { doctorSkillset, explainPath, listGeneratedEntries } from "./authoring";
import { ciSkillset, hasDrift, renderCiReportMarkdown, type CiReport } from "./ci";
import { printDiagnostics, printDiffPlan } from "./cli-renderers";
import { renderHookPrint, type HookPrintSubcommand, type HookRunner } from "./hook-guardrails";
import { importSources, type ImportKind, type ImportProvider, type ImportReport } from "./import";
import { lintSkillset } from "./lint";
import { applyRelease, planRelease, type ReleasePlanReport, type ReleaseSubcommand } from "./release";
import { createSkillset, initSkillset, type SetupInclude, type SetupReport } from "./setup";
import { sourceUnitDisplay, sourceUnitDisplays, sourceUnitSelector } from "./source-unit-selector";
import { runSkillsetTest, type SkillsetTestReport } from "./test-runner";
import type { BuildScope, CompileBuildMode, SkillsetOptions, SourceOrigin, TargetName } from "./types";

type Command = "adopt" | "build" | "change" | "check" | "ci" | "create" | "diff" | "doctor" | "explain" | "hooks" | "import" | "init" | "lint" | "list" | "release" | "test";

const USAGE = [
  "usage: skillset build [--yes|--dry-run] [--updated|--all] [--isolated] [--scope <scope>] [--root <path>] [--source <dir>] [--dist <dir>]",
  "       skillset <check|diff> [--updated|--all] [--isolated] [--scope <scope>] [--root <path>] [--source <dir>] [--dist <dir>]",
  "       skillset <doctor|lint|list> [--updated|--all] [--scope <scope>] [--root <path>] [--source <dir>] [--dist <dir>]",
  "       skillset ci [--fix] [--since <ref>] [--report <path>] [--root <path>] [--source <dir>] [--dist <dir>]",
  "       skillset change status [--since <ref>] [--root <path>] [--source <dir>] [--dist <dir>]",
  "       skillset change check [@ref|--ref <ref>] [--since <ref>] [--root <path>] [--source <dir>] [--dist <dir>]",
  "       skillset change <status|check> --staged [--root <path>] [--source <dir>] [--dist <dir>]",
  "       skillset change add --scope <source-unit> --bump <bump> [--group <group>] [--reason <text>|--reason-file <path>|--reason -] [--since <ref>] [--root <path>] [--source <dir>]",
  "       skillset change reason <@ref> [--append] [--reason <text>|--reason-file <path>|--reason -] [--root <path>] [--source <dir>]",
  "       skillset change <show|history> [@ref] [--root <path>] [--source <dir>]",
  "       skillset change list [--group <group>] [--root <path>] [--source <dir>]",
  "       skillset release plan [--root <path>] [--source <dir>] [--dist <dir>]",
  "       skillset release apply [--yes|--dry-run] [--root <path>] [--source <dir>] [--dist <dir>]",
  "       skillset test [name] [--root <path>] [--source <dir>]",
  "       skillset hooks print --runner <lefthook|husky|pre-commit|git> [--pre-commit] [--pre-push]",
  "       skillset hooks print --target <claude|codex> --agent-runtime",
  "       skillset adopt <path> [--yes|--dry-run] [--targets claude,codex] [--root <path>]",
  "       skillset init [path] [--yes|--dry-run] [--targets claude,codex] [--include agents,ci] [--name <name>] [--root <path>]",
  "       skillset create [path|--global] [--yes|--dry-run] [--targets claude,codex] [--include agents,ci] [--name <name>] [--root <path>]",
  "       skillset explain <path> [--root <path>] [--source <dir>]",
  "       skillset import <path> [--kind <skill|skills|plugin|plugins>] [--from <provider>] [--name <name>] [--root <path>] [--source <dir>]",
  "       skillset import <claude|codex|agents> [--root <path>] [--source <dir>]",
].join("\n");

export async function runCli(
  rawArgs: readonly string[] = process.argv.slice(2),
  invokedName = basename(process.argv[1] ?? "")
): Promise<void> {
  const args = invokedName === "create-skillset" ? ["create", ...rawArgs] : rawArgs;
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
    ciReportPath,
    dryRun,
    hookAgentRuntime,
    hookPreCommit,
    hookPrePush,
    hookRunner,
    hookSubcommand,
    hookTarget,
    importKind,
    importPath,
    importName,
    importProvider,
    options,
    rootPath,
    rootExplicit,
    releaseSubcommand,
    setupGlobal,
    setupIncludes,
    setupTargets,
    testName,
    yes,
  } = parseArgs(args);

  if (command === "build") {
    if (dryRun || !yes) {
      const result = await diffSkillsetResult(rootPath, options);
      printDiagnostics(result.diagnostics);
      const { data: diff } = result;
      printDiffPlan(diff, dryRun ? "dry run" : "write confirmation required");
      if (!dryRun) console.log("skillset: rerun with --yes to write generated files");
      return;
    }
    const result = await buildSkillsetResult(rootPath, options);
    printDiagnostics(result.diagnostics);
    console.log(`skillset: wrote ${result.writes.writtenPaths.length} generated files`);
    if (result.writes.deletedPaths.length > 0) {
      console.log(`skillset: removed ${result.writes.deletedPaths.length} stale generated files`);
    }
    return;
  }

  if (command === "ci") {
    const report = await ciSkillset(rootPath, {
      ...options,
      ...(ciFix ? { fix: true } : {}),
      ...(changeSince === undefined ? {} : { since: changeSince }),
    });
    if (ciReportPath !== undefined) {
      const reportPath = resolve(ciReportPath);
      await mkdir(dirname(reportPath), { recursive: true });
      await writeFile(reportPath, renderCiReportMarkdown(report));
    }
    printCiReport(report);
    if (!report.ok) process.exitCode = 1;
    return;
  }

  if (command === "change") {
    const changeOptions = { ...options, ...(changeSince === undefined ? {} : { since: changeSince }) };
    if (changeSubcommand === "status") {
      printChangeStatus(await changeStatus(rootPath, {
        ...changeOptions,
        ...(changeStaged ? { staged: true } : {}),
      }));
      return;
    }
    if (changeSubcommand === "check") {
      printChangeCheck(await changeCheck(rootPath, {
        ...changeOptions,
        ...(changeRef === undefined ? {} : { ref: changeRef }),
        ...(changeStaged ? { staged: true } : {}),
      }));
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
    if (changeSubcommand === "show") {
      if (changeRef === undefined) throw new Error("skillset: change show requires @ref");
      printChangeEntry("show", (await showChangeEntry(rootPath, { ...changeOptions, ref: changeRef })).entry);
      return;
    }
    if (changeSubcommand === "list") {
      printChangeList((await listChangeEntries(rootPath, {
        ...changeOptions,
        ...(changeGroup === undefined ? {} : { group: changeGroup }),
      })).entries);
      return;
    }
    if (changeSubcommand === "history") {
      printChangeHistory((await readChangeHistory(rootPath, {
        ...changeOptions,
        ...(changeRef === undefined ? {} : { ref: changeRef }),
      })).entries);
      return;
    }
    throw new Error("skillset: expected change subcommand add, check, history, list, reason, show, or status");
  }

  if (command === "release") {
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
    throw new Error("skillset: expected release subcommand apply or plan");
  }

  if (command === "hooks") {
    if (hookSubcommand !== "print") throw new Error("skillset: expected hooks subcommand print");
    process.stdout.write(renderHookPrint({
      agentRuntime: hookAgentRuntime,
      preCommit: hookPreCommit,
      prePush: hookPrePush,
      ...(hookRunner === undefined ? {} : { runner: hookRunner }),
      ...(hookTarget === undefined ? {} : { target: hookTarget }),
    }));
    return;
  }

  if (command === "test") {
    const report = await runSkillsetTest(rootPath, testName, options);
    printSkillsetTest(report);
    if (!report.ok) process.exitCode = 1;
    return;
  }

  if (command === "lint") {
    const result = await lintSkillset(rootPath, options);
    for (const issue of result.issues) {
      if (issue.severity !== "warn") continue;
      console.log(`  warn: ${issue.path}: ${issue.code}: ${issue.message}`);
    }
    console.log(`skillset: linted ${result.checkedSkills} source skills`);
    return;
  }

  if (command === "adopt") {
    const writeMode = yes && !dryRun;
    const report = await adoptSkillset(
      importPath === undefined ? rootPath : importPath,
      {
        cwd: rootPath,
        ...(setupTargets === undefined ? {} : { targets: setupTargets }),
        write: writeMode,
      }
    );
    printAdoptReport(report, dryRun ? "dry run" : writeMode ? "written" : "write confirmation required");
    if (!writeMode) console.log("skillset: rerun with --yes to adopt");
    if (writeMode && !report.ok) process.exitCode = 1;
    return;
  }

  if (command === "init" || command === "create") {
    const setup = command === "init"
      ? await initSkillset({
          cwd: rootPath,
          ...(importPath === undefined ? {} : { rootPath: importPath }),
          ...(importName === undefined ? {} : { name: importName }),
          ...(setupTargets === undefined ? {} : { targets: setupTargets }),
          ...(setupIncludes === undefined ? {} : { include: setupIncludes }),
          useGitRoot: !rootExplicit && importPath === undefined,
          write: yes && !dryRun,
        })
      : await createSkillset({
          cwd: rootPath,
          global: setupGlobal,
          ...(importPath === undefined ? {} : { rootPath: importPath }),
          ...(importName === undefined ? {} : { name: importName }),
          ...(setupTargets === undefined ? {} : { targets: setupTargets }),
          ...(setupIncludes === undefined ? {} : { include: setupIncludes }),
          write: yes && !dryRun,
        });
    printSetupReport(setup, dryRun ? "dry run" : yes ? "written" : "write confirmation required");
    if (!yes || dryRun) console.log(`skillset: rerun ${command} with --yes to write setup files`);
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

  if (command === "diff") {
    const result = await diffSkillsetResult(rootPath, options);
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
    return;
  }

  if (command === "list") {
    const entries = await listGeneratedEntries(rootPath, options);
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

  if (command === "explain") {
    if (importPath === undefined) {
      throw new Error("skillset: expected a path to explain");
    }
    const result = await explainPath(rootPath, importPath, options);
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
    for (const note of result.notes) console.log(`  note: ${note}`);
    if (result.kind === "unknown") process.exitCode = 1;
    return;
  }

  if (command === "doctor") {
    // doctorSkillset carries source warnings in the structured report; the CLI
    // renders them below instead of relying on core operations to print.
    const report = await doctorSkillset(rootPath, options);
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
    if (report.ok) {
      console.log("skillset: doctor found no problems");
    } else {
      const problems: string[] = [];
      if (report.lintIssues.length > 0) problems.push(`${report.lintIssues.length} lint issue(s)`);
      if (driftCount > 0) problems.push("generated-output drift");
      if (report.buildError !== undefined) problems.push("a build error");
      console.log(`skillset: doctor found ${problems.join(" and ")}`);
      process.exitCode = 1;
    }
    return;
  }

  const result = await checkSkillsetResult(rootPath, options);
  printDiagnostics(result.diagnostics);
  console.log(`skillset: checked ${result.data.checkedFiles} generated files`);
}

export function reportCliError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
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
  readonly ciReportPath?: string;
  readonly dryRun: boolean;
  readonly hookAgentRuntime: boolean;
  readonly hookPreCommit: boolean;
  readonly hookPrePush: boolean;
  readonly hookRunner?: HookRunner;
  readonly hookSubcommand?: HookPrintSubcommand;
  readonly hookTarget?: TargetName;
  readonly importKind?: ImportKind;
  readonly importName?: string;
  readonly importPath?: string;
  readonly importProvider?: ImportProvider;
  readonly options: SkillsetOptions;
  readonly releaseSubcommand?: ReleaseSubcommand;
  readonly rootExplicit: boolean;
  readonly rootPath: string;
  readonly setupGlobal: boolean;
  readonly setupIncludes?: readonly SetupInclude[];
  readonly setupTargets?: readonly TargetName[];
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

function printChangeCheck(report: ChangeCheckReport): void {
  for (const issue of report.issues) {
    const path = issue.path === undefined ? "" : `${issue.path}: `;
    console.log(`  ${issue.severity}: ${path}${issue.code}: ${issue.message}`);
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
}

function printCiReport(report: CiReport): void {
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
  for (const path of report.fixedPaths) console.log(`  fixed ${path}`);
  const drift = report.drift;
  for (const path of drift.added) console.log(`  generated + ${path}`);
  for (const path of drift.changed) console.log(`  generated ~ ${path}`);
  for (const path of drift.missing) console.log(`  generated ! ${path}`);
  for (const path of drift.removed) console.log(`  generated - ${path}`);
  if (report.buildError !== undefined) {
    console.log(`  build error: ${report.buildError}`);
  }

  if (report.ok) {
    console.log(
      report.fixedPaths.length === 0
        ? "skillset: ci passed"
        : `skillset: ci passed after rebuilding ${report.fixedPaths.length} generated file${report.fixedPaths.length === 1 ? "" : "s"}`
    );
    return;
  }
  const changeErrors = report.changeIssues.filter((issue) => issue.severity === "error").length;
  const lintErrors = report.lintIssues.filter((issue) => issue.severity === "error").length;
  const problems: string[] = [];
  if (lintErrors > 0) problems.push(`${lintErrors} lint issue(s)`);
  if (report.changeError !== undefined) problems.push("a change check error");
  if (changeErrors > 0) problems.push(`${changeErrors} change entry error(s)`);
  if (hasDrift(report.drift)) problems.push("generated-output drift (run skillset build --yes or ci --fix)");
  if (report.buildError !== undefined) problems.push("a build error");
  console.log(`skillset: ci found ${problems.join(" and ")}`);
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
    console.log("  note: repo already has .skillset/config.yaml; adopting against existing source");
  }
  for (const file of report.setupFiles) {
    console.log(`  ${file.status === "create" ? "+" : "="} ${file.path}`);
  }
  for (const candidate of report.candidates) {
    console.log(`  ? import candidate ${candidate.kind} ${candidate.path}`);
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
      ? `  ok build: wrote ${report.builtFiles} generated files under .skillset/build/out/`
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
  for (const baseline of result.baselines) {
    const marker = baseline.status === "create" ? "+" : "=";
    console.log(`  ${marker} baseline ${sourceUnitDisplay(baseline.scope)} ${baseline.version}`);
  }
  for (const candidate of result.importCandidates) {
    console.log(`  ? import candidate ${candidate.kind} ${candidate.path}`);
  }
  for (const skip of result.surveySkips) {
    console.log(`  ! skipped ${skip.surface} ${skip.path}: ${skip.reason}`);
  }
  const created = result.files.filter((file) => file.status === "create").length;
  const existing = result.files.length - created;
  const baselines = result.baselines.filter((baseline) => baseline.status === "create").length;
  const candidates = result.importCandidates.length;
  const details = [
    `${created} to create`,
    `${existing} already present`,
    ...(baselines === 0 ? [] : [`${baselines} baseline${baselines === 1 ? "" : "s"} to adopt`]),
    ...(candidates === 0 ? [] : [`${candidates} import candidate${candidates === 1 ? "" : "s"}`]),
  ];
  console.log(`skillset: ${result.kind} ${details.join(", ")} (${reason})`);
  console.log(`  root: ${result.rootPath}`);
}

function printSkillsetTest(report: SkillsetTestReport): void {
  for (const assertion of report.assertions) {
    const marker = assertion.ok ? "pass" : "fail";
    const path = assertion.path === undefined ? "" : ` ${assertion.path}`;
    const detail = assertion.detail === undefined ? "" : ` (${assertion.detail})`;
    console.log(`  ${marker}: ${assertion.kind}${path}${detail}`);
  }
  console.log(`skillset: test ${report.name} ${report.ok ? "passed" : "failed"}`);
  console.log(`  run: ${report.runPath}`);
  console.log(`  latest: ${report.latestPath}`);
  console.log(`  report: ${report.reportPath}`);
  console.log(`  generated files: ${report.generatedFiles}`);
}

function parseArgs(args: readonly string[]): ParsedArgs {
  const command = args[0];
  if (
    command !== "adopt" &&
    command !== "build" &&
    command !== "change" &&
    command !== "check" &&
    command !== "ci" &&
    command !== "create" &&
    command !== "diff" &&
    command !== "doctor" &&
    command !== "explain" &&
    command !== "hooks" &&
    command !== "import" &&
    command !== "init" &&
    command !== "lint" &&
    command !== "list" &&
    command !== "release" &&
    command !== "test"
  ) {
    throw new Error(
        "skillset: expected command adopt, build, change, check, ci, create, diff, doctor, explain, hooks, import, init, lint, list, release, or test\n" +
        USAGE
    );
  }

  let changeSubcommand: ChangeSubcommand | undefined;
  let releaseSubcommand: ReleaseSubcommand | undefined;
  let changeAppend = false;
  let changeBump: ChangeBump | undefined;
  let changeGroup: string | undefined;
  let changeReason: ChangeReasonInput | undefined;
  let changeRef: string | undefined;
  let changeSince: string | undefined;
  let changeStaged = false;
  let changeScopes: readonly string[] | undefined;
  let ciFix = false;
  let ciReportPath: string | undefined;
  let hookAgentRuntime = false;
  let hookPreCommit = false;
  let hookPrePush = false;
  let hookRunner: HookRunner | undefined;
  let hookSubcommand: HookPrintSubcommand | undefined;
  let hookTarget: TargetName | undefined;
  let importKind: ImportKind | undefined;
  let importName: string | undefined;
  let importPath: string | undefined;
  let importProvider: ImportProvider | undefined;
  let rootPath = process.cwd();
  let rootExplicit = false;
  let sourceDir: string | undefined;
  let distDir: string | undefined;
  let buildMode: CompileBuildMode | undefined;
  let dryRun = false;
  let isolated = false;
  let scopes: readonly BuildScope[] | undefined;
  let setupGlobal = false;
  let setupIncludes: readonly SetupInclude[] | undefined;
  let setupTargets: readonly TargetName[] | undefined;
  let testName: string | undefined;
  let yes = false;
  let index = 1;

  if (command === "change") {
    const subcommand = args[index];
    if (!isChangeSubcommand(subcommand)) {
      throw new Error("skillset: expected change subcommand add, check, history, list, reason, show, or status");
    }
    changeSubcommand = subcommand;
    index += 1;
    const rawRef = args[index];
    if ((subcommand === "check" || subcommand === "history" || subcommand === "reason" || subcommand === "show") && rawRef !== undefined && !rawRef.startsWith("--")) {
      changeRef = rawRef;
      index += 1;
    }
  }

  if (command === "release") {
    const subcommand = args[index];
    if (!isReleaseSubcommand(subcommand)) {
      throw new Error("skillset: expected release subcommand apply or plan");
    }
    releaseSubcommand = subcommand;
    index += 1;
  }

  if (command === "hooks") {
    const subcommand = args[index];
    if (subcommand !== "print") {
      throw new Error("skillset: expected hooks subcommand print");
    }
    hookSubcommand = subcommand;
    index += 1;
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

  if (command === "adopt" || command === "init" || command === "create") {
    const rawPath = args[index];
    if (rawPath !== undefined && !rawPath.startsWith("--")) {
      importPath = rawPath;
      index += 1;
    }
  }

  if (command === "explain") {
    const rawPath = args[index];
    if (rawPath === undefined || rawPath.startsWith("--")) {
      throw new Error("skillset: expected a path to explain");
    }
    importPath = rawPath;
    index += 1;
  }

  if (command === "test") {
    const rawName = args[index];
    if (rawName !== undefined && !rawName.startsWith("--")) {
      testName = rawName;
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
      flag !== "--name" &&
      flag !== "--kind" &&
      flag !== "--from" &&
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
      flag !== "--global" &&
      flag !== "--targets" &&
      flag !== "--include" &&
      flag !== "--fix" &&
      flag !== "--report" &&
      flag !== "--runner" &&
      flag !== "--target" &&
      flag !== "--agent-runtime" &&
      flag !== "--pre-commit" &&
      flag !== "--pre-push"
    ) {
      throw new Error(`skillset: unknown option ${arg}`);
    }

    if (
      flag === "--yes" ||
      flag === "--dry-run" ||
      flag === "--updated" ||
      flag === "--all" ||
      flag === "--isolated" ||
      flag === "--append" ||
      flag === "--staged" ||
      flag === "--global" ||
      flag === "--fix" ||
      flag === "--agent-runtime" ||
      flag === "--pre-commit" ||
      flag === "--pre-push"
    ) {
      if (inlineValue !== undefined) throw new Error(`skillset: ${flag} does not take a value`);
      if (flag === "--yes") yes = true;
      if (flag === "--dry-run") dryRun = true;
      if (flag === "--updated") buildMode = setBuildMode(buildMode, "updated");
      if (flag === "--all") buildMode = setBuildMode(buildMode, "all");
      if (flag === "--isolated") isolated = true;
      if (flag === "--append") changeAppend = true;
      if (flag === "--staged") changeStaged = true;
      if (flag === "--global") setupGlobal = true;
      if (flag === "--fix") ciFix = true;
      if (flag === "--agent-runtime") hookAgentRuntime = true;
      if (flag === "--pre-commit") hookPreCommit = true;
      if (flag === "--pre-push") hookPrePush = true;
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
    if (flag === "--ref") changeRef = value;
    if (flag === "--since") changeSince = value;
    if (flag === "--scope") {
      if (command === "change" && changeSubcommand === "add") {
        changeScopes = [...(changeScopes ?? []), ...readChangeScopes(value)];
      } else if (command === "change" && (changeSubcommand === "status" || changeSubcommand === "check")) {
        throw new Error(`skillset: change ${changeSubcommand} is a whole-source command; --scope is not supported`);
      } else if (command === "change") {
        throw new Error("skillset: --scope is only supported with change add source-unit entries");
      } else {
        scopes = readBuildScopes(value);
      }
    }
    if (flag === "--group") changeGroup = value;
    if (flag === "--reason") changeReason = setChangeReason(changeReason, value === "-" ? { kind: "stdin" } : { kind: "inline", value });
    if (flag === "--reason-file") changeReason = setChangeReason(changeReason, { kind: "file", path: value });
    if (flag === "--bump") changeBump = readChangeBump(value);
    if (flag === "--report") ciReportPath = value;
    if (flag === "--runner") hookRunner = readHookRunner(value);
    if (flag === "--target") hookTarget = readHookTarget(value);
    if (flag === "--targets") setupTargets = readSetupTargets(value);
    if (flag === "--include") setupIncludes = mergeSetupIncludes(setupIncludes, value);
    if (flag === "--name") importName = value;
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
      if (!isImportProvider(value)) {
        throw new Error("skillset: expected --from claude, codex, agents, or skillset");
      }
      importProvider = value;
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
  });

  validateHookFlags(command, {
    agentRuntime: hookAgentRuntime,
    ...(buildMode === undefined ? {} : { buildMode }),
    ...(changeSince === undefined ? {} : { changeSince }),
    ...(distDir === undefined ? {} : { distDir }),
    dryRun,
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
    global: setupGlobal,
    ...(setupIncludes === undefined ? {} : { includes: setupIncludes }),
    ...(importPath === undefined ? {} : { path: importPath }),
    ...(setupTargets === undefined ? {} : { targets: setupTargets }),
  });

  validateCiFlags(command, {
    dryRun,
    fix: ciFix,
    ...(ciReportPath === undefined ? {} : { reportPath: ciReportPath }),
    ...(changeSince === undefined ? {} : { since: changeSince }),
    yes,
  });

  validateAdoptFlags(command, {
    ...(buildMode === undefined ? {} : { buildMode }),
    ...(scopes === undefined ? {} : { scopes }),
  });

  validateIsolatedFlag(command, isolated);

  if (command === "release" && scopes !== undefined) {
    throw new Error("skillset: --scope is not supported with release commands yet");
  }
  validateTestFlags(command, {
    ...(buildMode === undefined ? {} : { buildMode }),
    ...(distDir === undefined ? {} : { distDir }),
    dryRun,
    ...(scopes === undefined ? {} : { scopes }),
    yes,
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
    ...(ciReportPath === undefined ? {} : { ciReportPath }),
    dryRun,
    hookAgentRuntime,
    hookPreCommit,
    hookPrePush,
    ...(hookRunner === undefined ? {} : { hookRunner }),
    ...(hookSubcommand === undefined ? {} : { hookSubcommand }),
    ...(hookTarget === undefined ? {} : { hookTarget }),
    ...(importKind === undefined ? {} : { importKind }),
    ...(importName === undefined ? {} : { importName }),
    ...(importPath === undefined ? {} : { importPath }),
    ...(importProvider === undefined ? {} : { importProvider }),
    options,
    ...(releaseSubcommand === undefined ? {} : { releaseSubcommand }),
    rootExplicit,
    rootPath: resolve(rootPath),
    setupGlobal,
    ...(setupIncludes === undefined ? {} : { setupIncludes }),
    ...(setupTargets === undefined ? {} : { setupTargets }),
    ...(testName === undefined ? {} : { testName }),
    yes,
  };
}

function isReleaseSubcommand(value: string | undefined): value is ReleaseSubcommand {
  return value === "apply" || value === "plan";
}

function isChangeSubcommand(value: string | undefined): value is ChangeSubcommand {
  return value === "add" ||
    value === "check" ||
    value === "history" ||
    value === "list" ||
    value === "reason" ||
    value === "show" ||
    value === "status";
}

function readChangeScopes(value: string): readonly string[] {
  const scopes = value.split(",").map((scope) => scope.trim()).filter((scope) => scope.length > 0);
  if (scopes.length === 0) throw new Error("skillset: --scope requires at least one source unit scope");
  return scopes.map(sourceUnitSelector);
}

function readChangeBump(value: string): ChangeBump {
  if (value === "major" || value === "minor" || value === "none" || value === "patch") return value;
  throw new Error("skillset: expected --bump major, minor, patch, or none");
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

  const allowed = {
    append: subcommand === "reason",
    bump: subcommand === "add",
    group: subcommand === "add" || subcommand === "list",
    reason: subcommand === "add" || subcommand === "reason",
    ref: subcommand === "check" || subcommand === "history" || subcommand === "reason" || subcommand === "show",
    scopes: subcommand === "add",
    staged: subcommand === "check" || subcommand === "status",
  };
  if (change.append && !allowed.append) throw new Error("skillset: --append is only supported with change reason");
  if (change.bump !== undefined && !allowed.bump) throw new Error("skillset: --bump is only supported with change add");
  if (change.group !== undefined && !allowed.group) throw new Error("skillset: --group is only supported with change add or change list");
  if (change.reason !== undefined && !allowed.reason) throw new Error("skillset: --reason and --reason-file are only supported with change add or change reason");
  if (change.ref !== undefined && !allowed.ref) throw new Error("skillset: --ref is only supported with change check, change history, change reason, or change show");
  if (change.scopes !== undefined && !allowed.scopes) throw new Error("skillset: source-unit --scope is only supported with change add");
  if (change.staged && !allowed.staged) throw new Error("skillset: --staged is only supported with change status or change check");
}

function validateHookFlags(
  command: Command,
  hooks: {
    readonly agentRuntime: boolean;
    readonly buildMode?: CompileBuildMode;
    readonly changeSince?: string;
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
    readonly subcommand?: HookPrintSubcommand;
    readonly target?: TargetName;
    readonly yes: boolean;
  }
): void {
  const hasHookFlag =
    hooks.agentRuntime ||
    hooks.preCommit ||
    hooks.prePush ||
    hooks.runner !== undefined ||
    hooks.target !== undefined;
  if (hasHookFlag && command !== "hooks") {
    throw new Error("skillset: hook options are only supported with hooks print");
  }
  if (command !== "hooks") return;
  if (hooks.subcommand !== "print") throw new Error("skillset: expected hooks subcommand print");
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
    throw new Error("skillset: non-hook options are not supported with hooks print");
  }
}

function validateTestFlags(
  command: Command,
  test: {
    readonly buildMode?: CompileBuildMode;
    readonly distDir?: string;
    readonly dryRun: boolean;
    readonly scopes?: readonly BuildScope[];
    readonly yes: boolean;
  }
): void {
  if (command !== "test") return;
  if (
    test.buildMode !== undefined ||
    test.distDir !== undefined ||
    test.dryRun ||
    test.scopes !== undefined ||
    test.yes
  ) {
    throw new Error("skillset: build/write options are not supported with test; test output always writes under .skillset/build/tests");
  }
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

function mergeSetupIncludes(
  current: readonly SetupInclude[] | undefined,
  value: string
): readonly SetupInclude[] {
  const includes = value.split(",").map((item) => item.trim()).filter((item) => item.length > 0);
  if (includes.length === 0) throw new Error("skillset: --include requires at least one value");
  const seen = new Set<SetupInclude>(current ?? []);
  for (const include of includes) {
    if (include !== "agents" && include !== "ci") {
      throw new Error("skillset: expected --include agents, ci, or a comma-separated combination");
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
    if (target !== "claude" && target !== "codex") {
      throw new Error("skillset: expected --targets claude, codex, or claude,codex");
    }
    seen.add(target);
  }
  return [...seen];
}

function validateIsolatedFlag(command: Command, isolated: boolean): void {
  if (!isolated) return;
  if (command === "build" || command === "check" || command === "diff") return;
  throw new Error("skillset: --isolated is only supported with build, check, or diff");
}

function validateCiFlags(
  command: Command,
  ci: {
    readonly dryRun: boolean;
    readonly fix: boolean;
    readonly reportPath?: string;
    readonly since?: string;
    readonly yes: boolean;
  }
): void {
  if (command !== "ci") {
    if (ci.fix) throw new Error("skillset: --fix is only supported with ci");
    if (ci.reportPath !== undefined) throw new Error("skillset: --report is only supported with ci");
    if (ci.since !== undefined && command !== "change" && command !== "hooks") {
      throw new Error("skillset: --since is only supported with ci or change commands");
    }
    return;
  }
  if (ci.yes || ci.dryRun) {
    throw new Error("skillset: ci does not take --yes or --dry-run; use --fix to rebuild stale generated output");
  }
}

function validateSetupFlags(
  command: Command,
  setup: {
    readonly global: boolean;
    readonly includes?: readonly SetupInclude[];
    readonly path?: string;
    readonly targets?: readonly TargetName[];
  }
): void {
  if ((command === "init" || command === "create") && setup.global && command !== "create") {
    throw new Error("skillset: --global is only supported with create");
  }
  if (command === "create" && setup.global && setup.path !== undefined) {
    throw new Error("skillset: create accepts either a path or --global, not both");
  }
  if (command === "adopt") {
    if (setup.global) throw new Error("skillset: --global is not supported with adopt");
    if (setup.includes !== undefined) throw new Error("skillset: --include is not supported with adopt");
    return;
  }
  const hasSetupFlag = setup.global ||
    setup.includes !== undefined ||
    setup.targets !== undefined;
  if (hasSetupFlag && command !== "init" && command !== "create") {
    throw new Error("skillset: setup options are only supported with init or create");
  }
}

function validateAdoptFlags(
  command: Command,
  adopt: {
    readonly buildMode?: CompileBuildMode;
    readonly scopes?: readonly BuildScope[];
  }
): void {
  if (command !== "adopt") return;
  if (adopt.buildMode !== undefined || adopt.scopes !== undefined) {
    throw new Error(
      "skillset: build mode and scope flags are not supported with adopt; adoption always builds the full projection isolated"
    );
  }
}

function isImportKind(value: string): value is ImportKind {
  return value === "skill" || value === "skills" || value === "plugin" || value === "plugins";
}

function isImportProvider(value: string): value is ImportProvider {
  return value === "agents" || value === "claude" || value === "codex" || value === "skillset";
}
