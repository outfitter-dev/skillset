import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  executeRuntimeTesterRun,
  listRuntimeTesterRuns,
  readRuntimeTesterStatus,
  startRuntimeTesterRun,
  tailRuntimeTesterRun,
  type RuntimeTesterClaudeSettingSources,
  type RuntimeTesterListEntry,
  type RuntimeTesterRunReport,
  type RuntimeTesterState,
  type RuntimeTesterStatus,
  type RuntimeTesterSubcommand,
  type RuntimeTesterTailLine,
} from "./runtime-tester";
import { renderValidatedJson } from "@skillset/core/internal/structured-output";
import type { BuildScope, CompileBuildMode, JsonRecord, SkillsetOptions, TargetName } from "@skillset/core/internal/types";

export interface RuntimeTesterCommandOptions {
  readonly background: boolean;
  readonly claudeSettingSources?: RuntimeTesterClaudeSettingSources;
  readonly json: boolean;
  readonly lines?: number;
  readonly name?: string;
  readonly plugins: readonly string[];
  readonly prompt?: string;
  readonly promptFile?: string;
  readonly runId?: string;
  readonly skillsetOptions: SkillsetOptions;
  readonly subcommand?: RuntimeTesterSubcommand;
  readonly target?: TargetName;
  readonly timeoutMs?: number;
}

export async function runRuntimeTesterCommand(rootPath: string, options: RuntimeTesterCommandOptions): Promise<void> {
  if (options.subcommand === "run") {
    const report = await startRuntimeTesterRun(rootPath, {
      ...options.skillsetOptions,
      background: options.background,
      ...(options.claudeSettingSources === undefined ? {} : { claudeSettingSources: options.claudeSettingSources }),
      ...(options.name === undefined ? {} : { name: options.name }),
      plugins: options.plugins,
      prompt: await readRuntimeTesterPrompt(rootPath, options.prompt, options.promptFile),
      target: requireRuntimeTesterTarget(options.target),
      ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    });
    if (options.json) console.log(renderValidatedJson(report as unknown as JsonRecord, "runtime tester run"));
    else printRuntimeTesterRun(report);
    if (!report.ok) process.exitCode = 1;
    return;
  }
  if (options.subcommand === "worker") {
    if (options.runId === undefined) throw new Error("skillset: runtime-tester worker requires run id");
    await executeRuntimeTesterRun(rootPath, options.runId);
    return;
  }
  if (options.subcommand === "status") {
    const status = await readRuntimeTesterStatus(rootPath, options.runId);
    if (options.json) console.log(renderValidatedJson(status as unknown as JsonRecord, "runtime tester status"));
    else printRuntimeTesterStatus(status);
    if (status.state === "failed") process.exitCode = 1;
    return;
  }
  if (options.subcommand === "tail") {
    const lines = await tailRuntimeTesterRun(rootPath, options.runId, options.lines ?? 40);
    if (options.json) console.log(renderValidatedJson({ lines: lines.map((line) => ({ ...line })), schemaVersion: 1 }, "runtime tester tail"));
    else printRuntimeTesterTail(lines);
    return;
  }
  if (options.subcommand === "list") {
    const entries = await listRuntimeTesterRuns(rootPath);
    if (options.json) console.log(renderValidatedJson({ runs: entries.map((entry) => ({ ...entry })), schemaVersion: 1 }, "runtime tester list"));
    else printRuntimeTesterList(entries);
    return;
  }
}

export function isRuntimeTesterSubcommand(value: string | undefined): value is RuntimeTesterSubcommand {
  return value === "list" || value === "run" || value === "status" || value === "tail" || value === "worker";
}

export function validateRuntimeTesterFlags(
  command: string,
  subcommand: RuntimeTesterSubcommand | undefined,
  runtime: {
    readonly background: boolean;
    readonly buildMode?: CompileBuildMode;
    readonly claudeSettingSources?: RuntimeTesterClaudeSettingSources;
    readonly distDir?: string;
    readonly dryRun: boolean;
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
  if (hasRuntimeFlag && command !== "runtime-tester") {
    throw new Error("skillset: runtime tester options are only supported with runtime-tester");
  }
  if (command !== "runtime-tester") return;
  if (subcommand === undefined) throw new Error("skillset: expected runtime-tester subcommand");
  if (runtime.buildMode !== undefined || runtime.distDir !== undefined || runtime.dryRun || runtime.scopes !== undefined || runtime.yes) {
    throw new Error("skillset: build/write options are not supported with runtime-tester; runtime tester builds an isolated projection under logical .skillset/cache/runtime-tester");
  }
  if (subcommand === "run") {
    if (runtime.target === undefined) throw new Error("skillset: runtime-tester run requires --target claude, codex, or cursor");
    if ((runtime.prompt === undefined && runtime.promptFile === undefined) || (runtime.prompt !== undefined && runtime.promptFile !== undefined)) {
      throw new Error("skillset: runtime-tester run requires exactly one of --prompt or --prompt-file");
    }
    return;
  }
  if (runtime.background || runtime.claudeSettingSources !== undefined || runtime.name !== undefined || runtime.plugins.length > 0 || runtime.prompt !== undefined || runtime.promptFile !== undefined || runtime.target !== undefined || runtime.timeoutMs !== undefined) {
    throw new Error(`skillset: runtime tester run options are not supported with ${subcommand}`);
  }
  if (runtime.lines !== undefined && subcommand !== "tail") {
    throw new Error("skillset: --lines is only supported with runtime-tester tail");
  }
}

async function readRuntimeTesterPrompt(
  rootPath: string,
  prompt: string | undefined,
  promptFile: string | undefined
): Promise<string> {
  if (prompt !== undefined) return prompt;
  if (promptFile === undefined) throw new Error("skillset: runtime-tester run requires --prompt or --prompt-file");
  return readFile(resolve(rootPath, promptFile), "utf8");
}

function requireRuntimeTesterTarget(target: TargetName | undefined): TargetName {
  if (target === undefined) throw new Error("skillset: runtime-tester run requires --target claude, codex, or cursor");
  return target;
}

function printRuntimeTesterRun(report: RuntimeTesterRunReport): void {
  console.log(`skillset: runtime tester ${formatRuntimeTesterState(report.state)}${report.background ? " in background" : ""}`);
  console.log(`  run: ${report.runPath}`);
  console.log(`  latest: ${report.latestPath}`);
  console.log(`  status: ${report.statusPath}`);
  console.log(`  tail: ${report.tailPath}`);
  console.log(`  report: ${report.reportPath}`);
}

function printRuntimeTesterStatus(status: RuntimeTesterStatus): void {
  console.log(`skillset: runtime tester ${status.runId} ${formatRuntimeTesterState(status.state)}`);
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

function printRuntimeTesterTail(lines: readonly RuntimeTesterTailLine[]): void {
  for (const line of lines) {
    const prefix = line.timestamp.length === 0 ? line.stream : `${line.timestamp} ${line.stream}`;
    process.stdout.write(`${prefix}: ${line.message.endsWith("\n") ? line.message : `${line.message}\n`}`);
  }
}

function printRuntimeTesterList(entries: readonly RuntimeTesterListEntry[]): void {
  if (entries.length === 0) {
    console.log("skillset: no runtime tester runs");
    return;
  }
  for (const entry of entries) {
    const ended = entry.endedAt === undefined ? "" : ` ended ${entry.endedAt}`;
    console.log(`${entry.runId} ${entry.target} ${formatRuntimeTesterState(entry.state)} started ${entry.startedAt}${ended} ${entry.name}`);
  }
}

function formatRuntimeTesterState(state: RuntimeTesterState): string {
  return state;
}
