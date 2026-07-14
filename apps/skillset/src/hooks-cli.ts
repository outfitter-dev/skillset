import type { TargetName } from "@skillset/core/internal/types";

import {
  dispatchHookRun,
  readHookStdin,
  renderHookPrint,
  renderHookRuntimeContext,
} from "./runtime-hooks";
import type {
  HookRuntimeContextField,
  HookRuntimeContextFormat,
  HookRunEvent,
  HookRunner,
  HookSubcommand,
} from "./runtime-hooks";

export interface HooksCommandRequest {
  readonly hookAgentRuntime: boolean;
  readonly hookContextEvent: string | undefined;
  readonly hookContextFields: readonly HookRuntimeContextField[] | undefined;
  readonly hookContextFormat: HookRuntimeContextFormat | undefined;
  readonly hookPreCommit: boolean;
  readonly hookPrePush: boolean;
  readonly hookRunner: HookRunner | undefined;
  readonly hookRunEvent: HookRunEvent | undefined;
  readonly hookSubcommand: HookSubcommand | undefined;
  readonly hookTarget: TargetName | undefined;
  readonly rootPath: string;
}

export async function runHooksCommand({
  hookAgentRuntime,
  hookContextEvent,
  hookContextFields,
  hookContextFormat,
  hookPreCommit,
  hookPrePush,
  hookRunner,
  hookRunEvent,
  hookSubcommand,
  hookTarget,
  rootPath,
}: HooksCommandRequest): Promise<void> {
  if (hookSubcommand === "print") {
    process.stdout.write(
      renderHookPrint({
        agentRuntime: hookAgentRuntime,
        preCommit: hookPreCommit,
        prePush: hookPrePush,
        ...(hookRunner === undefined ? {} : { runner: hookRunner }),
        ...(hookTarget === undefined ? {} : { target: hookTarget }),
      })
    );
    return;
  }
  if (hookSubcommand === "run") {
    const stdinText = await readHookStdin();
    const result = await dispatchHookRun(hookRunEvent, {
      rootPath,
      stderr: process.stderr,
      ...(stdinText === undefined ? {} : { stdinText }),
    });
    if (result.exitCode !== 0) {
      process.exitCode = result.exitCode;
    }
    return;
  }
  if (hookSubcommand === "context") {
    if (hookContextEvent === undefined) {
      throw new Error("skillset: hooks context requires --event");
    }
    process.stdout.write(
      await renderHookRuntimeContext({
        event: hookContextEvent,
        ...(hookContextFields === undefined
          ? {}
          : { fields: hookContextFields }),
        format: hookContextFormat ?? "json",
        rootPath,
      })
    );
    return;
  }
  throw new Error("skillset: expected hooks subcommand context, print, or run");
}
