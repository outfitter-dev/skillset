import type {
  SkillsetOptions,
  TargetName,
} from "@skillset/core/internal/types";

import { printCliJsonData } from "./cli-output";
import { runSkillsetTest } from "./test-runner";
import type { SkillsetTestReport } from "./test-runner";
import type { TryClaudeSettingSources, TrySubcommand } from "./try";
import { runTryCommand } from "./try-cli";

export interface TestCommandRequest {
  readonly jsonOutput: boolean;
  readonly options: SkillsetOptions;
  readonly rootPath: string;
  readonly testName: string | undefined;
  readonly tryBackground: boolean;
  readonly tryClaudeSettingSources: TryClaudeSettingSources | undefined;
  readonly tryLines: number | undefined;
  readonly tryName: string | undefined;
  readonly tryPlugins: readonly string[];
  readonly tryPrompt: string | undefined;
  readonly tryPromptFile: string | undefined;
  readonly tryRunId: string | undefined;
  readonly trySubcommand: TrySubcommand | undefined;
  readonly tryTarget: TargetName | undefined;
  readonly tryTimeoutMs: number | undefined;
}

export async function runTestCommand({
  jsonOutput,
  options,
  rootPath,
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
}: TestCommandRequest): Promise<void> {
  if (trySubcommand !== undefined || tryTarget !== undefined) {
    await runTryCommand(rootPath, {
      background: tryBackground,
      ...(tryClaudeSettingSources === undefined
        ? {}
        : { claudeSettingSources: tryClaudeSettingSources }),
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
