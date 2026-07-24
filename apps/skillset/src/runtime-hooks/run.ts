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
}

export interface HookRunResult {
  readonly context: HookRuntimeContext;
  readonly event: HookRunEvent;
  readonly exitCode: number;
  readonly ranCommands: readonly string[];
  readonly sourceChanged: boolean;
  readonly sourceGateOk: boolean;
}

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
}): HookRunResult {
  return {
    context: args.context,
    event: args.event,
    exitCode: args.exitCode,
    ranCommands: args.ranCommands,
    sourceChanged: args.gate.changed,
    sourceGateOk: args.gate.ok,
  };
}
