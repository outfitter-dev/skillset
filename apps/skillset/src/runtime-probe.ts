import { join } from "node:path";

import { compareStrings } from "@skillset/core/internal/path";
import { pluginTargetRoot } from "@skillset/core/internal/plugin-output";
import type { BuildGraph, TargetName } from "@skillset/core/internal/types";

import type { ClaudeSettingSources } from "./cli-arg-values";
import { runProviderCommand } from "./provider-command";

const ISOLATED_CLAUDE_SETTING_SOURCES_ARG = "";
const CLAUDE_SETTING_SOURCES_DISPLAY = '""';

export interface RuntimeProbeCommand {
  readonly cmd: readonly string[];
  readonly cwd: string;
  readonly display: readonly string[];
}

export interface RuntimeProbeCommandOptions {
  readonly claudeSettingSources?: ClaudeSettingSources;
  readonly finalMessagePath: string;
  readonly plugins?: readonly string[];
  readonly prompt?: string;
  readonly target: TargetName;
}

export interface RuntimeProbeExecutionOptions {
  readonly env: Record<string, string | undefined>;
  readonly onOutput?: (
    stream: "stderr" | "stdout",
    text: string
  ) => Promise<void>;
  readonly onProcess?: (pid: number) => Promise<void>;
  readonly signal?: AbortSignal;
  readonly timeoutMs: number;
}

export interface RuntimeProbeExecutionResult {
  readonly exitCode: number;
  readonly timedOut: boolean;
}

/** Shared target-native process adapter for explicit test and eval probes. */
export function createRuntimeProbeCommand(
  workspacePath: string,
  graph: BuildGraph,
  options: RuntimeProbeCommandOptions,
  env: Record<string, string | undefined>
): RuntimeProbeCommand {
  if (options.target === "claude") {
    const bin = env.SKILLSET_TEST_CLAUDE_BIN ?? "claude";
    const pluginArgs = runtimeProbePluginDirs(
      graph,
      workspacePath,
      options.target,
      options.plugins ?? []
    ).flatMap((pluginDir) => ["--plugin-dir", pluginDir]);
    const settingSourcesArg =
      options.claudeSettingSources === "isolated" ||
      options.claudeSettingSources === undefined
        ? ISOLATED_CLAUDE_SETTING_SOURCES_ARG
        : options.claudeSettingSources;
    const cmd = [
      bin,
      "--print",
      "--output-format",
      "json",
      "--setting-sources",
      settingSourcesArg,
      "--no-session-persistence",
      "--permission-mode",
      "dontAsk",
      ...pluginArgs,
      ...(options.prompt === undefined ? [] : [options.prompt]),
    ];
    return {
      cmd,
      cwd: workspacePath,
      display: cmd.map((arg) =>
        arg === ISOLATED_CLAUDE_SETTING_SOURCES_ARG
          ? CLAUDE_SETTING_SOURCES_DISPLAY
          : arg
      ),
    };
  }

  if (options.target === "cursor") {
    const bin = env.SKILLSET_TEST_CURSOR_BIN ?? "cursor-agent";
    const pluginArgs = runtimeProbePluginDirs(
      graph,
      workspacePath,
      options.target,
      options.plugins ?? []
    ).flatMap((pluginDir) => ["--plugin-dir", pluginDir]);
    const cmd = [
      bin,
      "--print",
      "--output-format",
      "json",
      "--mode",
      "ask",
      "--trust",
      "--workspace",
      workspacePath,
      ...pluginArgs,
      ...(options.prompt === undefined ? [] : [options.prompt]),
    ];
    return { cmd, cwd: workspacePath, display: cmd };
  }

  const bin = env.SKILLSET_TEST_CODEX_BIN ?? "codex";
  const cmd = [
    bin,
    "exec",
    "--cd",
    workspacePath,
    "--ephemeral",
    "--ignore-user-config",
    "--json",
    "--skip-git-repo-check",
    "--output-last-message",
    options.finalMessagePath,
    "-",
  ];
  return { cmd, cwd: workspacePath, display: cmd };
}

export async function runRuntimeProbe(
  command: RuntimeProbeCommand,
  prompt: string,
  options: RuntimeProbeExecutionOptions
): Promise<RuntimeProbeExecutionResult> {
  const result = await runProviderCommand(command, {
    env: options.env,
    maxStderrBytes: 0,
    maxStdoutBytes: 0,
    ...(options.onOutput === undefined ? {} : { onOutput: options.onOutput }),
    ...(options.onProcess === undefined
      ? {}
      : { onProcess: options.onProcess }),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    stdin: prompt,
    timeoutMs: options.timeoutMs,
  });
  return { exitCode: result.exitCode, timedOut: result.timedOut };
}

function runtimeProbePluginDirs(
  graph: BuildGraph,
  workspacePath: string,
  target: "claude" | "cursor",
  plugins: readonly string[]
): readonly string[] {
  const selected =
    plugins.length === 0 ? graph.plugins.map((plugin) => plugin.id) : plugins;
  const enabled = new Set(
    graph.plugins
      .filter((plugin) => plugin.targets[target].enabled)
      .map((plugin) => plugin.id)
  );
  return selected
    .filter((plugin) => enabled.has(plugin))
    .sort(compareStrings)
    .map((plugin) =>
      join(
        workspacePath,
        pluginTargetRoot(graph.root.outputs.plugins[target], target, plugin)
      )
    );
}
