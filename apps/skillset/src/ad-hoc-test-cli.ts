import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { TARGET_LIST_TEXT } from "@skillset/core";
import {
  executeAdHocTestRun,
  listAdHocTestRuns,
  readAdHocTestStatus,
  startAdHocTestRun,
  tailAdHocTestRun,
  type AdHocTestClaudeSettingSources,
  type AdHocTestListEntry,
  type AdHocTestRunReport,
  type AdHocTestState,
  type AdHocTestStatus,
  type AdHocTestSubcommand,
  type AdHocTestTailLine,
} from "./ad-hoc-test";
import type { SchemaJsonRecord } from "@skillset/schema";
import type { BuildScope, CompileBuildMode, SkillsetOptions, TargetName } from "@skillset/core/internal/types";
import { renderCliDataResult } from "./cli-output";

export interface AdHocTestCommandOptions {
  readonly background: boolean;
  readonly claudeSettingSources?: AdHocTestClaudeSettingSources;
  readonly json: boolean;
  readonly lines?: number;
  readonly name?: string;
  readonly plugins: readonly string[];
  readonly prompt?: string;
  readonly promptFile?: string;
  readonly runId?: string;
  readonly skillsetOptions: SkillsetOptions;
  readonly subcommand?: AdHocTestSubcommand;
  readonly target?: TargetName;
  readonly timeoutMs?: number;
}

export async function runAdHocTestCommand(rootPath: string, options: AdHocTestCommandOptions): Promise<void> {
  if (options.subcommand === undefined) {
    const report = await startAdHocTestRun(rootPath, {
      ...options.skillsetOptions,
      background: options.background,
      ...(options.claudeSettingSources === undefined ? {} : { claudeSettingSources: options.claudeSettingSources }),
      ...(options.name === undefined ? {} : { name: options.name }),
      plugins: options.plugins,
      prompt: await readAdHocTestPrompt(rootPath, options.prompt, options.promptFile),
      target: requireAdHocTestTarget(options.target),
      ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    });
    if (options.json) printAdHocTestJson("test", report, report.ok ? 0 : 1);
    else printAdHocTestRun(report);
    if (!report.ok) process.exitCode = 1;
    return;
  }
  if (options.subcommand === "worker") {
    if (options.runId === undefined) throw new Error("skillset: test worker requires run id");
    await executeAdHocTestRun(rootPath, options.runId);
    return;
  }
  if (options.subcommand === "status") {
    const status = await readAdHocTestStatus(rootPath, options.runId);
    if (options.json) printAdHocTestJson("test status", status, status.state === "failed" ? 1 : 0);
    else printAdHocTestStatus(status);
    if (status.state === "failed") process.exitCode = 1;
    return;
  }
  if (options.subcommand === "tail") {
    const lines = await tailAdHocTestRun(rootPath, options.runId, options.lines ?? 40);
    if (options.json) printAdHocTestJson("test tail", { lines: lines.map((line) => ({ ...line })) });
    else printAdHocTestTail(lines);
    return;
  }
  if (options.subcommand === "list") {
    const entries = await listAdHocTestRuns(rootPath);
    if (options.json) printAdHocTestJson("test list", { runs: entries.map((entry) => ({ ...entry })) });
    else printAdHocTestList(entries);
    return;
  }
}

function printAdHocTestJson(command: string, data: unknown, exitCode = 0): void {
  process.stdout.write(renderCliDataResult({
    command,
    data: data as SchemaJsonRecord,
    exitCode,
    kind: "test",
  }));
}

export function isAdHocTestSubcommand(value: string | undefined): value is AdHocTestSubcommand {
  return value === "list" || value === "status" || value === "tail" || value === "worker";
}

export function validateAdHocTestFlags(
  command: string,
  subcommand: AdHocTestSubcommand | undefined,
  runtime: {
    readonly background: boolean;
    readonly buildMode?: CompileBuildMode;
    readonly claudeSettingSources?: AdHocTestClaudeSettingSources;
    readonly distDir?: string;
    readonly lines?: number;
    readonly name?: string;
    readonly plugins: readonly string[];
    readonly prompt?: string;
    readonly promptFile?: string;
    readonly scopes?: readonly BuildScope[];
    readonly target?: TargetName;
    readonly timeoutMs?: number;
    readonly yes: boolean;
  }
): void {
  const hasRuntimeFlag = runtime.background ||
    runtime.claudeSettingSources !== undefined ||
    runtime.lines !== undefined ||
    runtime.name !== undefined ||
    runtime.plugins.length > 0 ||
    runtime.prompt !== undefined ||
    runtime.promptFile !== undefined ||
    runtime.target !== undefined ||
    runtime.timeoutMs !== undefined;
  if (hasRuntimeFlag && command !== "test") {
    throw new Error("skillset: ad hoc test options are only supported with test");
  }
  if (command !== "test") return;
  if (!hasRuntimeFlag && subcommand === undefined) return;
  if (runtime.buildMode !== undefined || runtime.distDir !== undefined || runtime.scopes !== undefined || runtime.yes) {
    throw new Error("skillset: build/write options are not supported with ad hoc test runs; test uses logical .skillset/cache/tests/ad-hoc");
  }
  if (subcommand === undefined) {
    if (runtime.target === undefined) throw new Error(`skillset: ad hoc test requires --target ${TARGET_LIST_TEXT}`);
    if ((runtime.prompt === undefined && runtime.promptFile === undefined) || (runtime.prompt !== undefined && runtime.promptFile !== undefined)) {
      throw new Error("skillset: ad hoc test requires exactly one of --prompt or --prompt-file");
    }
    return;
  }
  if (runtime.background || runtime.claudeSettingSources !== undefined || runtime.name !== undefined || runtime.plugins.length > 0 || runtime.prompt !== undefined || runtime.promptFile !== undefined || runtime.target !== undefined || runtime.timeoutMs !== undefined) {
    throw new Error(`skillset: test execution options are not supported with ${subcommand}`);
  }
  if (runtime.lines !== undefined && subcommand !== "tail") {
    throw new Error("skillset: --lines is only supported with test tail");
  }
}

async function readAdHocTestPrompt(
  rootPath: string,
  prompt: string | undefined,
  promptFile: string | undefined
): Promise<string> {
  if (prompt !== undefined) return prompt;
  if (promptFile === undefined) throw new Error("skillset: ad hoc test requires --prompt or --prompt-file");
  return readFile(resolve(rootPath, promptFile), "utf8");
}

function requireAdHocTestTarget(target: TargetName | undefined): TargetName {
  if (target === undefined) throw new Error(`skillset: ad hoc test requires --target ${TARGET_LIST_TEXT}`);
  return target;
}

function printAdHocTestRun(report: AdHocTestRunReport): void {
  console.log(`skillset: ad hoc test ${formatAdHocTestState(report.state)}${report.background ? " in background" : ""}`);
  console.log(`  run: ${report.runPath}`);
  console.log(`  latest: ${report.latestPath}`);
  console.log(`  status: ${report.statusPath}`);
  console.log(`  tail: ${report.tailPath}`);
  console.log(`  report: ${report.reportPath}`);
}

function printAdHocTestStatus(status: AdHocTestStatus): void {
  console.log(`skillset: test ${status.runId} ${formatAdHocTestState(status.state)}`);
  console.log(`  target: ${status.target}`);
  console.log(`  name: ${status.name}`);
  if (status.pid !== undefined) console.log(`  pid: ${status.pid}`);
  if (status.command !== undefined) console.log(`  command: ${status.command.join(" ")}`);
  if (status.exitCode !== undefined) console.log(`  exit: ${status.exitCode}`);
  if (status.error !== undefined) console.log(`  error: ${status.error}`);
  console.log(`  started: ${status.startedAt}`);
  if (status.endedAt !== undefined) console.log(`  ended: ${status.endedAt}`);
  console.log(`  updated: ${status.updatedAt}`);
  console.log(`  run: ${status.runPath}`);
  console.log(`  latest: ${status.latestRoot}`);
  console.log(`  prompt: ${status.promptPath}`);
  console.log(`  tail: ${status.outputPath}`);
  console.log(`  report: ${status.reportPath}`);
  if (status.finalMessagePath !== undefined) console.log(`  final: ${status.finalMessagePath}`);
}

function printAdHocTestTail(lines: readonly AdHocTestTailLine[]): void {
  for (const line of lines) {
    const prefix = line.timestamp.length === 0 ? line.stream : `${line.timestamp} ${line.stream}`;
    process.stdout.write(`${prefix}: ${line.message.endsWith("\n") ? line.message : `${line.message}\n`}`);
  }
}

function printAdHocTestList(entries: readonly AdHocTestListEntry[]): void {
  if (entries.length === 0) {
    console.log("skillset: no ad hoc test runs");
    return;
  }
  for (const entry of entries) {
    const ended = entry.endedAt === undefined ? "" : ` ended ${entry.endedAt}`;
    console.log(`${entry.runId} ${entry.target} ${formatAdHocTestState(entry.state)} started ${entry.startedAt}${ended} ${entry.name}`);
  }
}

function formatAdHocTestState(state: AdHocTestState): string {
  return state;
}
