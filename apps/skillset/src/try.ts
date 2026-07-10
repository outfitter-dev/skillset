import { appendFile, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { spawn as spawnNode } from "node:child_process";
import { join, resolve } from "node:path";

import {
  buildSkillset,
  ISOLATED_OUT_ROOT,
} from "@skillset/core";

import { compareStrings } from "@skillset/core/internal/path";
import { pluginTargetRoot } from "@skillset/core/internal/plugin-output";
import {
  makeRetainedRunId,
  readRetainedRunLatest,
  resolveRetainedRunPath,
  retainedRunRootPaths,
  retainedRunPaths,
  writeRetainedRunLatest,
  type RetainedRunPaths,
} from "./retained-runs";
import { isTargetName } from "@skillset/core/internal/config";
import { loadBuildGraph } from "@skillset/core/internal/resolver";
import { renderValidatedJson } from "@skillset/core/internal/structured-output";
import type { BuildGraph, JsonRecord, SkillsetOptions, TargetName } from "@skillset/core/internal/types";

export type TrySubcommand = "list" | "status" | "tail" | "worker";
export type TryState = "building" | "failed" | "passed" | "queued" | "running";
export type TryClaudeSettingSources = "isolated" | "local" | "project" | "user";

export interface TryRunOptions extends SkillsetOptions {
  readonly background?: boolean;
  readonly claudeSettingSources?: TryClaudeSettingSources;
  readonly env?: Record<string, string | undefined>;
  readonly name?: string;
  readonly plugins?: readonly string[];
  readonly prompt: string;
  readonly target: TargetName;
  readonly timeoutMs?: number;
}

export interface TryStatus {
  readonly command?: readonly string[];
  readonly endedAt?: string;
  readonly error?: string;
  readonly exitCode?: number;
  readonly finalMessagePath?: string;
  readonly latestRoot: string;
  readonly name: string;
  readonly outputPath: string;
  readonly pid?: number;
  readonly promptPath: string;
  readonly reportPath: string;
  readonly runId: string;
  readonly runPath: string;
  readonly schemaVersion: 1;
  readonly startedAt: string;
  readonly state: TryState;
  readonly target: TargetName;
  readonly timeoutMs: number;
  readonly updatedAt: string;
}

export interface TryRunReport {
  readonly background: boolean;
  readonly latestPath: string;
  readonly ok: boolean;
  readonly reportPath: string;
  readonly runId: string;
  readonly runPath: string;
  readonly state: TryState;
  readonly statusPath: string;
  readonly tailPath: string;
}

export interface TryListEntry {
  readonly endedAt?: string;
  readonly name: string;
  readonly runId: string;
  readonly runPath: string;
  readonly startedAt: string;
  readonly state: TryState;
  readonly target: TargetName;
}

export interface TryTailLine {
  readonly message: string;
  readonly stream: string;
  readonly timestamp: string;
}

interface TryRunPaths {
  readonly retained: RetainedRunPaths;
  readonly absolute: {
    readonly finalMessagePath: string;
    readonly latestJsonPath: string;
    readonly outputPath: string;
    readonly promptPath: string;
    readonly reportPath: string;
    readonly runPath: string;
    readonly runsRoot: string;
    readonly statusPath: string;
  };
  readonly logical: {
    readonly finalMessagePath: string;
    readonly latestJsonPath: string;
    readonly outputPath: string;
    readonly promptPath: string;
    readonly reportPath: string;
    readonly runPath: string;
    readonly statusPath: string;
  };
}

interface TryStoredConfig {
  readonly claudeSettingSources?: TryClaudeSettingSources;
  readonly name: string;
  readonly plugins: readonly string[];
  readonly prompt: string;
  readonly sourceDir?: string;
  readonly target: TargetName;
  readonly timeoutMs: number;
}

const RUNTIME_TEST_ROOT = ".skillset/cache/runtime-tests";
const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_CLAUDE_SETTING_SOURCES: TryClaudeSettingSources = "isolated";
const TRY_CLAUDE_SETTING_SOURCES_ENV = "SKILLSET_TRY_CLAUDE_SETTING_SOURCES";
// Empty --setting-sources keeps Claude probes independent from user/project/local settings while preserving env auth and explicit --plugin-dir inputs.
const ISOLATED_CLAUDE_SETTING_SOURCES_ARG = "";
const CLAUDE_SETTING_SOURCES_DISPLAY = "\"\"";

export async function startTryRun(
  rootPath: string,
  options: TryRunOptions
): Promise<TryRunReport> {
  const root = resolve(rootPath);
  const graph = await loadBuildGraph(root, options);
  if (!graph.root.targets[options.target].enabled) {
    throw new Error(`skillset: try target ${options.target} is not enabled by root target configuration`);
  }
  const name = options.name ?? `try-${options.target}`;
  const plugins = validateTryPlugins(graph, options.target, options.plugins ?? []);
  const runId = makeRetainedRunId(name, { fallbackName: "try", includeName: true });
  const paths = tryPaths(root, graph, runId, options.xdg);
  await mkdir(paths.absolute.runPath, { recursive: true });

  const config: TryStoredConfig = {
    ...(options.target === "claude" ? { claudeSettingSources: resolveClaudeSettingSources(options) } : {}),
    name,
    plugins,
    prompt: options.prompt,
    ...(options.sourceDir === undefined ? {} : { sourceDir: options.sourceDir }),
    target: options.target,
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  };
  await writeFile(
    join(paths.absolute.runPath, "config.json"),
    renderValidatedJson(config as unknown as JsonRecord, join(paths.logical.runPath, "config.json")),
    "utf8"
  );
  await writeFile(paths.absolute.promptPath, options.prompt, "utf8");
  await writeStatus(paths, {
    latestRoot: ISOLATED_OUT_ROOT,
    name,
    outputPath: paths.logical.outputPath,
    promptPath: paths.logical.promptPath,
    reportPath: paths.logical.reportPath,
    runId,
    runPath: paths.logical.runPath,
    schemaVersion: 1,
    startedAt: new Date().toISOString(),
    state: "queued",
    target: options.target,
    timeoutMs: config.timeoutMs,
    updatedAt: new Date().toISOString(),
  });
  await writeLatest(paths, runId);

  if (options.background === true) {
    const pid = spawnTryWorker(root, runId);
    const status = await readStatus(paths.absolute.statusPath);
    await writeStatus(paths, {
      ...status,
      ...(pid === undefined ? {} : { pid }),
      state: "queued",
      updatedAt: new Date().toISOString(),
    });
    return runReport(paths, runId, "queued", true);
  }

  await executeTryRun(root, runId, options.env, options.xdg);
  const status = await readStatus(paths.absolute.statusPath);
  return runReport(paths, runId, status.state, false);
}

export async function executeTryRun(
  rootPath: string,
  runId: string,
  env: Record<string, string | undefined> = process.env,
  xdg: SkillsetOptions["xdg"] = undefined
): Promise<void> {
  const root = resolve(rootPath);
  const paths = tryPaths(root, await loadBuildGraph(root, xdg === undefined ? {} : { xdg }), runId, xdg);
  const config = await readConfig(join(paths.absolute.runPath, "config.json"));
  const target = config.target;
  const runOptions: SkillsetOptions = {
    buildMode: "all",
    isolated: true,
    ...(config.sourceDir === undefined ? {} : { sourceDir: config.sourceDir }),
    targetFilter: [target],
    ...(xdg === undefined ? {} : { xdg }),
  };

  let status = await readStatus(paths.absolute.statusPath);
  await appendEvent(paths, "status", "building isolated target output");
  status = await updateRunState(paths, status, "building");
  try {
    await buildSkillset(root, runOptions);
  } catch (error) {
    await failRun(paths, status, messageFor(error));
    return;
  }

  const graph = await loadBuildGraph(root, runOptions);
  const command = runtimeCommand(root, graph, paths, config, env, xdg);
  await appendEvent(paths, "status", `running ${target} non-interactive prompt`);
  status = await updateRunState(paths, status, "running", { command: command.display });
  const result = await runCommand(command, config.prompt, paths, config.timeoutMs, env);
  const finalMessage = await readOptional(paths.absolute.finalMessagePath);
  const report: JsonRecord = {
    command: [...command.display],
    endedAt: new Date().toISOString(),
    exitCode: result.exitCode,
    finalMessage,
    name: config.name,
    ok: result.exitCode === 0 && !result.timedOut,
    runId,
    schemaVersion: 1,
    state: result.exitCode === 0 && !result.timedOut ? "passed" : "failed",
    target,
    timedOut: result.timedOut,
  };
  await writeFile(paths.absolute.reportPath, renderValidatedJson(report, paths.logical.reportPath), "utf8");
  const nextState: TryState = report.ok === true ? "passed" : "failed";
  await writeStatus(paths, {
    ...status,
    endedAt: String(report.endedAt),
    exitCode: result.exitCode,
    finalMessagePath: paths.logical.finalMessagePath,
    reportPath: paths.logical.reportPath,
    state: nextState,
    updatedAt: new Date().toISOString(),
    ...(result.timedOut ? { error: `try command timed out after ${config.timeoutMs}ms` } : {}),
  });
  await appendEvent(paths, "status", `try ${nextState}`);
}

export async function readTryStatus(
  rootPath: string,
  runId?: string,
  options: Pick<SkillsetOptions, "xdg"> = {}
): Promise<TryStatus> {
  const root = resolve(rootPath);
  const graph = await loadBuildGraph(root, options);
  const resolvedRunId = runId ?? await readLatestRunId(root, graph, options.xdg);
  const paths = tryPaths(root, graph, resolvedRunId, options.xdg);
  return readStatus(paths.absolute.statusPath);
}

export async function listTryRuns(
  rootPath: string,
  options: Pick<SkillsetOptions, "xdg"> = {}
): Promise<readonly TryListEntry[]> {
  const root = resolve(rootPath);
  const graph = await loadBuildGraph(root, options);
  const runsRoot = retainedRunRootPaths(root, graph, RUNTIME_TEST_ROOT, options.xdg).absolute.runsRoot;
  if (!await pathExists(runsRoot)) return [];
  const entries = await readdir(runsRoot, { withFileTypes: true });
  const runs: TryListEntry[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      const status = await readStatus(join(runsRoot, entry.name, "status.json"));
      runs.push({
        ...(status.endedAt === undefined ? {} : { endedAt: status.endedAt }),
        name: status.name,
        runId: status.runId,
        runPath: status.runPath,
        startedAt: status.startedAt,
        state: status.state,
        target: status.target,
      });
    } catch {
      // Ignore incomplete run directories; status is the durable record.
    }
  }
  return runs.sort((left, right) => compareStrings(right.startedAt, left.startedAt));
}

export async function tailTryRun(
  rootPath: string,
  runId: string | undefined,
  lines: number,
  options: Pick<SkillsetOptions, "xdg"> = {}
): Promise<readonly TryTailLine[]> {
  const root = resolve(rootPath);
  const graph = await loadBuildGraph(root, options);
  const resolvedRunId = runId ?? await readLatestRunId(root, graph, options.xdg);
  const paths = tryPaths(root, graph, resolvedRunId, options.xdg);
  const raw = await readOptional(paths.absolute.outputPath);
  if (raw === undefined) return [];
  return raw
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .slice(-Math.max(0, lines))
    .map(parseTailLine);
}

function runtimeCommand(
  rootPath: string,
  graph: BuildGraph,
  paths: TryRunPaths,
  config: TryStoredConfig,
  env: Record<string, string | undefined>,
  xdg: SkillsetOptions["xdg"]
): { readonly cmd: readonly string[]; readonly cwd: string; readonly display: readonly string[] } {
  const latestRoot = resolveRetainedRunPath(rootPath, graph, ISOLATED_OUT_ROOT, xdg);
  if (config.target === "claude") {
    const bin = env.SKILLSET_TRY_CLAUDE_BIN ?? "claude";
    const pluginArgs = tryPluginDirs(graph, latestRoot, config.target, config.plugins).flatMap((pluginDir) => [
      "--plugin-dir",
      pluginDir,
    ]);
    const settingSourcesArg = claudeSettingSourcesArg(config.claudeSettingSources ?? DEFAULT_CLAUDE_SETTING_SOURCES);
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
      config.prompt,
    ];
    return {
      cmd,
      cwd: latestRoot,
      display: cmd.map((arg) => arg === ISOLATED_CLAUDE_SETTING_SOURCES_ARG ? CLAUDE_SETTING_SOURCES_DISPLAY : arg),
    };
  }

  if (config.target === "cursor") {
    const bin = env.SKILLSET_TRY_CURSOR_BIN ?? "cursor-agent";
    const pluginArgs = tryPluginDirs(graph, latestRoot, config.target, config.plugins).flatMap((pluginDir) => [
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
      latestRoot,
      ...pluginArgs,
      config.prompt,
    ];
    return { cmd, cwd: latestRoot, display: cmd };
  }

  const bin = env.SKILLSET_TRY_CODEX_BIN ?? "codex";
  const cmd = [
    bin,
    "exec",
    "--cd",
    latestRoot,
    "--ephemeral",
    "--ignore-user-config",
    "--json",
    "--skip-git-repo-check",
    "--output-last-message",
    paths.absolute.finalMessagePath,
    "-",
  ];
  return { cmd, cwd: latestRoot, display: cmd };
}

function resolveClaudeSettingSources(options: TryRunOptions): TryClaudeSettingSources {
  const env = options.env ?? process.env;
  return options.claudeSettingSources ??
    readClaudeSettingSources(env[TRY_CLAUDE_SETTING_SOURCES_ENV], TRY_CLAUDE_SETTING_SOURCES_ENV) ??
    DEFAULT_CLAUDE_SETTING_SOURCES;
}

function claudeSettingSourcesArg(value: TryClaudeSettingSources): string {
  return value === "isolated" ? ISOLATED_CLAUDE_SETTING_SOURCES_ARG : value;
}

export function readClaudeSettingSources(
  value: string | undefined,
  label: string
): TryClaudeSettingSources | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim();
  if (normalized === "isolated" || normalized === "user" || normalized === "project" || normalized === "local") {
    return normalized;
  }
  throw new Error(`skillset: expected ${label} to be isolated, user, project, or local`);
}

function tryPluginDirs(
  graph: BuildGraph,
  latestRoot: string,
  target: "claude" | "cursor",
  plugins: readonly string[]
): readonly string[] {
  const selected = plugins.length === 0
    ? graph.plugins.map((plugin) => plugin.id)
    : plugins;
  const enabled = new Set(
    graph.plugins
      .filter((plugin) => plugin.targets[target].enabled)
      .map((plugin) => plugin.id)
  );
  return selected
    .filter((plugin) => enabled.has(plugin))
    .sort(compareStrings)
    .map((plugin) => join(latestRoot, pluginTargetRoot(graph.root.outputs.plugins[target], target, plugin)));
}

function validateTryPlugins(
  graph: BuildGraph,
  target: TargetName,
  plugins: readonly string[]
): readonly string[] {
  if (plugins.length === 0) return [];
  if (target === "codex") {
    throw new Error("skillset: try --plugin is only supported for targets with local plugin-dir support: claude, cursor");
  }
  const seen = new Set<string>();
  const selected: string[] = [];
  const knownPlugins = graph.plugins.map((plugin) => plugin.id).sort(compareStrings);
  for (const pluginId of plugins) {
    if (seen.has(pluginId)) throw new Error(`skillset: duplicate try plugin ${JSON.stringify(pluginId)}`);
    seen.add(pluginId);
    const plugin = graph.plugins.find((candidate) => candidate.id === pluginId);
    if (plugin === undefined) {
      const available = knownPlugins.length === 0 ? "none configured" : knownPlugins.join(", ");
      throw new Error(`skillset: unknown try plugin ${JSON.stringify(pluginId)}; available plugins: ${available}`);
    }
    if (!plugin.targets[target].enabled) {
      throw new Error(`skillset: try plugin ${JSON.stringify(pluginId)} is not enabled for ${target}`);
    }
    selected.push(pluginId);
  }
  return selected.sort(compareStrings);
}

async function runCommand(
  command: { readonly cmd: readonly string[]; readonly cwd: string },
  prompt: string,
  paths: TryRunPaths,
  timeoutMs: number,
  env: Record<string, string | undefined>
): Promise<{ readonly exitCode: number; readonly timedOut: boolean }> {
  const proc = Bun.spawn([...command.cmd], {
    cwd: command.cwd,
    env: cleanEnv(env),
    stderr: "pipe",
    stdin: "pipe",
    stdout: "pipe",
  });
  await appendEvent(paths, "process", `pid ${proc.pid}`);
  proc.stdin.write(prompt);
  proc.stdin.end();
  let timedOut = false;
  const timer = timeoutMs <= 0
    ? undefined
    : setTimeout(() => {
      timedOut = true;
      proc.kill();
    }, timeoutMs);
  const [exitCode] = await Promise.all([
    proc.exited,
    collectStream(paths, "stdout", proc.stdout),
    collectStream(paths, "stderr", proc.stderr),
  ]);
  if (timer !== undefined) clearTimeout(timer);
  return { exitCode, timedOut };
}

async function collectStream(
  paths: TryRunPaths,
  streamName: "stderr" | "stdout",
  stream: ReadableStream<Uint8Array>
): Promise<void> {
  const decoder = new TextDecoder();
  for await (const chunk of stream) {
    const text = decoder.decode(chunk);
    if (text.length === 0) continue;
    await appendEvent(paths, streamName, text);
    await appendFile(join(paths.absolute.runPath, `${streamName}.txt`), text, "utf8");
  }
}

function cleanEnv(env: Record<string, string | undefined>): Record<string, string> {
  const cleaned: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined) cleaned[key] = value;
  }
  return cleaned;
}

function spawnTryWorker(rootPath: string, runId: string): number | undefined {
  const cliPath = process.argv[1];
  if (cliPath === undefined) throw new Error("skillset: try cannot locate CLI entrypoint for background worker");
  const child = spawnNode(process.execPath, [cliPath, "try", "worker", runId, "--root", rootPath], {
    cwd: rootPath,
    detached: true,
    env: process.env,
    stdio: "ignore",
  });
  child.unref();
  return child.pid;
}

function tryPaths(
  rootPath: string,
  graph: BuildGraph,
  runId: string,
  xdg: SkillsetOptions["xdg"] = undefined
): TryRunPaths {
  const retained = retainedRunPaths(rootPath, graph, RUNTIME_TEST_ROOT, runId, xdg);
  return {
    retained,
    absolute: {
      finalMessagePath: join(retained.absolute.runPath, "final-message.txt"),
      latestJsonPath: retained.absolute.latestJsonPath,
      outputPath: join(retained.absolute.runPath, "output.jsonl"),
      promptPath: join(retained.absolute.runPath, "prompt.md"),
      reportPath: join(retained.absolute.runPath, "report.json"),
      runPath: retained.absolute.runPath,
      runsRoot: retained.absolute.runsRoot,
      statusPath: join(retained.absolute.runPath, "status.json"),
    },
    logical: {
      finalMessagePath: join(retained.logical.runPath, "final-message.txt").replaceAll("\\", "/"),
      latestJsonPath: retained.logical.latestJsonPath,
      outputPath: join(retained.logical.runPath, "output.jsonl").replaceAll("\\", "/"),
      promptPath: join(retained.logical.runPath, "prompt.md").replaceAll("\\", "/"),
      reportPath: join(retained.logical.runPath, "report.json").replaceAll("\\", "/"),
      runPath: retained.logical.runPath,
      statusPath: join(retained.logical.runPath, "status.json").replaceAll("\\", "/"),
    },
  };
}

async function updateRunState(
  paths: TryRunPaths,
  status: TryStatus,
  state: TryState,
  updates: Partial<TryStatus> = {}
): Promise<TryStatus> {
  const next = { ...status, ...updates, state, updatedAt: new Date().toISOString() };
  await writeStatus(paths, next);
  return next;
}

async function failRun(
  paths: TryRunPaths,
  status: TryStatus,
  error: string
): Promise<void> {
  const endedAt = new Date().toISOString();
  const report: JsonRecord = {
    endedAt,
    error,
    exitCode: 1,
    name: status.name,
    ok: false,
    runId: status.runId,
    schemaVersion: 1,
    state: "failed",
    target: status.target,
  };
  await writeFile(paths.absolute.reportPath, renderValidatedJson(report, paths.logical.reportPath), "utf8");
  await writeStatus(paths, {
    ...status,
    endedAt,
    error,
    exitCode: 1,
    state: "failed",
    updatedAt: endedAt,
  });
  await appendEvent(paths, "status", `try failed: ${error}`);
}

async function writeStatus(paths: TryRunPaths, status: TryStatus): Promise<void> {
  await mkdir(paths.absolute.runPath, { recursive: true });
  await writeFile(paths.absolute.statusPath, renderValidatedJson(status as unknown as JsonRecord, paths.logical.statusPath), "utf8");
}

async function writeLatest(paths: TryRunPaths, runId: string): Promise<void> {
  await mkdir(paths.absolute.runsRoot, { recursive: true });
  await writeRetainedRunLatest(paths.retained, {
    runId,
    runPath: paths.logical.runPath,
    schemaVersion: 1,
    statusPath: paths.logical.statusPath,
  });
}

async function appendEvent(paths: TryRunPaths, stream: string, message: string): Promise<void> {
  const event = {
    message,
    stream,
    timestamp: new Date().toISOString(),
  };
  await appendFile(paths.absolute.outputPath, `${JSON.stringify(event)}\n`, "utf8");
}

async function readLatestRunId(
  rootPath: string,
  graph: BuildGraph,
  xdg: SkillsetOptions["xdg"] = undefined
): Promise<string> {
  const latest = await readRetainedRunLatest(rootPath, graph, RUNTIME_TEST_ROOT, xdg);
  if (!isRecord(latest) || typeof latest.runId !== "string") {
    throw new Error("skillset: try latest run is malformed");
  }
  return latest.runId;
}

async function readConfig(path: string): Promise<TryStoredConfig> {
  const raw = JSON.parse(await readFile(path, "utf8")) as unknown;
  if (!isRecord(raw)) throw new Error("skillset: try config is malformed");
  if (!isTargetName(raw.target)) throw new Error("skillset: try config target is malformed");
  if (typeof raw.prompt !== "string") throw new Error("skillset: try config prompt is malformed");
  const claudeSettingSources = typeof raw.claudeSettingSources === "string"
    ? readClaudeSettingSources(raw.claudeSettingSources, "try config claudeSettingSources")
    : undefined;
  return {
    ...(claudeSettingSources === undefined ? {} : { claudeSettingSources }),
    name: typeof raw.name === "string" ? raw.name : `runtime-${raw.target}`,
    plugins: Array.isArray(raw.plugins) ? raw.plugins.filter((item): item is string => typeof item === "string") : [],
    prompt: raw.prompt,
    ...(typeof raw.sourceDir === "string" ? { sourceDir: raw.sourceDir } : {}),
    target: raw.target,
    timeoutMs: typeof raw.timeoutMs === "number" && Number.isFinite(raw.timeoutMs) ? raw.timeoutMs : DEFAULT_TIMEOUT_MS,
  };
}

async function readStatus(path: string): Promise<TryStatus> {
  const raw = JSON.parse(await readFile(path, "utf8")) as unknown;
  if (!isRecord(raw) || typeof raw.runId !== "string" || !isTargetName(raw.target)) {
    throw new Error("skillset: try status is malformed");
  }
  return raw as unknown as TryStatus;
}

async function readOptional(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return undefined;
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function parseTailLine(line: string): TryTailLine {
  const parsed = JSON.parse(line) as unknown;
  if (!isRecord(parsed)) return { message: line, stream: "raw", timestamp: "" };
  return {
    message: typeof parsed.message === "string" ? parsed.message : "",
    stream: typeof parsed.stream === "string" ? parsed.stream : "raw",
    timestamp: typeof parsed.timestamp === "string" ? parsed.timestamp : "",
  };
}

function runReport(
  paths: TryRunPaths,
  runId: string,
  state: TryState,
  background: boolean
): TryRunReport {
  return {
    background,
    latestPath: paths.logical.latestJsonPath,
    ok: state === "passed" || background,
    reportPath: paths.logical.reportPath,
    runId,
    runPath: paths.logical.runPath,
    state,
    statusPath: paths.logical.statusPath,
    tailPath: paths.logical.outputPath,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function messageFor(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
