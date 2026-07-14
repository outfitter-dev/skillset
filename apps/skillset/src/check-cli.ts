import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import {
  createOperationalPathContext,
  isRepoOperationalCachePath,
  resolveOperationalPath,
  verifySkillsetResult,
} from "@skillset/core";
import { loadBuildGraph } from "@skillset/core/internal/resolver";
import type { SkillsetOptions } from "@skillset/core/internal/types";
import type { SkillsetCliDiagnostic } from "@skillset/schema";

import { ciSkillset, hasDrift, renderCiReportMarkdown } from "./ci";
import type { CiReport } from "./ci";
import { serializeDiagnostics } from "./cli-diagnostics";
import { rememberKnownSkillsetWorkspace } from "./cli-known-workspaces";
import { printCliJsonData } from "./cli-output";
import {
  printDiagnostics,
  printGeneratedChangelogDriftHint,
  printGeneratedChangelogPathHint,
} from "./cli-renderers";

export interface CheckCommandRequest {
  readonly changeSince: string | undefined;
  readonly checkOnly: "outputs" | undefined;
  readonly checkWrite: boolean;
  readonly ciFix: boolean;
  readonly ciMode: boolean;
  readonly ciReportPath: string | undefined;
  readonly jsonOutput: boolean;
  readonly options: SkillsetOptions;
  readonly rootPath: string;
}

export async function runCheckCommand({
  changeSince,
  checkOnly,
  checkWrite,
  ciFix,
  ciMode,
  ciReportPath,
  jsonOutput,
  options,
  rootPath,
}: CheckCommandRequest): Promise<void> {
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
      console.log(
        `skillset: checked ${result.data.checkedFiles} generated files`
      );
      if (!result.ok) {
        for (const failure of result.data.failures) {
          console.error(failure);
        }
        process.exitCode = 1;
      }
    }
    return;
  }
  const report = await ciSkillset(rootPath, {
    ...options,
    ci: ciMode,
    ...(checkWrite || ciFix ? { fix: true } : {}),
    ...(changeSince === undefined ? {} : { since: changeSince }),
  });
  if (ciReportPath !== undefined) {
    const reportPath = await resolveCliReportPath(
      rootPath,
      ciReportPath,
      options
    );
    await mkdir(dirname(reportPath), { recursive: true });
    await writeFile(reportPath, renderCiReportMarkdown(report));
  }
  if (jsonOutput) {
    printCliJsonData(
      "check",
      report,
      report.ok ? 0 : 1,
      "diagnostics",
      ciReportDiagnostics(report)
    );
  } else {
    printCiReport(report);
  }
  if (!report.ok) {
    process.exitCode = 1;
  } else if (!ciMode && !jsonOutput) {
    await rememberKnownSkillsetWorkspace(rootPath, options);
  }
  return;
}

function ciReportDiagnostics(
  report: CiReport
): readonly SkillsetCliDiagnostic[] {
  const diagnostics: SkillsetCliDiagnostic[] = [
    ...serializeDiagnostics(report.outputDiagnostics),
    ...report.lintIssues.map((issue) => ({
      code: issue.code,
      message: issue.message,
      ...(issue.path === undefined ? {} : { path: issue.path }),
      severity:
        issue.severity === "warn" ? ("warning" as const) : ("error" as const),
    })),
    ...report.changeIssues.map((issue) => ({
      code: issue.code,
      message: issue.message,
      ...(issue.path === undefined ? {} : { path: issue.path }),
      severity: issue.severity,
    })),
    ...report.warnings.map((message) => ({
      code: "source-warning",
      message,
      severity: "warning" as const,
    })),
  ];
  for (const [code, message] of [
    ["check-build-error", report.buildError],
    ["check-change-error", report.changeError],
    ["check-changeset-error", report.changesetError],
  ] as const) {
    if (message !== undefined) {
      diagnostics.push({ code, message, severity: "error" });
    }
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

function printCiReport(report: CiReport): void {
  printDiagnostics(report.outputDiagnostics);
  for (const warning of report.warnings) {
    console.log(`  warning: ${warning}`);
  }
  for (const issue of report.lintIssues) {
    console.log(
      `  lint ${issue.severity}: ${issue.path}: ${issue.code}: ${issue.message}`
    );
  }
  if (report.changeError !== undefined) {
    console.log(`  change check error: ${report.changeError}`);
  }
  for (const issue of report.changeIssues) {
    const path = issue.path === undefined ? "" : `${issue.path}: `;
    console.log(
      `  change ${issue.severity}: ${path}${issue.code}: ${issue.message}`
    );
  }
  if (report.changesetError !== undefined) {
    console.log(`  changeset error: ${report.changesetError}`);
  }
  for (const issue of report.changesetIssues ?? []) {
    console.log(`  changeset error: ${issue}`);
  }
  for (const path of report.fixedPaths) {
    console.log(`  fixed ${path}`);
  }
  for (const path of report.outputEditedPaths) {
    console.log(`  target-side generated edit ${path}`);
  }
  for (const path of report.providerUpdatePaths) {
    console.log(`  provider-format update ${path} (run skillset update)`);
  }
  printGeneratedChangelogPathHint(report.fixedPaths);
  const { drift } = report;
  for (const path of drift.added) {
    console.log(`  generated + ${path}`);
  }
  for (const path of drift.changed) {
    console.log(`  generated ~ ${path}`);
  }
  for (const path of drift.missing) {
    console.log(`  generated ! ${path}`);
  }
  for (const path of drift.removed) {
    console.log(`  generated - ${path}`);
  }
  printGeneratedChangelogDriftHint(drift);
  for (const suggestion of report.sourceSuggestions ?? []) {
    console.log(
      `  reconcile output ${suggestion.status}: ${suggestion.generatedPath}`
    );
    if (suggestion.sourcePath !== undefined) {
      console.log(`    source: ${suggestion.sourcePath}`);
    }
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
  const changeErrors = report.changeIssues.filter(
    (issue) => issue.severity === "error"
  ).length;
  const lintErrors = report.lintIssues.filter(
    (issue) => issue.severity === "error"
  ).length;
  const problems: string[] = [];
  if (lintErrors > 0) {
    problems.push(`${lintErrors} lint issue(s)`);
  }
  if (report.changeError !== undefined) {
    problems.push("a change check error");
  }
  if (changeErrors > 0) {
    problems.push(`${changeErrors} change entry error(s)`);
  }
  if (report.changesetError !== undefined) {
    problems.push("a Changesets check error");
  }
  if ((report.changesetIssues ?? []).length > 0) {
    problems.push(`${report.changesetIssues?.length} Changesets issue(s)`);
  }
  if (report.outputEditedPaths.length > 0) {
    problems.push(
      `${report.outputEditedPaths.length} target-side generated edit(s) to reconcile`
    );
  }
  if (report.providerUpdatePaths.length > 0) {
    problems.push(
      `${report.providerUpdatePaths.length} provider-format update(s)`
    );
  }
  const outputErrors = report.outputDiagnostics.filter(
    (diagnostic) => diagnostic.severity === "error"
  ).length;
  if (outputErrors > 0) {
    problems.push(`${outputErrors} generated-output diagnostic(s)`);
  }
  if (hasDrift(report.drift)) {
    problems.push(
      "generated-output drift (run skillset check --write, or check --ci --fix in CI)"
    );
  }
  if (report.buildError !== undefined) {
    problems.push("a build error");
  }
  console.log(`skillset: check found ${problems.join(" and ")}`);
}

async function resolveCliReportPath(
  rootPath: string,
  reportPath: string,
  options: SkillsetOptions
): Promise<string> {
  if (!isRepoOperationalCachePath(reportPath)) {
    return resolve(reportPath);
  }
  const graph = await loadBuildGraph(rootPath, options);
  return resolveOperationalPath(
    createOperationalPathContext(
      rootPath,
      graph.root.workspace.cacheKey === undefined
        ? {}
        : { workspaceCacheKey: graph.root.workspace.cacheKey }
    ),
    reportPath
  );
}
