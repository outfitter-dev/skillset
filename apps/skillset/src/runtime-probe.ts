import { join } from "node:path";

import { pluginTargetRoot } from "@skillset/core/internal/plugin-output";
import type { BuildGraph, TargetName } from "@skillset/core/internal/types";
import { compareStrings } from "@skillset/core/internal/path";

import type { ClaudeSettingSources } from "./cli-arg-values";

const ISOLATED_CLAUDE_SETTING_SOURCES_ARG = "";
const CLAUDE_SETTING_SOURCES_DISPLAY = "\"\"";
const PROCESS_CLEANUP_GRACE_MS = 250;

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
  readonly onOutput?: (stream: "stderr" | "stdout", text: string) => Promise<void>;
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
    const pluginArgs = runtimeProbePluginDirs(graph, workspacePath, options.target, options.plugins ?? []).flatMap((pluginDir) => [
      "--plugin-dir",
      pluginDir,
    ]);
    const settingSourcesArg = options.claudeSettingSources === "isolated" || options.claudeSettingSources === undefined
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
      display: cmd.map((arg) => arg === ISOLATED_CLAUDE_SETTING_SOURCES_ARG ? CLAUDE_SETTING_SOURCES_DISPLAY : arg),
    };
  }

  if (options.target === "cursor") {
    const bin = env.SKILLSET_TEST_CURSOR_BIN ?? "cursor-agent";
    const pluginArgs = runtimeProbePluginDirs(graph, workspacePath, options.target, options.plugins ?? []).flatMap((pluginDir) => [
      "--plugin-dir",
      pluginDir,
    ]);
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
  if (isAborted(options.signal)) throw abortError();
  const proc = Bun.spawn([...command.cmd], {
    cwd: command.cwd,
    // Bun creates a new POSIX session/process group and a detached Windows process.
    detached: true,
    env: cleanEnv(options.env),
    stderr: "pipe",
    stdin: "pipe",
    stdout: "pipe",
    windowsHide: true,
  });
  let termination: Promise<void> | undefined;
  const scheduleTermination = (): Promise<void> => {
    if (termination !== undefined) return termination;
    termination = terminateRuntimeProbe(proc);
    void termination.catch(() => undefined);
    return termination;
  };
  const abort = () => { void scheduleTermination(); };
  options.signal?.addEventListener("abort", abort, { once: true });
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let completed = false;
  try {
    await throwIfAborted(options.signal, scheduleTermination);
    await options.onProcess?.(proc.pid);
    await throwIfAborted(options.signal, scheduleTermination);
    proc.stdin.write(prompt);
    proc.stdin.end();
    timer = options.timeoutMs <= 0
      ? undefined
      : setTimeout(() => {
        timedOut = true;
        void scheduleTermination();
      }, options.timeoutMs);
    const [exitCode] = await Promise.all([
      proc.exited,
      collectRuntimeProbeStream("stdout", proc.stdout, options.onOutput),
      collectRuntimeProbeStream("stderr", proc.stderr, options.onOutput),
    ]);
    if (termination !== undefined) await termination;
    if (isAborted(options.signal)) throw abortError();
    completed = true;
    return { exitCode, timedOut };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    options.signal?.removeEventListener("abort", abort);
    if (!completed) await scheduleTermination();
  }
}

async function throwIfAborted(signal: AbortSignal | undefined, terminate: () => Promise<void>): Promise<void> {
  if (!isAborted(signal)) return;
  await terminate();
  throw abortError();
}

async function terminateRuntimeProbe(proc: ReturnType<typeof Bun.spawn>): Promise<void> {
  signalRuntimeProbeTree(proc, "SIGTERM");
  if (await runtimeProbeTreeExitsWithin(proc, PROCESS_CLEANUP_GRACE_MS)) return;
  signalRuntimeProbeTree(proc, "SIGKILL");
  if (!await runtimeProbeTreeExitsWithin(proc, PROCESS_CLEANUP_GRACE_MS)) {
    throw new Error(`skillset: provider process tree ${proc.pid} did not terminate`);
  }
}

async function runtimeProbeTreeExitsWithin(proc: ReturnType<typeof Bun.spawn>, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (runtimeProbeTreeExists(proc.pid)) {
    if (Date.now() >= deadline) return false;
    await Bun.sleep(5);
  }
  await proc.exited;
  return true;
}

function runtimeProbeTreeExists(pid: number): boolean {
  const target = process.platform === "win32" ? pid : -pid;
  try {
    process.kill(target, 0);
    return true;
  } catch (error) {
    return !isMissingProcessError(error);
  }
}

function signalRuntimeProbeTree(proc: ReturnType<typeof Bun.spawn>, signal: "SIGKILL" | "SIGTERM"): void {
  if (process.platform === "win32") {
    // Windows has no POSIX process-group signals; taskkill owns descendant traversal.
    Bun.spawnSync(["taskkill", "/PID", String(proc.pid), "/T", "/F"], {
      stderr: "ignore",
      stdout: "ignore",
    });
    return;
  }
  try {
    process.kill(-proc.pid, signal);
  } catch {
    proc.kill(signal);
  }
}

function isMissingProcessError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ESRCH";
}

function runtimeProbePluginDirs(
  graph: BuildGraph,
  workspacePath: string,
  target: "claude" | "cursor",
  plugins: readonly string[]
): readonly string[] {
  const selected = plugins.length === 0 ? graph.plugins.map((plugin) => plugin.id) : plugins;
  const enabled = new Set(graph.plugins.filter((plugin) => plugin.targets[target].enabled).map((plugin) => plugin.id));
  return selected
    .filter((plugin) => enabled.has(plugin))
    .sort(compareStrings)
    .map((plugin) => join(workspacePath, pluginTargetRoot(graph.root.outputs.plugins[target], target, plugin)));
}

async function collectRuntimeProbeStream(
  streamName: "stderr" | "stdout",
  stream: ReadableStream<Uint8Array>,
  onOutput: RuntimeProbeExecutionOptions["onOutput"]
): Promise<void> {
  const decoder = new TextDecoder();
  for await (const chunk of stream) {
    const text = decoder.decode(chunk);
    if (text.length > 0) await onOutput?.(streamName, text);
  }
}

function cleanEnv(env: Record<string, string | undefined>): Record<string, string> {
  return Object.fromEntries(Object.entries(env).filter((entry): entry is [string, string] => entry[1] !== undefined));
}

function abortError(): Error {
  return new DOMException("Runtime probe cancelled", "AbortError");
}

function isAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted ?? false;
}
