import { join } from "node:path";

import { compareStrings } from "@skillset/core/internal/path";
import { pluginTargetRoot } from "@skillset/core/internal/plugin-output";
import type { BuildGraph, TargetName } from "@skillset/core/internal/types";

import type { ClaudeSettingSources } from "./cli-arg-values";
import { runProviderCommand } from "./provider-command";

const ISOLATED_CLAUDE_SETTING_SOURCES_ARG = "";
const CLAUDE_SETTING_SOURCES_DISPLAY = '""';

export interface RuntimeProbeCommand {
  readonly adapterId: string;
  readonly cmd: readonly string[];
  readonly cwd: string;
  readonly display: readonly string[];
  readonly versionCmd: readonly string[];
}

export interface RuntimeProbeCommandOptions {
  readonly claudeSettingSources?: ClaudeSettingSources;
  readonly finalMessagePath: string;
  readonly plugins?: readonly string[];
  readonly prompt?: string;
  readonly target: TargetName;
}

export interface RuntimeProbeExecutionOptions {
  readonly captureVersion?: boolean;
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
  readonly adapterId: string;
  readonly binaryVersion?: string;
  readonly exitCode: number;
  readonly timedOut: boolean;
}

const RUNTIME_PROBE_ADAPTER_VERSION = 1;
const MAX_RUNTIME_VERSION_BYTES = 512;

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
      "stream-json",
      "--verbose",
      "--setting-sources",
      settingSourcesArg,
      "--no-session-persistence",
      "--permission-mode",
      "dontAsk",
      ...pluginArgs,
      ...(options.prompt === undefined ? [] : [options.prompt]),
    ];
    return {
      adapterId: runtimeProbeAdapterId(options.target),
      cmd,
      cwd: workspacePath,
      display: cmd.map((arg) =>
        arg === ISOLATED_CLAUDE_SETTING_SOURCES_ARG
          ? CLAUDE_SETTING_SOURCES_DISPLAY
          : arg
      ),
      versionCmd: [bin, "--version"],
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
    return {
      adapterId: runtimeProbeAdapterId(options.target),
      cmd,
      cwd: workspacePath,
      display: cmd,
      versionCmd: [bin, "--version"],
    };
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
  return {
    adapterId: runtimeProbeAdapterId(options.target),
    cmd,
    cwd: workspacePath,
    display: cmd,
    versionCmd: [bin, "--version"],
  };
}

export async function runRuntimeProbe(
  command: RuntimeProbeCommand,
  prompt: string,
  options: RuntimeProbeExecutionOptions
): Promise<RuntimeProbeExecutionResult> {
  const binaryVersion =
    options.captureVersion === true
      ? await readRuntimeProbeBinaryVersion(command, options)
      : undefined;
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
  return {
    adapterId: command.adapterId,
    ...(binaryVersion === undefined ? {} : { binaryVersion }),
    exitCode: result.exitCode,
    timedOut: result.timedOut,
  };
}

export function runtimeProbeAdapterId(target: TargetName): string {
  return `skillset.runtime-probe@${RUNTIME_PROBE_ADAPTER_VERSION}:${target}`;
}

async function readRuntimeProbeBinaryVersion(
  command: RuntimeProbeCommand,
  options: RuntimeProbeExecutionOptions
): Promise<string | undefined> {
  try {
    const result = await runProviderCommand(
      { cmd: command.versionCmd, cwd: command.cwd },
      {
        env: options.env,
        maxStderrBytes: 0,
        maxStdoutBytes: MAX_RUNTIME_VERSION_BYTES,
        ...(options.signal === undefined ? {} : { signal: options.signal }),
        timeoutMs: options.timeoutMs,
      }
    );
    if (
      result.exitCode !== 0 ||
      result.timedOut ||
      result.stdoutTruncated
    ) {
      return undefined;
    }
    const line = result.stdout.split(/\r?\n/u)[0]?.trim();
    if (
      line === undefined ||
      line.length === 0 ||
      line.length > 160 ||
      !/^[A-Za-z0-9][A-Za-z0-9 .()+_-]*$/u.test(line) ||
      /\b(?:api[-_ ]?key|credential|password|secret|token)\b/iu.test(line)
    ) {
      return undefined;
    }
    return line;
  } catch {
    return undefined;
  }
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
