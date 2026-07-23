import { listSkillEvals } from "@skillset/core";
import type { SkillsetOptions } from "@skillset/core/internal/types";

import { runFiniteCommand, type FiniteCommandWriter } from "./cli-finite-command";
import { readSkillsetEvalStatus, runSkillsetEvals, tailSkillsetEvalRun } from "./eval-runner";
import { withProcessSignalAbort } from "./process-signals";

export type EvalCommandRequest =
  | { readonly jsonOutput: boolean; readonly options: SkillsetOptions; readonly rootPath: string; readonly subcommand: "list" }
  | { readonly jsonOutput: boolean; readonly options: SkillsetOptions; readonly rootPath: string; readonly subcommand: "run"; readonly timeoutMs?: number }
  | { readonly jsonOutput: boolean; readonly options: SkillsetOptions; readonly rootPath: string; readonly runId?: string; readonly subcommand: "status" }
  | { readonly jsonOutput: boolean; readonly lines?: number; readonly options: SkillsetOptions; readonly rootPath: string; readonly runId?: string; readonly subcommand: "tail" };

export async function runEvalCommand(request: EvalCommandRequest): Promise<void> {
  if (request.subcommand === "run") {
    return runFiniteCommand({
      execute: () => withProcessSignalAbort((signal) => runSkillsetEvals(request.rootPath, {
        ...request.options,
        signal,
        ...(request.timeoutMs === undefined ? {} : { timeoutMs: request.timeoutMs }),
      })),
      exitCode: (report) => report.state === "completed" ? 0 : 1,
      json: (report) => ({ command: "eval run", data: report, kind: "eval" }),
      jsonOutput: request.jsonOutput,
      renderHuman: (report, writer) => renderEvalRun(report, writer),
    });
  }
  if (request.subcommand === "status") {
    return runFiniteCommand({
      execute: () => readSkillsetEvalStatus(request.rootPath, request.runId, request.options),
      exitCode: (status) => status.state === "failed" ? 1 : 0,
      json: (status) => ({ command: "eval status", data: status, kind: "eval" }),
      jsonOutput: request.jsonOutput,
      renderHuman: (status, writer) => {
        writer.stdout.write(`skillset: eval ${status.runId} ${status.state}\n`);
        writer.stdout.write(`  run: ${status.runPath}\n  report: ${status.reportPath}\n  workspace: ${status.workspacePath}\n`);
      },
    });
  }
  if (request.subcommand === "tail") {
    return runFiniteCommand({
      execute: () => tailSkillsetEvalRun(request.rootPath, request.runId, request.lines ?? 40, request.options),
      exitCode: () => 0,
      json: (lines) => ({ command: "eval tail", data: { lines }, kind: "eval" }),
      jsonOutput: request.jsonOutput,
      renderHuman: (lines, writer) => {
        for (const line of lines) writer.stdout.write(`${JSON.stringify(line)}\n`);
      },
    });
  }
  return runFiniteCommand({
    execute: () => listSkillEvals(request.rootPath, request.options),
    exitCode: () => 0,
    json: (entries) => ({ command: "eval list", data: { entries } }),
    jsonOutput: request.jsonOutput,
    renderHuman: renderEvalList,
  });
}

function renderEvalRun(
  report: Awaited<ReturnType<typeof runSkillsetEvals>>,
  writer: FiniteCommandWriter
): void {
  writer.stdout.write(`skillset: eval ${report.state}\n`);
  writer.stdout.write(`  run: ${report.runPath}\n  workspace: ${report.workspacePath}\n  report: ${report.reportPath}\n`);
  for (const trial of report.trials) {
    const failure = trial.failureClass === undefined ? "" : ` (${trial.failureClass})`;
    writer.stdout.write(`  ${trial.owner.kind === "plugin" ? `${trial.owner.plugin}/` : ""}${trial.skill} #${trial.evalId} [${trial.target}] ${trial.classification}${failure}\n`);
  }
}

function renderEvalList(
  entries: Awaited<ReturnType<typeof listSkillEvals>>,
  writer: FiniteCommandWriter
): void {
  if (entries.length === 0) {
    writer.stdout.write("skillset: no skill eval cases found\n");
    return;
  }
  for (const entry of entries) {
    writer.stdout.write(`  ${entry.skill} #${entry.evalId} [${entry.target}]\n`);
    writer.stdout.write(`    eval: ${entry.evalPath}\n`);
    writer.stdout.write(`    prompt: ${entry.prompt}\n`);
  }
  writer.stdout.write(`skillset: listed ${entries.length} eval case-target entr${entries.length === 1 ? "y" : "ies"}\n`);
}
