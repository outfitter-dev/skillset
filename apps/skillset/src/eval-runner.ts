import { appendFile, cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { buildSkillset, listSkillEvals } from "@skillset/core";
import { pluginTargetRoot } from "@skillset/core/internal/plugin-output";
import { loadBuildGraph } from "@skillset/core/internal/resolver";
import { renderValidatedJson } from "@skillset/core/internal/structured-output";
import { stageSkillsetSourceWorkspace } from "@skillset/core/internal/test-evaluation";
import type { BuildGraph, JsonRecord, SkillsetOptions, TargetName } from "@skillset/core/internal/types";

import { createRuntimeProbeCommand, runRuntimeProbe } from "./runtime-probe";
import { appendRetainedRunEvent, makeRetainedRunId, readRetainedRunLatest, retainedRunPaths, writeRetainedRunLatest, type RetainedRunPaths } from "./retained-runs";

const EVAL_ROOT = ".skillset/cache/evals";
const DEFAULT_TIMEOUT_MS = 120_000;

export type SkillsetEvalRunState = "building" | "completed" | "failed" | "running";
export type SkillsetEvalTrialClassification = "completed" | "infrastructure_failure" | "non_lowering" | "unavailable";
export type SkillsetEvalFailureClass = "auth" | "binary" | "cancelled" | "render" | "runtime" | "setup" | "timeout";

export interface SkillsetEvalRunOptions extends SkillsetOptions {
  readonly env?: Record<string, string | undefined>;
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
}

export interface SkillsetEvalTrial {
  readonly classification: SkillsetEvalTrialClassification;
  readonly command: readonly string[];
  readonly durationMs?: number;
  readonly evalId: number;
  readonly expectedOutput: string;
  readonly expectations: readonly string[];
  readonly failureClass?: SkillsetEvalFailureClass;
  readonly finalMessagePath?: string;
  readonly files: readonly string[];
  readonly model?: string;
  readonly outputPath?: string;
  readonly owner: Awaited<ReturnType<typeof listSkillEvals>>[number]["owner"];
  readonly promptPath: string;
  readonly skill: string;
  readonly stderrPath?: string;
  readonly stdoutPath?: string;
  readonly target: TargetName;
  readonly tokens?: JsonRecord;
  readonly toolCallCount?: number;
  readonly workspacePath: string;
}

export interface SkillsetEvalRunReport {
  readonly latestPath: string;
  readonly reportPath: string;
  readonly runId: string;
  readonly runPath: string;
  readonly state: SkillsetEvalRunState;
  readonly statusPath: string;
  readonly tailPath: string;
  readonly trials: readonly SkillsetEvalTrial[];
  readonly workspacePath: string;
}

export interface SkillsetEvalRunStatus {
  readonly endedAt?: string;
  readonly error?: string;
  readonly kind: "eval";
  readonly latestRoot: string;
  readonly reportPath: string;
  readonly runId: string;
  readonly runPath: string;
  readonly schemaVersion: 1;
  readonly startedAt: string;
  readonly state: SkillsetEvalRunState;
  readonly tailPath: string;
  readonly updatedAt: string;
  readonly workspacePath: string;
}

interface EvalRunPaths {
  readonly retained: RetainedRunPaths;
  readonly absolute: {
    readonly latestPath: string;
    readonly outputPath: string;
    readonly reportPath: string;
    readonly runPath: string;
    readonly statusPath: string;
    readonly workspacePath: string;
  };
  readonly logical: {
    readonly latestPath: string;
    readonly outputPath: string;
    readonly reportPath: string;
    readonly runPath: string;
    readonly statusPath: string;
    readonly workspacePath: string;
  };
}

/**
 * Executes the declared case-by-target matrix as opt-in, ungraded provider
 * trials. Source and generated output stay in the retained isolated workspace.
 */
export async function runSkillsetEvals(
  rootPath: string,
  options: SkillsetEvalRunOptions = {}
): Promise<SkillsetEvalRunReport> {
  if (isAborted(options.signal)) throw abortError();
  const root = resolve(rootPath);
  const graph = await loadBuildGraph(root, options);
  const entries = await listSkillEvals(root, options);
  const runId = makeRetainedRunId("eval", { includeName: true });
  const paths = evalRunPaths(root, graph, runId, options.xdg);
  await mkdir(paths.absolute.runPath, { recursive: true });
  let status = await writeEvalStatus(paths, {
    kind: "eval",
    latestRoot: paths.logical.latestPath,
    reportPath: paths.logical.reportPath,
    runId,
    runPath: paths.logical.runPath,
    schemaVersion: 1,
    startedAt: new Date().toISOString(),
    state: "building",
    tailPath: paths.logical.outputPath,
    updatedAt: new Date().toISOString(),
    workspacePath: paths.logical.workspacePath,
  });
  await writeRetainedRunLatest(paths.retained, {
    kind: "eval",
    runId,
    runPath: paths.logical.runPath,
    schemaVersion: 1,
    statusPath: paths.logical.statusPath,
  });

  const stagingRoot = await mkdtemp(join(tmpdir(), "skillset-eval-"));
  const stagingWorkspacePath = join(stagingRoot, "workspace");
  let failurePhase: "render" | "setup" = "setup";
  const trials: SkillsetEvalTrial[] = [];
  try {
    await mkdir(stagingWorkspacePath, { recursive: true });
    await appendEvalEvent(paths, "status", "staging source into isolated eval workspace");
    await stageSkillsetSourceWorkspace(root, graph, stagingWorkspacePath);
    if (isAborted(options.signal)) throw abortError();
    const workspaceGraphByTarget = new Map<TargetName, BuildGraph>();
    for (const target of uniqueTargets(entries.map((entry) => entry.target))) {
      await appendEvalEvent(paths, "status", `building isolated ${target} eval workspace`);
      const targetStagingPath = join(stagingRoot, `workspace-${target}`);
      const targetWorkspacePath = evalTargetWorkspacePath(paths, target);
      await cp(stagingWorkspacePath, targetStagingPath, { recursive: true });
      failurePhase = "render";
      await buildSkillset(targetStagingPath, {
        buildMode: "all",
        sourceDir: graph.sourceDir,
        targetFilter: [target],
      });
      failurePhase = "setup";
      await cp(targetStagingPath, targetWorkspacePath, { recursive: true });
      workspaceGraphByTarget.set(target, await loadBuildGraph(targetWorkspacePath));
    }
    status = await writeEvalStatus(paths, { ...status, state: "running", updatedAt: new Date().toISOString() });
    let cancelled = false;
    for (const entry of entries) {
      if (isAborted(options.signal)) {
        cancelled = true;
        break;
      }
      const workspaceGraph = workspaceGraphByTarget.get(entry.target);
      if (workspaceGraph === undefined) throw new Error(`skillset: eval target ${entry.target} was not staged`);
      trials.push(await runEvalTrial(paths, workspaceGraph, evalTargetWorkspacePath(paths, entry.target), entry, options));
      if (isAborted(options.signal)) cancelled = true;
      if (cancelled) break;
    }
    const state: SkillsetEvalRunState = !cancelled &&
      trials.length > 0 &&
      trials.every((trial) => trial.classification === "completed")
      ? "completed"
      : "failed";
    const endedAt = new Date().toISOString();
    await writeFile(paths.absolute.reportPath, renderValidatedJson({
      endedAt,
      kind: "eval",
      runId,
      schemaVersion: 1,
      state,
      trials: trials as unknown as JsonRecord[],
      ...(cancelled ? { failureClass: "cancelled" } : {}),
      workspacePath: paths.logical.workspacePath,
    }, paths.logical.reportPath), "utf8");
    status = await writeEvalStatus(paths, { ...status, endedAt, state, updatedAt: endedAt });
    await appendEvalEvent(paths, "status", `eval ${state}`);
    await refreshEvalLatest(paths);
    return evalRunReport(paths, runId, state, trials);
  } catch (error) {
    const endedAt = new Date().toISOString();
    const failureClass = isAborted(options.signal) ? "cancelled" : failurePhase;
    await writeFile(paths.absolute.reportPath, renderValidatedJson({
      endedAt,
      error: messageFor(error),
      failureClass,
      kind: "eval",
      runId,
      schemaVersion: 1,
      state: "failed",
      trials: trials as unknown as JsonRecord[],
      workspacePath: paths.logical.workspacePath,
    }, paths.logical.reportPath), "utf8");
    await writeEvalStatus(paths, { ...status, endedAt, error: messageFor(error), state: "failed", updatedAt: endedAt });
    await appendEvalEvent(paths, "status", `eval failed: ${messageFor(error)}`);
    await refreshEvalLatest(paths);
    return evalRunReport(paths, runId, "failed", trials);
  } finally {
    await rm(stagingRoot, { force: true, recursive: true });
  }
}

export async function readSkillsetEvalStatus(rootPath: string, runId: string | undefined, options: Pick<SkillsetOptions, "xdg"> = {}): Promise<SkillsetEvalRunStatus> {
  const root = resolve(rootPath);
  const graph = await loadBuildGraph(root, options);
  const resolvedRunId = runId ?? await readLatestEvalRunId(root, graph, options.xdg);
  const paths = evalRunPaths(root, graph, resolvedRunId, options.xdg);
  return readEvalStatus(paths.absolute.statusPath);
}

export async function tailSkillsetEvalRun(rootPath: string, runId: string | undefined, lines: number, options: Pick<SkillsetOptions, "xdg"> = {}): Promise<readonly JsonRecord[]> {
  const root = resolve(rootPath);
  const graph = await loadBuildGraph(root, options);
  const resolvedRunId = runId ?? await readLatestEvalRunId(root, graph, options.xdg);
  const paths = evalRunPaths(root, graph, resolvedRunId, options.xdg);
  const raw = await readFile(paths.absolute.outputPath, "utf8").catch(() => "");
  return raw.split("\n").filter(Boolean).slice(-Math.max(0, lines)).map((line) => JSON.parse(line) as JsonRecord);
}

async function runEvalTrial(
  paths: EvalRunPaths,
  graph: BuildGraph,
  baseWorkspacePath: string,
  entry: Awaited<ReturnType<typeof listSkillEvals>>[number],
  options: SkillsetEvalRunOptions
): Promise<SkillsetEvalTrial> {
  const trialPath = evalTrialPath(entry);
  const trialRoot = join(paths.absolute.runPath, "trials", ...trialPath);
  const logicalTrialRoot = join(paths.logical.runPath, "trials", ...trialPath).replaceAll("\\", "/");
  await mkdir(trialRoot, { recursive: true });
  const promptPath = join(trialRoot, "prompt.md");
  const logicalPromptPath = join(logicalTrialRoot, "prompt.md").replaceAll("\\", "/");
  const trialWorkspacePath = join(trialRoot, "workspace");
  const logicalTrialWorkspacePath = join(logicalTrialRoot, "workspace").replaceAll("\\", "/");
  await cp(baseWorkspacePath, trialWorkspacePath, { recursive: true });
  await writeFile(promptPath, entry.prompt, "utf8");
  const stagedFiles = entry.files.map((file) => join(dirname(entry.skillPath), file).replaceAll("\\", "/"));
  const unavailableFiles = [] as string[];
  for (const [index, file] of stagedFiles.entries()) {
    const declaredPath = entry.files[index];
    if (declaredPath === undefined) continue;
    const targetPath = join(trialWorkspacePath, declaredPath);
    if (!await pathExists(join(baseWorkspacePath, file))) {
      unavailableFiles.push(file);
      continue;
    }
    await mkdir(dirname(targetPath), { recursive: true });
    await cp(join(baseWorkspacePath, file), targetPath, { recursive: true });
  }
  if (
    unavailableFiles.length > 0 ||
    (entry.owner.kind === "plugin" && entry.target === "codex")
  ) {
    return {
      classification: "unavailable",
      command: [],
      evalId: entry.evalId,
      expectedOutput: entry.expectedOutput,
      expectations: entry.expectations,
      failureClass: "setup",
      files: entry.files,
      owner: entry.owner,
      promptPath: logicalPromptPath,
      skill: entry.skill,
      target: entry.target,
      workspacePath: logicalTrialWorkspacePath,
    };
  }
  if (!await renderedSkillExists(baseWorkspacePath, graph, entry)) {
    return {
      classification: "non_lowering",
      command: [],
      evalId: entry.evalId,
      expectedOutput: entry.expectedOutput,
      expectations: entry.expectations,
      failureClass: "render",
      files: entry.files,
      owner: entry.owner,
      promptPath: logicalPromptPath,
      skill: entry.skill,
      target: entry.target,
      workspacePath: logicalTrialWorkspacePath,
    };
  }
  const finalMessagePath = join(trialRoot, "final-message.txt");
  const stdoutPath = join(trialRoot, "stdout.txt");
  const stderrPath = join(trialRoot, "stderr.txt");
  const started = performance.now();
  let command: ReturnType<typeof createRuntimeProbeCommand> | undefined;
  let stdout = "";
  let stderr = "";
  try {
    command = createRuntimeProbeCommand(trialWorkspacePath, graph, {
      finalMessagePath,
      prompt: entry.prompt,
      target: entry.target,
    }, options.env ?? process.env);
    await appendEvalEvent(paths, "status", `running ${trialPath.join("/")}`);
    const result = await runRuntimeProbe(command, entry.prompt, {
      env: options.env ?? process.env,
      onOutput: async (stream, text) => {
        if (stream === "stdout") {
          stdout += text;
          await appendFile(stdoutPath, text, "utf8");
        } else {
          stderr += text;
          await appendFile(stderrPath, text, "utf8");
        }
        await appendEvalEvent(paths, stream, `${trialPath.join("/")}: ${text}`);
      },
      onProcess: async (pid) => appendEvalEvent(paths, "process", `${trialPath.join("/")}: pid ${pid}`),
      ...(options.signal === undefined ? {} : { signal: options.signal }),
      timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    });
    const failureClass = classifyFailure(result, `${stderr}\n${stdout}`);
    const finalMessage = await readFile(finalMessagePath, "utf8").catch(() => undefined);
    const usage = providerUsage(`${stdout}\n${finalMessage ?? ""}`);
    return {
      classification: failureClass === undefined ? "completed" : "infrastructure_failure",
      command: [...command.display],
      durationMs: Math.round(performance.now() - started),
      evalId: entry.evalId,
      expectedOutput: entry.expectedOutput,
      expectations: entry.expectations,
      ...(failureClass === undefined ? {} : { failureClass }),
      ...(finalMessage === undefined ? {} : { finalMessagePath: join(logicalTrialRoot, "final-message.txt").replaceAll("\\", "/") }),
      files: entry.files,
      ...(usage.model === undefined ? {} : { model: usage.model }),
      outputPath: paths.logical.outputPath,
      owner: entry.owner,
      promptPath: logicalPromptPath,
      skill: entry.skill,
      ...(usage.tokens === undefined ? {} : { tokens: usage.tokens }),
      ...(usage.toolCallCount === undefined ? {} : { toolCallCount: usage.toolCallCount }),
      ...(stderr.length === 0 ? {} : { stderrPath: join(logicalTrialRoot, "stderr.txt").replaceAll("\\", "/") }),
      ...(stdout.length === 0 ? {} : { stdoutPath: join(logicalTrialRoot, "stdout.txt").replaceAll("\\", "/") }),
      target: entry.target,
      workspacePath: logicalTrialWorkspacePath,
    };
  } catch (error) {
    return {
      classification: "infrastructure_failure",
      command: command === undefined ? [] : [...command.display],
      durationMs: Math.round(performance.now() - started),
      evalId: entry.evalId,
      expectedOutput: entry.expectedOutput,
      expectations: entry.expectations,
      failureClass: isAborted(options.signal) ? "cancelled" : isMissingBinaryError(error) ? "binary" : "setup",
      files: entry.files,
      owner: entry.owner,
      promptPath: logicalPromptPath,
      skill: entry.skill,
      target: entry.target,
      workspacePath: logicalTrialWorkspacePath,
    };
  }
}

async function renderedSkillExists(workspacePath: string, graph: BuildGraph, entry: Awaited<ReturnType<typeof listSkillEvals>>[number]): Promise<boolean> {
  const sourcePath = join(workspacePath, entry.skillPath);
  if (entry.owner.kind === "standalone") {
    const skill = graph.standaloneSkills.find((candidate) => candidate.sourcePath === sourcePath);
    return skill === undefined
      ? false
      : pathExists(join(workspacePath, graph.root.outputs.skills[entry.target], dirname(skill.relativePath), "SKILL.md"));
  }
  const owner = entry.owner;
  if (owner.kind !== "plugin") return false;
  const plugin = graph.plugins.find((candidate) => candidate.id === owner.plugin);
  const skill = plugin?.skills.find((candidate) => candidate.sourcePath === sourcePath);
  return plugin === undefined || skill === undefined
    ? false
    : pathExists(join(workspacePath, pluginTargetRoot(graph.root.outputs.plugins[entry.target], entry.target, plugin.id), dirname(skill.relativePath), "SKILL.md"));
}

function evalRunPaths(rootPath: string, graph: BuildGraph, runId: string, xdg: SkillsetOptions["xdg"] = undefined): EvalRunPaths {
  const retained = retainedRunPaths(rootPath, graph, EVAL_ROOT, runId, xdg);
  return {
    retained,
    absolute: {
      latestPath: join(retained.absolute.rootPath, "latest"),
      outputPath: join(retained.absolute.runPath, "output.jsonl"),
      reportPath: join(retained.absolute.runPath, "report.json"),
      runPath: retained.absolute.runPath,
      statusPath: join(retained.absolute.runPath, "status.json"),
      workspacePath: join(retained.absolute.runPath, "workspace"),
    },
    logical: {
      latestPath: join(retained.logical.rootPath, "latest").replaceAll("\\", "/"),
      outputPath: join(retained.logical.runPath, "output.jsonl").replaceAll("\\", "/"),
      reportPath: join(retained.logical.runPath, "report.json").replaceAll("\\", "/"),
      runPath: retained.logical.runPath,
      statusPath: join(retained.logical.runPath, "status.json").replaceAll("\\", "/"),
      workspacePath: join(retained.logical.runPath, "workspace").replaceAll("\\", "/"),
    },
  };
}

function evalTargetWorkspacePath(paths: EvalRunPaths, target: TargetName): string {
  return join(paths.absolute.workspacePath, target);
}

async function writeEvalStatus(paths: EvalRunPaths, status: SkillsetEvalRunStatus): Promise<SkillsetEvalRunStatus> {
  await writeFile(paths.absolute.statusPath, renderValidatedJson(status as unknown as JsonRecord, paths.logical.statusPath), "utf8");
  return status;
}

async function readEvalStatus(path: string): Promise<SkillsetEvalRunStatus> {
  const raw = JSON.parse(await readFile(path, "utf8")) as unknown;
  if (
    !isRecord(raw) ||
    raw.kind !== "eval" ||
    raw.schemaVersion !== 1 ||
    !isEvalRunState(raw.state) ||
    !hasStringFields(raw, ["latestRoot", "reportPath", "runId", "runPath", "startedAt", "tailPath", "updatedAt", "workspacePath"]) ||
    (raw.endedAt !== undefined && typeof raw.endedAt !== "string") ||
    (raw.error !== undefined && typeof raw.error !== "string")
  ) {
    throw new Error("skillset: eval status is malformed");
  }
  return raw as unknown as SkillsetEvalRunStatus;
}

async function appendEvalEvent(paths: EvalRunPaths, stream: string, message: string): Promise<void> {
  const event = stream === "status" && message === "eval completed" ? "completed" : stream === "status" && message.startsWith("eval failed") ? "failed" : stream;
  await appendRetainedRunEvent(paths.absolute.outputPath, { command: "eval", event, message, stream });
}

async function refreshEvalLatest(paths: EvalRunPaths): Promise<void> {
  await rm(paths.absolute.latestPath, { force: true, recursive: true });
  await cp(paths.absolute.runPath, paths.absolute.latestPath, { recursive: true });
  await writeRetainedRunLatest(paths.retained, {
    kind: "eval",
    reportPath: join(paths.logical.latestPath, "report.json").replaceAll("\\", "/"),
    runId: paths.logical.runPath.split("/").at(-1) ?? "",
    runPath: paths.logical.runPath,
    schemaVersion: 1,
    statusPath: join(paths.logical.latestPath, "status.json").replaceAll("\\", "/"),
  });
}

function evalRunReport(paths: EvalRunPaths, runId: string, state: SkillsetEvalRunState, trials: readonly SkillsetEvalTrial[]): SkillsetEvalRunReport {
  return {
    latestPath: paths.logical.latestPath,
    reportPath: paths.logical.reportPath,
    runId,
    runPath: paths.logical.runPath,
    state,
    statusPath: paths.logical.statusPath,
    tailPath: paths.logical.outputPath,
    trials,
    workspacePath: paths.logical.workspacePath,
  };
}

async function readLatestEvalRunId(rootPath: string, graph: BuildGraph, xdg: SkillsetOptions["xdg"]): Promise<string> {
  const latest = await readRetainedRunLatest(rootPath, graph, EVAL_ROOT, xdg);
  if (typeof latest.runId !== "string") throw new Error("skillset: eval latest run is malformed");
  return latest.runId;
}

function uniqueTargets(targets: readonly TargetName[]): readonly TargetName[] {
  return [...new Set(targets)];
}

function isEvalRunState(value: unknown): value is SkillsetEvalRunState {
  return value === "building" || value === "completed" || value === "failed" || value === "running";
}

function hasStringFields(record: Record<string, unknown>, fields: readonly string[]): boolean {
  return fields.every((field) => typeof record[field] === "string");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function evalTrialPath(entry: Awaited<ReturnType<typeof listSkillEvals>>[number]): readonly string[] {
  const owner = entry.owner.kind === "plugin"
    ? ["plugin", entry.owner.plugin]
    : ["standalone"];
  return [...owner, "skill", entry.skill, "case", String(entry.evalId), "target", entry.target];
}

function classifyFailure(result: { readonly exitCode: number; readonly timedOut: boolean }, output: string): SkillsetEvalFailureClass | undefined {
  if (result.timedOut) return "timeout";
  if (result.exitCode === 0) return undefined;
  if (/not logged in|unauthori[sz]ed|authentication|authenticate|credential|api[ -]?key|oauth|setup-token/iu.test(output)) return "auth";
  return "runtime";
}

function providerUsage(raw: string): { readonly model?: string; readonly tokens?: JsonRecord; readonly toolCallCount?: number } {
  for (const line of raw.split("\n").reverse()) {
    try {
      const value = JSON.parse(line) as Record<string, unknown>;
      const usage = value.usage;
      const model = typeof value.model === "string" ? value.model : undefined;
      const toolCallCount = toolCalls(value);
      if (typeof usage === "object" && usage !== null && !Array.isArray(usage)) {
        const tokens = Object.fromEntries(Object.entries(usage).filter((entry): entry is [string, number] => typeof entry[1] === "number")) as JsonRecord;
        return { ...(model === undefined ? {} : { model }), ...(Object.keys(tokens).length === 0 ? {} : { tokens }), ...(toolCallCount === undefined ? {} : { toolCallCount }) };
      }
      if (model !== undefined || toolCallCount !== undefined) return { ...(model === undefined ? {} : { model }), ...(toolCallCount === undefined ? {} : { toolCallCount }) };
    } catch {
      // Provider streams may be mixed text and JSONL.
    }
  }
  return {};
}

function toolCalls(value: Record<string, unknown>): number | undefined {
  for (const key of ["tool_calls", "toolCalls"]) {
    if (Array.isArray(value[key])) return value[key].length;
  }
  return undefined;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function isMissingBinaryError(error: unknown): boolean {
  return error instanceof Error && ("code" in error && error.code === "ENOENT" || /enoent|failed to spawn|no such file or directory/iu.test(error.message));
}

function messageFor(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function abortError(): Error {
  return new DOMException("Eval run cancelled", "AbortError");
}

function isAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted ?? false;
}
