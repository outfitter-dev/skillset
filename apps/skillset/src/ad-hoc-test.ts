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

import {
  readClaudeSettingSources,
  type ClaudeSettingSources,
} from "./cli-arg-values";
import { createCliEvent, renderCliEvent } from "./cli-output";

export type AdHocTestSubcommand = "list" | "status" | "tail" | "worker";
export type AdHocTestState = "building" | "failed" | "passed" | "queued" | "running";
export type AdHocTestClaudeSettingSources = ClaudeSettingSources;
export type AdHocTestFailureClass = "auth" | "binary" | "render" | "runtime" | "setup" | "timeout";

export interface AdHocTestRunOptions extends SkillsetOptions {
  readonly background?: boolean;
  readonly cacheRootPath?: string;
  readonly claudeSettingSources?: AdHocTestClaudeSettingSources;
  readonly env?: Record<string, string | undefined>;
  readonly name?: string;
  readonly plugins?: readonly string[];
  readonly prompt: string;
  readonly target: TargetName;
  readonly timeoutMs?: number;
}

interface EventAppendState {
  nextSequence?: number;
  queue: Promise<void>;
}

const eventAppendStates = new Map<string, EventAppendState>();

export interface AdHocTestStatus {
  readonly command?: readonly string[];
  readonly endedAt?: string;
  readonly error?: string;
  readonly exitCode?: number;
  readonly failureClass?: AdHocTestFailureClass;
  readonly finalMessagePath?: string;
  readonly latestRoot: string;
  readonly kind: "ad-hoc";
  readonly name: string;
  readonly outputPath: string;
  readonly pid?: number;
  readonly promptPath: string;
  readonly reportPath: string;
  readonly runId: string;
  readonly runPath: string;
  readonly schemaVersion: 1;
  readonly startedAt: string;
  readonly state: AdHocTestState;
  readonly target: TargetName;
  readonly timeoutMs: number;
  readonly updatedAt: string;
}

export interface AdHocTestEvidence {
  readonly finalMessage?: string;
  readonly outputPath: string;
  readonly reportPath: string;
  readonly response: string;
  readonly stderr: string;
  readonly stdout: string;
}

export interface AdHocTestRunReport {
  readonly background: boolean;
  readonly kind: "ad-hoc";
  readonly latestPath: string;
  readonly ok: boolean;
  readonly reportPath: string;
  readonly runId: string;
  readonly runPath: string;
  readonly state: AdHocTestState;
  readonly statusPath: string;
  readonly tailPath: string;
}

export interface AdHocTestListEntry {
  readonly endedAt?: string;
  readonly name: string;
  readonly kind: "ad-hoc";
  readonly runId: string;
  readonly runPath: string;
  readonly startedAt: string;
  readonly state: AdHocTestState;
  readonly target: TargetName;
}

export interface AdHocTestTailLine {
  readonly message: string;
  readonly stream: string;
  readonly timestamp: string;
}

interface AdHocTestRunPaths {
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

interface AdHocTestStoredConfig {
  readonly claudeSettingSources?: AdHocTestClaudeSettingSources;
  readonly name: string;
  readonly plugins: readonly string[];
  readonly prompt: string;
  readonly sourceDir?: string;
  readonly target: TargetName;
  readonly timeoutMs: number;
}

const RUNTIME_TEST_ROOT = ".skillset/cache/tests/ad-hoc";
const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_CLAUDE_SETTING_SOURCES: AdHocTestClaudeSettingSources = "isolated";
const AD_HOC_TEST_CLAUDE_SETTING_SOURCES_ENV = "SKILLSET_TEST_CLAUDE_SETTING_SOURCES";
// Empty --setting-sources keeps Claude probes independent from user/project/local settings while preserving env auth and explicit --plugin-dir inputs.
const ISOLATED_CLAUDE_SETTING_SOURCES_ARG = "";
const CLAUDE_SETTING_SOURCES_DISPLAY = "\"\"";

export async function startAdHocTestRun(
  rootPath: string,
  options: AdHocTestRunOptions
): Promise<AdHocTestRunReport> {
  const root = resolve(rootPath);
  const cacheRoot = resolve(options.cacheRootPath ?? root);
  if (options.background === true && cacheRoot !== root) {
    throw new Error("skillset: background ad hoc tests cannot use a separate cache root");
  }
  const graph = await loadBuildGraph(root, options);
  if (!graph.root.targets[options.target].enabled) {
    throw new Error(`skillset: test target ${options.target} is not enabled by root target configuration`);
  }
  const name = options.name ?? `ad-hoc-${options.target}`;
  const plugins = validateAdHocTestPlugins(graph, options.target, options.plugins ?? []);
  const runId = makeRetainedRunId(name, { fallbackName: "ad-hoc", includeName: true });
  const paths = adHocTestPaths(cacheRoot, graph, runId, options.xdg);
  await mkdir(paths.absolute.runPath, { recursive: true });

  const config: AdHocTestStoredConfig = {
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
    kind: "ad-hoc",
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
    const pid = spawnAdHocTestWorker(root, runId);
    const status = await readStatus(paths.absolute.statusPath);
    await writeStatus(paths, {
      ...status,
      ...(pid === undefined ? {} : { pid }),
      state: "queued",
      updatedAt: new Date().toISOString(),
    });
    return runReport(paths, runId, "queued", true);
  }

  await executeAdHocTestRun(root, runId, options.env, options.xdg, cacheRoot);
  const status = await readStatus(paths.absolute.statusPath);
  return runReport(paths, runId, status.state, false);
}

export async function executeAdHocTestRun(
  rootPath: string,
  runId: string,
  env: Record<string, string | undefined> = process.env,
  xdg: SkillsetOptions["xdg"] = undefined,
  cacheRootPath: string = rootPath
): Promise<void> {
  const root = resolve(rootPath);
  const paths = adHocTestPaths(resolve(cacheRootPath), await loadBuildGraph(root, xdg === undefined ? {} : { xdg }), runId, xdg);
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
    await failRun(paths, status, messageFor(error), "render");
    return;
  }

  const graph = await loadBuildGraph(root, runOptions);
  let command: ReturnType<typeof runtimeCommand>;
  let result: { readonly exitCode: number; readonly timedOut: boolean };
  try {
    command = runtimeCommand(root, graph, paths, config, env, xdg);
    await appendEvent(paths, "status", `running ${target} non-interactive prompt`);
    status = await updateRunState(paths, status, "running", { command: command.display });
    result = await runCommand(command, config.prompt, paths, config.timeoutMs, env);
  } catch (error) {
    await failRun(paths, status, messageFor(error), isMissingBinaryError(error) ? "binary" : "setup");
    return;
  }
  const finalMessage = await readOptional(paths.absolute.finalMessagePath);
  const stdout = await readOptional(join(paths.absolute.runPath, "stdout.txt")) ?? "";
  const stderr = await readOptional(join(paths.absolute.runPath, "stderr.txt")) ?? "";
  const failureClass = classifyAdHocTestFailure(result, `${stderr}\n${stdout}`);
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
    ...(failureClass === undefined ? {} : { failureClass }),
  };
  await writeFile(paths.absolute.reportPath, renderValidatedJson(report, paths.logical.reportPath), "utf8");
  const nextState: AdHocTestState = report.ok === true ? "passed" : "failed";
  await writeStatus(paths, {
    ...status,
    endedAt: String(report.endedAt),
    exitCode: result.exitCode,
    finalMessagePath: paths.logical.finalMessagePath,
    reportPath: paths.logical.reportPath,
    state: nextState,
    updatedAt: new Date().toISOString(),
    ...(failureClass === undefined ? {} : { failureClass }),
    ...(result.timedOut
      ? { error: `test command timed out after ${config.timeoutMs}ms` }
      : result.exitCode === 0 ? {} : { error: stderr.trim() || `test command exited with code ${result.exitCode}` }),
  });
  await appendEvent(paths, "status", `test ${nextState}`);
}

export async function readAdHocTestEvidence(
  rootPath: string,
  runId: string,
  options: Pick<SkillsetOptions, "xdg"> = {}
): Promise<AdHocTestEvidence> {
  const root = resolve(rootPath);
  const graph = await loadBuildGraph(root, options);
  const paths = adHocTestPaths(root, graph, runId, options.xdg);
  const finalMessage = await readOptional(paths.absolute.finalMessagePath);
  const stdout = await readOptional(join(paths.absolute.runPath, "stdout.txt")) ?? "";
  const stderr = await readOptional(join(paths.absolute.runPath, "stderr.txt")) ?? "";
  const status = await readStatus(paths.absolute.statusPath);
  return {
    ...(finalMessage === undefined ? {} : { finalMessage }),
    outputPath: paths.logical.outputPath,
    reportPath: paths.logical.reportPath,
    response: normalizeAdHocTestResponse(status.target, finalMessage, stdout),
    stderr,
    stdout,
  };
}

function normalizeAdHocTestResponse(target: TargetName, finalMessage: string | undefined, stdout: string): string {
  if (finalMessage !== undefined) return finalMessage;
  if (target === "codex") return stdout;
  const candidates = [stdout.trim(), ...stdout.trim().split("\n").reverse()];
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (!isRecord(parsed)) continue;
      for (const key of ["result", "text", "message"]) {
        if (typeof parsed[key] === "string") return parsed[key];
      }
    } catch {
      // Provider output may be plain text or mixed JSONL; preserve it verbatim.
    }
  }
  return stdout;
}

export async function readAdHocTestStatus(
  rootPath: string,
  runId?: string,
  options: Pick<SkillsetOptions, "xdg"> = {}
): Promise<AdHocTestStatus> {
  const root = resolve(rootPath);
  const graph = await loadBuildGraph(root, options);
  const resolvedRunId = runId ?? await readLatestRunId(root, graph, options.xdg);
  const paths = adHocTestPaths(root, graph, resolvedRunId, options.xdg);
  return readStatus(paths.absolute.statusPath);
}

export async function listAdHocTestRuns(
  rootPath: string,
  options: Pick<SkillsetOptions, "xdg"> = {}
): Promise<readonly AdHocTestListEntry[]> {
  const root = resolve(rootPath);
  const graph = await loadBuildGraph(root, options);
  const runsRoot = retainedRunRootPaths(root, graph, RUNTIME_TEST_ROOT, options.xdg).absolute.runsRoot;
  if (!await pathExists(runsRoot)) return [];
  const entries = await readdir(runsRoot, { withFileTypes: true });
  const runs: AdHocTestListEntry[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      const status = await readStatus(join(runsRoot, entry.name, "status.json"));
      runs.push({
        ...(status.endedAt === undefined ? {} : { endedAt: status.endedAt }),
        kind: status.kind,
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

export async function tailAdHocTestRun(
  rootPath: string,
  runId: string | undefined,
  lines: number,
  options: Pick<SkillsetOptions, "xdg"> = {}
): Promise<readonly AdHocTestTailLine[]> {
  const root = resolve(rootPath);
  const graph = await loadBuildGraph(root, options);
  const resolvedRunId = runId ?? await readLatestRunId(root, graph, options.xdg);
  const paths = adHocTestPaths(root, graph, resolvedRunId, options.xdg);
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
  paths: AdHocTestRunPaths,
  config: AdHocTestStoredConfig,
  env: Record<string, string | undefined>,
  xdg: SkillsetOptions["xdg"]
): { readonly cmd: readonly string[]; readonly cwd: string; readonly display: readonly string[] } {
  const latestRoot = resolveRetainedRunPath(rootPath, graph, ISOLATED_OUT_ROOT, xdg);
  if (config.target === "claude") {
    const bin = env.SKILLSET_TEST_CLAUDE_BIN ?? "claude";
    const pluginArgs = adHocTestPluginDirs(graph, latestRoot, config.target, config.plugins).flatMap((pluginDir) => [
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
    const bin = env.SKILLSET_TEST_CURSOR_BIN ?? "cursor-agent";
    const pluginArgs = adHocTestPluginDirs(graph, latestRoot, config.target, config.plugins).flatMap((pluginDir) => [
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

  const bin = env.SKILLSET_TEST_CODEX_BIN ?? "codex";
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

function resolveClaudeSettingSources(options: AdHocTestRunOptions): AdHocTestClaudeSettingSources {
  const env = options.env ?? process.env;
  return options.claudeSettingSources ??
    readClaudeSettingSources(env[AD_HOC_TEST_CLAUDE_SETTING_SOURCES_ENV], AD_HOC_TEST_CLAUDE_SETTING_SOURCES_ENV) ??
    DEFAULT_CLAUDE_SETTING_SOURCES;
}

function claudeSettingSourcesArg(value: AdHocTestClaudeSettingSources): string {
  return value === "isolated" ? ISOLATED_CLAUDE_SETTING_SOURCES_ARG : value;
}

function adHocTestPluginDirs(
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

function validateAdHocTestPlugins(
  graph: BuildGraph,
  target: TargetName,
  plugins: readonly string[]
): readonly string[] {
  if (plugins.length === 0) return [];
  if (target === "codex") {
    throw new Error("skillset: test --plugin is only supported for targets with local plugin-dir support: claude, cursor");
  }
  const seen = new Set<string>();
  const selected: string[] = [];
  const knownPlugins = graph.plugins.map((plugin) => plugin.id).sort(compareStrings);
  for (const pluginId of plugins) {
    if (seen.has(pluginId)) throw new Error(`skillset: duplicate test plugin ${JSON.stringify(pluginId)}`);
    seen.add(pluginId);
    const plugin = graph.plugins.find((candidate) => candidate.id === pluginId);
    if (plugin === undefined) {
      const available = knownPlugins.length === 0 ? "none configured" : knownPlugins.join(", ");
      throw new Error(`skillset: unknown test plugin ${JSON.stringify(pluginId)}; available plugins: ${available}`);
    }
    if (!plugin.targets[target].enabled) {
      throw new Error(`skillset: test plugin ${JSON.stringify(pluginId)} is not enabled for ${target}`);
    }
    selected.push(pluginId);
  }
  return selected.sort(compareStrings);
}

async function runCommand(
  command: { readonly cmd: readonly string[]; readonly cwd: string },
  prompt: string,
  paths: AdHocTestRunPaths,
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
  paths: AdHocTestRunPaths,
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

function spawnAdHocTestWorker(rootPath: string, runId: string): number | undefined {
  const cliPath = process.argv[1];
  if (cliPath === undefined) throw new Error("skillset: test cannot locate CLI entrypoint for background worker");
  const child = spawnNode(process.execPath, [cliPath, "test", "worker", runId, "--root", rootPath], {
    cwd: rootPath,
    detached: true,
    env: process.env,
    stdio: "ignore",
  });
  child.unref();
  return child.pid;
}

function adHocTestPaths(
  rootPath: string,
  graph: BuildGraph,
  runId: string,
  xdg: SkillsetOptions["xdg"] = undefined
): AdHocTestRunPaths {
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
  paths: AdHocTestRunPaths,
  status: AdHocTestStatus,
  state: AdHocTestState,
  updates: Partial<AdHocTestStatus> = {}
): Promise<AdHocTestStatus> {
  const next = { ...status, ...updates, state, updatedAt: new Date().toISOString() };
  await writeStatus(paths, next);
  return next;
}

async function failRun(
  paths: AdHocTestRunPaths,
  status: AdHocTestStatus,
  error: string,
  failureClass: AdHocTestFailureClass
): Promise<void> {
  const endedAt = new Date().toISOString();
  const report: JsonRecord = {
    endedAt,
    error,
    exitCode: 1,
    failureClass,
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
    failureClass,
    state: "failed",
    updatedAt: endedAt,
  });
  await appendEvent(paths, "status", `test failed: ${error}`);
}

function classifyAdHocTestFailure(
  result: { readonly exitCode: number; readonly timedOut: boolean },
  stderr: string
): AdHocTestFailureClass | undefined {
  if (result.timedOut) return "timeout";
  if (result.exitCode === 0) return undefined;
  if (/not logged in|unauthori[sz]ed|authentication|authenticate|credential|api[ -]?key|oauth|setup-token/iu.test(stderr)) {
    return "auth";
  }
  return "runtime";
}

function isMissingBinaryError(error: unknown): boolean {
  if (error instanceof Error && "code" in error && error.code === "ENOENT") return true;
  return /enoent|failed to spawn|no such file or directory/iu.test(messageFor(error));
}

async function writeStatus(paths: AdHocTestRunPaths, status: AdHocTestStatus): Promise<void> {
  await mkdir(paths.absolute.runPath, { recursive: true });
  await writeFile(paths.absolute.statusPath, renderValidatedJson(status as unknown as JsonRecord, paths.logical.statusPath), "utf8");
}

async function writeLatest(paths: AdHocTestRunPaths, runId: string): Promise<void> {
  await mkdir(paths.absolute.runsRoot, { recursive: true });
  await writeRetainedRunLatest(paths.retained, {
    runId,
    runPath: paths.logical.runPath,
    schemaVersion: 1,
    statusPath: paths.logical.statusPath,
  });
}

async function appendEvent(paths: AdHocTestRunPaths, stream: string, message: string): Promise<void> {
  const path = paths.absolute.outputPath;
  const state = eventAppendStates.get(path) ?? { queue: Promise.resolve() };
  const event = stream === "status" && message === "test passed"
    ? "completed"
    : stream === "status" && message.startsWith("test failed")
      ? "failed"
      : stream;
  const queued = state.queue.catch(() => undefined).then(async () => {
    const data = {
      message,
      stream,
      timestamp: new Date().toISOString(),
    };
    if (state.nextSequence === undefined) {
      const existing = await readOptional(path) ?? "";
      state.nextSequence = existing.split("\n").filter((line) => line.length > 0).length + 1;
    }
    const sequence = state.nextSequence;
    await appendFile(path, renderCliEvent(createCliEvent({
      command: "test",
      data,
      event,
      sequence,
    })), "utf8");
    state.nextSequence = sequence + 1;
  });
  state.queue = queued;
  eventAppendStates.set(path, state);
  try {
    await queued;
  } finally {
    if ((event === "completed" || event === "failed") && eventAppendStates.get(path)?.queue === queued) {
      eventAppendStates.delete(path);
    }
  }
}

async function readLatestRunId(
  rootPath: string,
  graph: BuildGraph,
  xdg: SkillsetOptions["xdg"] = undefined
): Promise<string> {
  const latest = await readRetainedRunLatest(rootPath, graph, RUNTIME_TEST_ROOT, xdg);
  if (!isRecord(latest) || typeof latest.runId !== "string") {
    throw new Error("skillset: test latest run is malformed");
  }
  return latest.runId;
}

async function readConfig(path: string): Promise<AdHocTestStoredConfig> {
  const raw = JSON.parse(await readFile(path, "utf8")) as unknown;
  if (!isRecord(raw)) throw new Error("skillset: test config is malformed");
  if (!isTargetName(raw.target)) throw new Error("skillset: test config target is malformed");
  if (typeof raw.prompt !== "string") throw new Error("skillset: test config prompt is malformed");
  const claudeSettingSources = typeof raw.claudeSettingSources === "string"
    ? readClaudeSettingSources(raw.claudeSettingSources, "test config claudeSettingSources")
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

async function readStatus(path: string): Promise<AdHocTestStatus> {
  const raw = JSON.parse(await readFile(path, "utf8")) as unknown;
  if (!isRecord(raw) || typeof raw.runId !== "string" || !isTargetName(raw.target)) {
    throw new Error("skillset: test status is malformed");
  }
  return raw as unknown as AdHocTestStatus;
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

function parseTailLine(line: string): AdHocTestTailLine {
  const parsed = JSON.parse(line) as unknown;
  if (!isRecord(parsed)) return { message: line, stream: "raw", timestamp: "" };
  const data = isRecord(parsed.data) ? parsed.data : parsed;
  return {
    message: typeof data.message === "string" ? data.message : "",
    stream: typeof data.stream === "string" ? data.stream : "raw",
    timestamp: typeof data.timestamp === "string" ? data.timestamp : "",
  };
}

function runReport(
  paths: AdHocTestRunPaths,
  runId: string,
  state: AdHocTestState,
  background: boolean
): AdHocTestRunReport {
  return {
    background,
    kind: "ad-hoc",
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
