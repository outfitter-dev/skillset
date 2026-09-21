import {
  verifySkillsetResult,
  type SkillsetVerifyResult,
  type SkillsetWriteSummary,
} from "@skillset/core";

import { readHookRuntimeContext, type HookRuntimeContext } from "./context";
import { readHookRunEvent, type HookRunEvent } from "./events";
import { readHookSourceGate, type HookSourceGateResult } from "./source-gate";
import { runSkillsetCommand, type RunSkillsetCommand } from "./commands";

export interface HookRunOptions {
  readonly commandRunner?: RunSkillsetCommand;
  readonly env?: Record<string, string | undefined>;
  readonly rootPath?: string;
  readonly sourceGate?: (rootPath: string) => Promise<HookSourceGateResult>;
  readonly stderr?: Pick<typeof process.stderr, "write">;
  readonly stdinText?: string;
  readonly verifier?: (rootPath: string) => Promise<SkillsetVerifyResult>;
}

export interface HookRunResult {
  readonly context: HookRuntimeContext;
  readonly event: HookRunEvent;
  readonly exitCode: number;
  readonly output: string;
  readonly ranCommands: readonly string[];
  readonly sourceChanged: boolean;
  readonly sourceGateOk: boolean;
  readonly writes: SkillsetWriteSummary;
}

const EMPTY_READ_SUMMARY: SkillsetWriteSummary = {
  deletedPaths: [],
  mode: "read",
  paths: [],
  writtenPaths: [],
};
const GENERATED_OUTPUT_DRIFT_CODES = new Set([
  "generated-output-changed",
  "generated-output-missing",
  "generated-output-missing-managed",
  "generated-output-removed",
]);
const MAX_CONTEXT_CHARACTERS = 8_000;
// Claude caps the serialized hook output at 10,000 characters; leave headroom.
const MAX_OUTPUT_CHARACTERS = 9_000;
const MAX_STALE_PATHS = 20;

export async function dispatchHookRun(
  eventValue: string | undefined,
  options: HookRunOptions = {}
): Promise<HookRunResult> {
  return runHookEvent(readHookRunEvent(eventValue), options);
}

export async function runHookEvent(
  event: HookRunEvent,
  options: HookRunOptions = {}
): Promise<HookRunResult> {
  const rootPath = options.rootPath ?? process.cwd();
  const context = await readHookRuntimeContext({
    event,
    ...(options.env === undefined ? {} : { env: options.env }),
    rootPath,
    ...(options.stdinText === undefined ? {} : { stdinText: options.stdinText }),
  });
  if (event === "session-start") {
    return runSessionStart(context, rootPath, options);
  }
  const gate = await (options.sourceGate ?? readHookSourceGate)(rootPath);
  const ranCommands: string[] = [];

  if (!gate.ok) {
    if (event === "stop") {
      options.stderr?.write("skillset: hooks run stop could not inspect Skillset source changes\n");
      return result({ context, event, exitCode: gate.exitCode || 1, gate, ranCommands });
    }
    return result({ context, event, exitCode: 0, gate, ranCommands });
  }

  if (!gate.changed) return result({ context, event, exitCode: 0, gate, ranCommands });

  const runner = options.commandRunner ?? runSkillsetCommand;
  if (event === "post-tool-use") {
    const args = ["change", "status", "--root", "."] as const;
    ranCommands.push(args.join(" "));
    await runner(args, commandOptions({ allowFailure: true, options, rootPath }));
    return result({ context, event, exitCode: 0, gate, ranCommands });
  }

  const changeCheckArgs = ["change", "check", "--root", "."] as const;
  ranCommands.push(changeCheckArgs.join(" "));
  const changeCheck = await runner(
    changeCheckArgs,
    commandOptions({
      allowFailure: false,
      options,
      rootPath,
      suppressWorkspaceRegistration: true,
    })
  );
  if (changeCheck !== 0) return result({ context, event, exitCode: changeCheck, gate, ranCommands });

  const checkArgs = ["check", "--root", "."] as const;
  ranCommands.push(checkArgs.join(" "));
  const check = await runner(
    checkArgs,
    commandOptions({
      allowFailure: false,
      options,
      rootPath,
      suppressWorkspaceRegistration: true,
    })
  );
  return result({ context, event, exitCode: check, gate, ranCommands });
}

function commandOptions(args: {
  readonly allowFailure: boolean;
  readonly options: HookRunOptions;
  readonly rootPath: string;
  readonly suppressWorkspaceRegistration?: true;
}) {
  return {
    allowFailure: args.allowFailure,
    ...(args.options.env === undefined ? {} : { env: args.options.env }),
    rootPath: args.rootPath,
    ...(args.suppressWorkspaceRegistration
      ? { suppressWorkspaceRegistration: true as const }
      : {}),
  };
}

function result(args: {
  readonly context: HookRuntimeContext;
  readonly event: HookRunEvent;
  readonly exitCode: number;
  readonly gate: HookSourceGateResult;
  readonly ranCommands: readonly string[];
  readonly output?: string;
  readonly writes?: SkillsetWriteSummary;
}): HookRunResult {
  return {
    context: args.context,
    event: args.event,
    exitCode: args.exitCode,
    output: args.output ?? "",
    ranCommands: args.ranCommands,
    sourceChanged: args.gate.changed,
    sourceGateOk: args.gate.ok,
    writes: args.writes ?? EMPTY_READ_SUMMARY,
  };
}

async function runSessionStart(
  context: HookRuntimeContext,
  rootPath: string,
  options: HookRunOptions
): Promise<HookRunResult> {
  const gate: HookSourceGateResult = {
    changed: false,
    exitCode: 0,
    ok: true,
    paths: [],
    stdout: "",
  };
  try {
    const verification = await (options.verifier ?? verifySkillsetResult)(rootPath);
    const paths = staleOutputPaths(verification);
    if (
      verification.ok ||
      !supportsSessionStartOutput(context.provider) ||
      verification.outputState.state === "blocked" ||
      hasNonDriftErrors(verification) ||
      paths.length === 0
    ) {
      return result({
        context,
        event: "session-start",
        exitCode: 0,
        gate,
        ranCommands: [],
        writes: verification.writes,
      });
    }
    return result({
      context,
      event: "session-start",
      exitCode: 0,
      gate,
      output: renderSessionStartOutput(paths),
      ranCommands: [],
      writes: verification.writes,
    });
  } catch {
    return result({
      context,
      event: "session-start",
      exitCode: 0,
      gate,
      ranCommands: [],
    });
  }
}

function supportsSessionStartOutput(provider: HookRuntimeContext["provider"]): boolean {
  switch (provider) {
    case "claude":
    case "codex":
      return true;
    case "cursor":
    case "unknown":
      return false;
  }
}

function staleOutputPaths(
  verification: Pick<SkillsetVerifyResult, "diagnostics">
): readonly string[] {
  return [...new Set(
    verification.diagnostics.flatMap((diagnostic) =>
      diagnostic.severity === "error" &&
      GENERATED_OUTPUT_DRIFT_CODES.has(diagnostic.code) &&
      diagnostic.outputPath !== undefined
        ? [diagnostic.outputPath]
        : []
    )
  )].sort();
}

function hasNonDriftErrors(
  verification: Pick<SkillsetVerifyResult, "diagnostics">
): boolean {
  return verification.diagnostics.some(
    (diagnostic) =>
      diagnostic.severity === "error" &&
      !GENERATED_OUTPUT_DRIFT_CODES.has(diagnostic.code)
  );
}

function renderSessionStartOutput(paths: readonly string[]): string {
  const guidance = "Run: npx skillset build\nskillset-help";
  const visible = paths.slice(0, MAX_STALE_PATHS);
  while (true) {
    const context = sessionStartContext(visible, paths.length - visible.length, guidance);
    const output = `${JSON.stringify({
      hookSpecificOutput: {
        additionalContext: context,
        hookEventName: "SessionStart",
      },
    })}\n`;
    if (
      (context.length <= MAX_CONTEXT_CHARACTERS && output.length <= MAX_OUTPUT_CHARACTERS) ||
      visible.length === 0
    ) {
      return output;
    }
    visible.pop();
  }
}

function sessionStartContext(
  paths: readonly string[],
  omitted: number,
  guidance: string
): string {
  const lines = ["Skillset generated output is stale."];
  if (paths.length > 0) {
    lines.push("", "Stale paths:", ...paths.map((path) => `- ${path}`));
  }
  if (omitted > 0) lines.push(`... and ${omitted} more.`);
  lines.push("", guidance);
  return lines.join("\n");
}
