import { listSkillEvals } from "@skillset/core";
import type { SkillsetOptions } from "@skillset/core/internal/types";

import { runFiniteCommand, type FiniteCommandWriter } from "./cli-finite-command";

export interface EvalCommandRequest {
  readonly jsonOutput: boolean;
  readonly options: SkillsetOptions;
  readonly rootPath: string;
  readonly subcommand: "list";
}

export async function runEvalCommand(request: EvalCommandRequest): Promise<void> {
  return runFiniteCommand({
    execute: () => listSkillEvals(request.rootPath, request.options),
    exitCode: () => 0,
    json: (entries) => ({ command: "eval list", data: { entries } }),
    jsonOutput: request.jsonOutput,
    renderHuman: renderEvalList,
  });
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
