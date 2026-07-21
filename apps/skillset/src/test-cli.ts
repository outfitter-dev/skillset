import type {
  SkillsetOptions,
  TargetName,
} from "@skillset/core/internal/types";

import { printCliJsonData } from "./cli-output";
import {
  createInteractiveSession,
  type InteractiveSession,
} from "./interactive-session";
import { resolveInteractiveTestSelection } from "./test-interactive";
import { runAllSkillsetTests, runSkillsetTest } from "./test-runner";
import type { SkillsetTestReport } from "./test-runner";
import type { AdHocTestClaudeSettingSources, AdHocTestSubcommand } from "./ad-hoc-test";
import { runAdHocTestCommand, validateAdHocTestFlags } from "./ad-hoc-test-cli";

export interface TestCommandRequest {
  readonly jsonOutput: boolean;
  readonly options: SkillsetOptions;
  readonly rootPath: string;
  readonly testName: string | undefined;
  readonly adHocBackground: boolean;
  readonly adHocClaudeSettingSources: AdHocTestClaudeSettingSources | undefined;
  readonly adHocLines: number | undefined;
  readonly adHocName: string | undefined;
  readonly adHocPlugins: readonly string[];
  readonly adHocPrompt: string | undefined;
  readonly adHocPromptFile: string | undefined;
  readonly adHocRunId: string | undefined;
  readonly adHocSubcommand: AdHocTestSubcommand | undefined;
  readonly adHocTarget: TargetName | undefined;
  readonly adHocTimeoutMs: number | undefined;
}

export interface TestCommandContext {
  readonly interactiveSession?: InteractiveSession;
}

export async function runTestCommand(
  request: TestCommandRequest,
  context: TestCommandContext = {}
): Promise<void> {
  const {
    jsonOutput,
    options,
    rootPath,
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
  } = request;
  const interactiveSession =
    context.interactiveSession ??
    createInteractiveSession({
      machineMode: jsonOutput,
      rawProtocol: adHocSubcommand === "worker",
    });
  if (interactiveSession !== undefined && isBareTestRequest(request)) {
    interactiveSession.banner();
    const selection = await resolveInteractiveTestSelection(
      { options, rootPath },
      interactiveSession
    );
    if (selection.kind === "all") {
      const suite = await runAllSkillsetTests(rootPath, options);
      for (const report of suite.reports) printSkillsetTest(report);
      const passed = suite.reports.filter((report) => report.ok).length;
      console.log(
        `skillset: test all ${suite.ok ? "passed" : "failed"} (${passed}/${suite.reports.length} passed)`
      );
      if (!suite.ok) process.exitCode = 1;
      return;
    }
    if (selection.kind === "declared") {
      await runDeclaredTest(rootPath, selection.name, options);
      return;
    }
    validateAdHocTestFlags("test", undefined, {
      background: selection.background,
      plugins: [],
      prompt: selection.prompt,
      target: selection.target,
      yes: false,
    });
    await runAdHocTestCommand(rootPath, {
      background: selection.background,
      json: false,
      plugins: [],
      prompt: selection.prompt,
      skillsetOptions: options,
      target: selection.target,
    });
    return;
  }
  if (adHocSubcommand !== undefined || adHocTarget !== undefined) {
    await runAdHocTestCommand(rootPath, {
      background: adHocBackground,
      ...(adHocClaudeSettingSources === undefined
        ? {}
        : { claudeSettingSources: adHocClaudeSettingSources }),
      json: jsonOutput,
      ...(adHocLines === undefined ? {} : { lines: adHocLines }),
      ...(adHocName === undefined ? {} : { name: adHocName }),
      plugins: adHocPlugins,
      ...(adHocPrompt === undefined ? {} : { prompt: adHocPrompt }),
      ...(adHocPromptFile === undefined ? {} : { promptFile: adHocPromptFile }),
      ...(adHocRunId === undefined ? {} : { runId: adHocRunId }),
      skillsetOptions: options,
      ...(adHocSubcommand === undefined ? {} : { subcommand: adHocSubcommand }),
      ...(adHocTarget === undefined ? {} : { target: adHocTarget }),
      ...(adHocTimeoutMs === undefined ? {} : { timeoutMs: adHocTimeoutMs }),
    });
    return;
  }
  const report = await runSkillsetTest(rootPath, testName, options);
  if (jsonOutput) {
    printCliJsonData("test", report, report.ok ? 0 : 1, "test");
  } else {
    printSkillsetTest(report);
  }
  if (!report.ok) {
    process.exitCode = 1;
  }
  return;
}

function isBareTestRequest(request: TestCommandRequest): boolean {
  return (
    !request.jsonOutput &&
    request.testName === undefined &&
    !request.adHocBackground &&
    request.adHocClaudeSettingSources === undefined &&
    request.adHocLines === undefined &&
    request.adHocName === undefined &&
    request.adHocPlugins.length === 0 &&
    request.adHocPrompt === undefined &&
    request.adHocPromptFile === undefined &&
    request.adHocRunId === undefined &&
    request.adHocSubcommand === undefined &&
    request.adHocTarget === undefined &&
    request.adHocTimeoutMs === undefined
  );
}

async function runDeclaredTest(
  rootPath: string,
  name: string,
  options: SkillsetOptions
): Promise<void> {
  const report = await runSkillsetTest(rootPath, name, options);
  printSkillsetTest(report);
  if (!report.ok) process.exitCode = 1;
}

function printSkillsetTest(report: SkillsetTestReport): void {
  for (const check of report.checks) {
    const marker = check.ok ? "pass" : "fail";
    const path = check.path === undefined ? "" : ` ${check.path}`;
    const detail = check.detail === undefined ? "" : ` (${check.detail})`;
    console.log(`  ${marker}: ${check.kind}${path}${detail}`);
  }
  console.log(
    `skillset: test ${report.name} ${report.ok ? "passed" : "failed"}`
  );
  console.log(`  run: ${report.runPath}`);
  console.log(`  latest: ${report.latestPath}`);
  console.log(`  report: ${report.reportPath}`);
  console.log(`  selection: ${formatTestSelection(report.selection)}`);
  console.log(`  generated files: ${report.generatedFiles}`);
  console.log(`  activation probes: ${report.activationProbes}`);
  if (report.activationPath !== undefined) {
    console.log(`  activation: ${report.activationPath}`);
  }
  console.log(`  runtime tests: ${report.runtimeTests.length}`);
  for (const runtimeTest of report.runtimeTests) {
    const failure =
      runtimeTest.failureClass === undefined
        ? ""
        : ` (${runtimeTest.failureClass})`;
    const detail =
      runtimeTest.detail === undefined ? "" : ` - ${runtimeTest.detail}`;
    console.log(
      `  ${runtimeTest.ok ? "pass" : "fail"}: runtime ${runtimeTest.name} [${runtimeTest.target}]${failure}${detail}`
    );
    if (runtimeTest.outputPath !== undefined) {
      console.log(`    output: ${runtimeTest.outputPath}`);
    }
  }
}

function formatTestSelection(
  selection: SkillsetTestReport["selection"]
): string {
  const parts = [
    selection.agents.length === 0
      ? undefined
      : `agents ${selection.agents.join(", ")}`,
    selection.plugins.length === 0
      ? undefined
      : `plugins ${selection.plugins.join(", ")}`,
    selection.primarySkills.length === 0
      ? undefined
      : `primary skills ${selection.primarySkills.join(", ")}`,
    selection.pluginSkills.length === 0
      ? undefined
      : `plugin skills ${selection.pluginSkills.join(", ")}`,
  ].filter((part): part is string => part !== undefined);
  return parts.length === 0 ? "none" : parts.join("; ");
}
