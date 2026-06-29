import { appendFile, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { createHash, randomBytes } from "node:crypto";
import { spawn as spawnNode } from "node:child_process";
import { join, resolve } from "node:path";

import {
  buildSkillset,
  createOperationalPathContext,
  ISOLATED_OUT_ROOT,
  resolveOperationalPath,
} from "@skillset/core";

import { compareStrings } from "./path";
import { loadBuildGraph } from "./resolver";
import { renderValidatedJson } from "./structured-output";
import type { BuildGraph, JsonRecord, SkillsetOptions, TargetName } from "./types";

export type RuntimeTesterSubcommand = "list" | "run" | "status" | "tail" | "worker";
export type RuntimeTesterState = "building" | "failed" | "passed" | "queued" | "running";
export type RuntimeTesterClaudeSettingSources = "isolated" | "local" | "project" | "user";

export interface RuntimeTesterRunOptions extends SkillsetOptions {
  readonly background?: boolean;
  readonly claudeSettingSources?: RuntimeTesterClaudeSettingSources;
  readonly env?: Record<string, string | undefined>;
  readonly name?: string;
  readonly plugins?: readonly string[];
  readonly prompt: string;
  readonly target: TargetName;
  readonly timeoutMs?: number;
}

export interface RuntimeTesterStatus {
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
  readonly state: RuntimeTesterState;
  readonly target: TargetName;
  readonly timeoutMs: number;
  readonly updatedAt: string;
}

export interface RuntimeTesterRunReport {
  readonly background: boolean;
  readonly latestPath: string;
  readonly ok: boolean;
  readonly reportPath: string;
  readonly runId: string;
  readonly runPath: string;
  readonly state: RuntimeTesterState;
  readonly statusPath: string;
  readonly tailPath: string;
}

export interface RuntimeTesterListEntry {
  readonly endedAt?: string;
  readonly name: string;
  readonly runId: string;
  readonly runPath: string;
  readonly startedAt: string;
  readonly state: RuntimeTesterState;
  readonly target: TargetName;
}

export interface RuntimeTesterTailLine {
  readonly message: string;
  readonly stream: string;
  readonly timestamp: string;
}

interface RuntimeTesterRunPaths {
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

interface RuntimeTesterStoredConfig {
  readonly claudeSettingSources?: RuntimeTesterClaudeSettingSources;
  readonly name: string;
  readonly plugins: readonly string[];
  readonly prompt: string;
  readonly sourceDir?: string;
  readonly target: TargetName;
  readonly timeoutMs: number;
}

const RUNTIME_TESTER_ROOT = ".skillset/cache/runtime-tester";
const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_CLAUDE_SETTING_SOURCES: RuntimeTesterClaudeSettingSources = "isolated";
const RUNTIME_TESTER_CLAUDE_SETTING_SOURCES_ENV = "SKILLSET_RUNTIME_TESTER_CLAUDE_SETTING_SOURCES";
// Empty --setting-sources keeps Claude probes independent from user/project/local settings while preserving env auth and explicit --plugin-dir inputs.
const ISOLATED_CLAUDE_SETTING_SOURCES_ARG = "";
const CLAUDE_SETTING_SOURCES_DISPLAY = "\"\"";

export async function startRuntimeTesterRun(
  rootPath: string,
  options: RuntimeTesterRunOptions
): Promise<RuntimeTesterRunReport> {
  const root = resolve(rootPath);
  const graph = await loadBuildGraph(root, options);
  if (!graph.root.targets[options.target].enabled) {
    throw new Error(`skillset: runtime tester target ${options.target} is not enabled by root target configuration`);
  }
  const name = options.name ?? `runtime-${options.target}`;
  const runId = makeRunId(name);
  const paths = runtimeTesterPaths(root, graph, runId, options.xdg);
  await mkdir(paths.absolute.runPath, { recursive: true });

  const config: RuntimeTesterStoredConfig = {
    ...(options.target === "claude" ? { claudeSettingSources: resolveClaudeSettingSources(options) } : {}),
    name,
    plugins: [...(options.plugins ?? [])].sort(compareStrings),
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
    const pid = spawnRuntimeWorker(root, runId);
    const status = await readStatus(paths.absolute.statusPath);
    await writeStatus(paths, {
      ...status,
      ...(pid === undefined ? {} : { pid }),
      state: "queued",
      updatedAt: new Date().toISOString(),
    });
    return runReport(paths, runId, "queued", true);
  }

  await executeRuntimeTesterRun(root, runId, options.env, options.xdg);
  const status = await readStatus(paths.absolute.statusPath);
  return runReport(paths, runId, status.state, false);
}

export async function executeRuntimeTesterRun(
  rootPath: string,
  runId: string,
  env: Record<string, string | undefined> = process.env,
  xdg: SkillsetOptions["xdg"] = undefined
): Promise<void> {
  const root = resolve(rootPath);
  const paths = runtimeTesterPaths(root, await loadBuildGraph(root, xdg === undefined ? {} : { xdg }), runId, xdg);
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
  const nextState: RuntimeTesterState = report.ok === true ? "passed" : "failed";
  await writeStatus(paths, {
    ...status,
    endedAt: String(report.endedAt),
    exitCode: result.exitCode,
    finalMessagePath: paths.logical.finalMessagePath,
    reportPath: paths.logical.reportPath,
    state: nextState,
    updatedAt: new Date().toISOString(),
    ...(result.timedOut ? { error: `runtime tester command timed out after ${config.timeoutMs}ms` } : {}),
  });
  await appendEvent(paths, "status", `runtime tester ${nextState}`);
}

export async function readRuntimeTesterStatus(
  rootPath: string,
  runId?: string,
  options: Pick<SkillsetOptions, "xdg"> = {}
): Promise<RuntimeTesterStatus> {
  const root = resolve(rootPath);
  const graph = await loadBuildGraph(root, options);
  const resolvedRunId = runId ?? await readLatestRunId(root, graph, options.xdg);
  const paths = runtimeTesterPaths(root, graph, resolvedRunId, options.xdg);
  return readStatus(paths.absolute.statusPath);
}

export async function listRuntimeTesterRuns(
  rootPath: string,
  options: Pick<SkillsetOptions, "xdg"> = {}
): Promise<readonly RuntimeTesterListEntry[]> {
  const root = resolve(rootPath);
  const graph = await loadBuildGraph(root, options);
  const context = runtimePathContext(root, graph, options.xdg);
  const runsRoot = resolveOperationalPath(context, join(RUNTIME_TESTER_ROOT, "runs"));
  if (!await pathExists(runsRoot)) return [];
  const entries = await readdir(runsRoot, { withFileTypes: true });
  const runs: RuntimeTesterListEntry[] = [];
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

export async function tailRuntimeTesterRun(
  rootPath: string,
  runId: string | undefined,
  lines: number,
  options: Pick<SkillsetOptions, "xdg"> = {}
): Promise<readonly RuntimeTesterTailLine[]> {
  const root = resolve(rootPath);
  const graph = await loadBuildGraph(root, options);
  const resolvedRunId = runId ?? await readLatestRunId(root, graph, options.xdg);
  const paths = runtimeTesterPaths(root, graph, resolvedRunId, options.xdg);
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
  paths: RuntimeTesterRunPaths,
  config: RuntimeTesterStoredConfig,
  env: Record<string, string | undefined>,
  xdg: SkillsetOptions["xdg"]
): { readonly cmd: readonly string[]; readonly cwd: string; readonly display: readonly string[] } {
  const latestRoot = resolveOperationalPath(runtimePathContext(rootPath, graph, xdg), ISOLATED_OUT_ROOT);
  if (config.target === "claude") {
    const bin = env.SKILLSET_RUNTIME_TESTER_CLAUDE_BIN ?? "claude";
    const pluginArgs = claudePluginDirs(graph, latestRoot, config.plugins).flatMap((pluginDir) => ["--plugin-dir", pluginDir]);
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

  const bin = env.SKILLSET_RUNTIME_TESTER_CODEX_BIN ?? "codex";
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

function resolveClaudeSettingSources(options: RuntimeTesterRunOptions): RuntimeTesterClaudeSettingSources {
  const env = options.env ?? process.env;
  return options.claudeSettingSources ??
    readClaudeSettingSources(env[RUNTIME_TESTER_CLAUDE_SETTING_SOURCES_ENV], RUNTIME_TESTER_CLAUDE_SETTING_SOURCES_ENV) ??
    DEFAULT_CLAUDE_SETTING_SOURCES;
}

function claudeSettingSourcesArg(value: RuntimeTesterClaudeSettingSources): string {
  return value === "isolated" ? ISOLATED_CLAUDE_SETTING_SOURCES_ARG : value;
}

export function readClaudeSettingSources(
  value: string | undefined,
  label: string
): RuntimeTesterClaudeSettingSources | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim();
  if (normalized === "isolated" || normalized === "user" || normalized === "project" || normalized === "local") {
    return normalized;
  }
  throw new Error(`skillset: expected ${label} to be isolated, user, project, or local`);
}

function claudePluginDirs(
  graph: BuildGraph,
  latestRoot: string,
  plugins: readonly string[]
): readonly string[] {
  const selected = plugins.length === 0
    ? graph.plugins.map((plugin) => plugin.id)
    : plugins;
  const enabled = new Set(
    graph.plugins
      .filter((plugin) => plugin.targets.claude.enabled)
      .map((plugin) => plugin.id)
  );
  return selected
    .filter((plugin) => enabled.has(plugin))
    .sort(compareStrings)
    .map((plugin) => join(latestRoot, graph.root.outputs.plugins.claude, "plugins", plugin));
}

async function runCommand(
  command: { readonly cmd: readonly string[]; readonly cwd: string },
  prompt: string,
  paths: RuntimeTesterRunPaths,
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
  paths: RuntimeTesterRunPaths,
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

function spawnRuntimeWorker(rootPath: string, runId: string): number | undefined {
  const cliPath = process.argv[1];
  if (cliPath === undefined) throw new Error("skillset: runtime tester cannot locate CLI entrypoint for background worker");
  const child = spawnNode(process.execPath, [cliPath, "runtime-tester", "worker", runId, "--root", rootPath], {
    cwd: rootPath,
    detached: true,
    env: process.env,
    stdio: "ignore",
  });
  child.unref();
  return child.pid;
}

function runtimeTesterPaths(
  rootPath: string,
  graph: BuildGraph,
  runId: string,
  xdg: SkillsetOptions["xdg"] = undefined
): RuntimeTesterRunPaths {
  const context = runtimePathContext(rootPath, graph, xdg);
  const logicalRunPath = join(RUNTIME_TESTER_ROOT, "runs", runId).replaceAll("\\", "/");
  const absoluteRunPath = resolveOperationalPath(context, logicalRunPath);
  return {
    absolute: {
      finalMessagePath: join(absoluteRunPath, "final-message.txt"),
      latestJsonPath: resolveOperationalPath(context, join(RUNTIME_TESTER_ROOT, "latest.json")),
      outputPath: join(absoluteRunPath, "output.jsonl"),
      promptPath: join(absoluteRunPath, "prompt.md"),
      reportPath: join(absoluteRunPath, "report.json"),
      runPath: absoluteRunPath,
      runsRoot: resolveOperationalPath(context, join(RUNTIME_TESTER_ROOT, "runs")),
      statusPath: join(absoluteRunPath, "status.json"),
    },
    logical: {
      finalMessagePath: join(logicalRunPath, "final-message.txt").replaceAll("\\", "/"),
      latestJsonPath: join(RUNTIME_TESTER_ROOT, "latest.json").replaceAll("\\", "/"),
      outputPath: join(logicalRunPath, "output.jsonl").replaceAll("\\", "/"),
      promptPath: join(logicalRunPath, "prompt.md").replaceAll("\\", "/"),
      reportPath: join(logicalRunPath, "report.json").replaceAll("\\", "/"),
      runPath: logicalRunPath,
      statusPath: join(logicalRunPath, "status.json").replaceAll("\\", "/"),
    },
  };
}

function runtimePathContext(rootPath: string, graph: BuildGraph, xdg: SkillsetOptions["xdg"] = undefined) {
  return createOperationalPathContext(rootPath, {
    ...(graph.root.workspace.cacheKey === undefined ? {} : { workspaceCacheKey: graph.root.workspace.cacheKey }),
    ...(xdg?.env === undefined ? {} : { env: xdg.env }),
    ...(xdg?.homeDir === undefined ? {} : { homeDir: xdg.homeDir }),
  });
}

async function updateRunState(
  paths: RuntimeTesterRunPaths,
  status: RuntimeTesterStatus,
  state: RuntimeTesterState,
  updates: Partial<RuntimeTesterStatus> = {}
): Promise<RuntimeTesterStatus> {
  const next = { ...status, ...updates, state, updatedAt: new Date().toISOString() };
  await writeStatus(paths, next);
  return next;
}

async function failRun(
  paths: RuntimeTesterRunPaths,
  status: RuntimeTesterStatus,
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
  await appendEvent(paths, "status", `runtime tester failed: ${error}`);
}

async function writeStatus(paths: RuntimeTesterRunPaths, status: RuntimeTesterStatus): Promise<void> {
  await mkdir(paths.absolute.runPath, { recursive: true });
  await writeFile(paths.absolute.statusPath, renderValidatedJson(status as unknown as JsonRecord, paths.logical.statusPath), "utf8");
}

async function writeLatest(paths: RuntimeTesterRunPaths, runId: string): Promise<void> {
  await mkdir(paths.absolute.runsRoot, { recursive: true });
  await writeFile(paths.absolute.latestJsonPath, renderValidatedJson({
    runId,
    runPath: paths.logical.runPath,
    schemaVersion: 1,
    statusPath: paths.logical.statusPath,
  }, paths.logical.latestJsonPath), "utf8");
}

async function appendEvent(paths: RuntimeTesterRunPaths, stream: string, message: string): Promise<void> {
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
  const context = runtimePathContext(rootPath, graph, xdg);
  const latestPath = resolveOperationalPath(context, join(RUNTIME_TESTER_ROOT, "latest.json"));
  const latest = JSON.parse(await readFile(latestPath, "utf8")) as unknown;
  if (!isRecord(latest) || typeof latest.runId !== "string") {
    throw new Error("skillset: runtime tester latest run is malformed");
  }
  return latest.runId;
}

async function readConfig(path: string): Promise<RuntimeTesterStoredConfig> {
  const raw = JSON.parse(await readFile(path, "utf8")) as unknown;
  if (!isRecord(raw)) throw new Error("skillset: runtime tester config is malformed");
  if (raw.target !== "claude" && raw.target !== "codex") throw new Error("skillset: runtime tester config target is malformed");
  if (typeof raw.prompt !== "string") throw new Error("skillset: runtime tester config prompt is malformed");
  const claudeSettingSources = typeof raw.claudeSettingSources === "string"
    ? readClaudeSettingSources(raw.claudeSettingSources, "runtime tester config claudeSettingSources")
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

async function readStatus(path: string): Promise<RuntimeTesterStatus> {
  const raw = JSON.parse(await readFile(path, "utf8")) as unknown;
  if (!isRecord(raw) || typeof raw.runId !== "string" || (raw.target !== "claude" && raw.target !== "codex")) {
    throw new Error("skillset: runtime tester status is malformed");
  }
  return raw as unknown as RuntimeTesterStatus;
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

function parseTailLine(line: string): RuntimeTesterTailLine {
  const parsed = JSON.parse(line) as unknown;
  if (!isRecord(parsed)) return { message: line, stream: "raw", timestamp: "" };
  return {
    message: typeof parsed.message === "string" ? parsed.message : "",
    stream: typeof parsed.stream === "string" ? parsed.stream : "raw",
    timestamp: typeof parsed.timestamp === "string" ? parsed.timestamp : "",
  };
}

function runReport(
  paths: RuntimeTesterRunPaths,
  runId: string,
  state: RuntimeTesterState,
  background: boolean
): RuntimeTesterRunReport {
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

function makeRunId(name: string): string {
  const safeName = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "runtime";
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const digest = createHash("sha256").update(`${safeName}:${stamp}:${randomBytes(8).toString("hex")}`).digest("hex").slice(0, 8);
  return `${stamp}-${safeName}-${digest}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function messageFor(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
