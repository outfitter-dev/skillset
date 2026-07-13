import { watch, type FSWatcher } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";

import {
  buildSkillsetResult,
  diffSkillsetResult,
  type SkillsetWriteSummary,
} from "@skillset/core";

import { lintSkillset } from "@skillset/core";
import { loadBuildGraph } from "@skillset/core/internal/resolver";
import type { SkillsetOptions } from "@skillset/core/internal/types";
import type { SchemaJsonRecord } from "@skillset/schema";

import { createCliEventStream } from "./cli-output";

export interface DevWatchPlan {
  readonly configPaths: readonly string[];
  readonly ignoredRoots: readonly string[];
  readonly outputRoots: readonly string[];
  readonly rootPath: string;
  readonly sourceRoot: string;
  readonly watchRoots: readonly string[];
}

export type DevWatchMode = "apply" | "preview";

export interface DevWatchPreviewReport {
  readonly checkedSkills: number;
  readonly diagnostics: readonly {
    readonly code: string;
    readonly message: string;
    readonly path?: string;
    readonly severity: string;
  }[];
  readonly diff: {
    readonly added: readonly string[];
    readonly changed: readonly string[];
    readonly missing: readonly string[];
    readonly removed: readonly string[];
  };
  readonly error?: string;
  readonly mode: DevWatchMode;
  readonly ok: boolean;
  readonly outputRoots: readonly string[];
  readonly reason: string;
  readonly sourceRoot: string;
  readonly warnings: readonly string[];
  readonly writes?: SkillsetWriteSummary;
}

export interface DevWatchDebouncer {
  readonly cancel: () => void;
  readonly trigger: (reason: string) => void;
}

export interface DevWatchScheduler {
  readonly clearTimeout: (handle: unknown) => void;
  readonly setTimeout: (callback: () => void, delayMs: number) => unknown;
}

export interface DevWatchRuntime {
  readonly addSignalListeners: (listener: () => void) => void;
  readonly collectDirectories: typeof collectDevWatchDirectories;
  readonly removeSignalListeners: (listener: () => void) => void;
  readonly runOnce: typeof runDevWatchOnce;
  readonly scheduler: DevWatchScheduler;
  readonly watch: typeof watch;
}

export function createDevWatchJsonlStream(output: Pick<NodeJS.WritableStream, "write">) {
  const stream = createCliEventStream("dev", output);
  return {
    started(plan: DevWatchPlan, mode: DevWatchMode) {
      return stream.emit("started", {
        mode,
        sourceRoot: plan.sourceRoot,
        watchRoots: [...plan.watchRoots],
      } as unknown as SchemaJsonRecord);
    },
    operation(report: DevWatchPreviewReport) {
      return stream.emit("operation", report as unknown as SchemaJsonRecord);
    },
    completed(reason = "signal") {
      return stream.emit("completed", { reason });
    },
    failed(message: string, stage: string) {
      return stream.emit("failed", { message, stage });
    },
  };
}

const DEFAULT_DEBOUNCE_MS = 200;
const OPERATIONAL_IGNORE_ROOTS = [".skillset/cache", ".skillset/snapshots"] as const;

const defaultScheduler: DevWatchScheduler = {
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
};

export async function createDevWatchPlan(
  rootPath: string,
  options: SkillsetOptions = {}
): Promise<DevWatchPlan> {
  const graph = await loadBuildGraph(rootPath, options);
  const configPaths = sortedUnique([
    relativePath(graph.rootPath, graph.rootConfigPath),
    relativePath(graph.rootPath, graph.rootManifestPath),
  ]);
  const watchRoots = sortedUnique([
    ...configPaths.map((path) => normalizeRelativePath(dirname(path))),
    graph.sourceRoot,
  ]);
  const ignoredRoots = sortedUnique([
    ...OPERATIONAL_IGNORE_ROOTS,
    ...graph.outputRoots.filter((outputRoot) => outputRoot !== "."),
  ]);

  return {
    configPaths,
    ignoredRoots,
    outputRoots: graph.outputRoots,
    rootPath: graph.rootPath,
    sourceRoot: graph.sourceRoot,
    watchRoots,
  };
}

export function shouldRunDevPreviewForPath(
  plan: DevWatchPlan,
  eventPath: string | undefined
): boolean {
  if (eventPath === undefined || eventPath.length === 0) return true;
  const relativeEventPath = normalizeEventPath(plan.rootPath, eventPath);
  if (relativeEventPath === undefined) return false;
  if (isIgnoredDevWatchPath(plan, relativeEventPath)) return false;
  return isSameOrInside(relativeEventPath, plan.sourceRoot) || plan.configPaths.includes(relativeEventPath);
}

export function isIgnoredDevWatchPath(plan: DevWatchPlan, eventPath: string): boolean {
  const normalized = normalizeRelativePath(eventPath);
  if (normalized === "." || normalized === "") return false;
  const name = basename(normalized);
  if (name === "AGENTS.md" || name === "skillset.lock") return true;
  return plan.ignoredRoots.some((root) => isSameOrInside(normalized, root));
}

export function createDevWatchDebouncer(
  callback: (reason: string) => void | Promise<void>,
  delayMs = DEFAULT_DEBOUNCE_MS,
  scheduler: DevWatchScheduler = defaultScheduler
): DevWatchDebouncer {
  let timer: unknown;
  let latestReason = "change";

  return {
    cancel: () => {
      if (timer === undefined) return;
      scheduler.clearTimeout(timer);
      timer = undefined;
    },
    trigger: (reason) => {
      latestReason = reason;
      if (timer !== undefined) scheduler.clearTimeout(timer);
      timer = scheduler.setTimeout(() => {
        timer = undefined;
        void callback(latestReason);
      }, delayMs);
    },
  };
}

export async function runDevWatchPreview(
  rootPath: string,
  options: SkillsetOptions = {},
  reason = "initial"
): Promise<DevWatchPreviewReport> {
  const plan = await createDevWatchPlan(rootPath, options);
  try {
    const lint = await lintSkillset(rootPath, options);
    const diff = await diffSkillsetResult(rootPath, options);
    return {
      checkedSkills: lint.checkedSkills,
      diagnostics: diff.diagnostics,
      diff: diff.data,
      mode: "preview",
      ok: true,
      outputRoots: plan.outputRoots,
      reason,
      sourceRoot: plan.sourceRoot,
      warnings: lint.issues.map((issue) => `${issue.path}: ${issue.code}: ${issue.message}`),
    };
  } catch (error) {
    return {
      checkedSkills: 0,
      diagnostics: [],
      diff: { added: [], changed: [], missing: [], removed: [] },
      error: error instanceof Error ? error.message : String(error),
      mode: "preview",
      ok: false,
      outputRoots: plan.outputRoots,
      reason,
      sourceRoot: plan.sourceRoot,
      warnings: [],
    };
  }
}

export async function runDevWatchApply(
  rootPath: string,
  options: SkillsetOptions = {},
  reason = "initial"
): Promise<DevWatchPreviewReport> {
  const plan = await createDevWatchPlan(rootPath, options);
  try {
    const lint = await lintSkillset(rootPath, options);
    const build = await buildSkillsetResult(rootPath, options);
    return {
      checkedSkills: lint.checkedSkills,
      diagnostics: build.diagnostics,
      diff: { added: [], changed: [], missing: [], removed: [] },
      mode: "apply",
      ok: true,
      outputRoots: plan.outputRoots,
      reason,
      sourceRoot: plan.sourceRoot,
      warnings: lint.issues.map((issue) => `${issue.path}: ${issue.code}: ${issue.message}`),
      writes: build.writes,
    };
  } catch (error) {
    return {
      checkedSkills: 0,
      diagnostics: [],
      diff: { added: [], changed: [], missing: [], removed: [] },
      error: error instanceof Error ? error.message : String(error),
      mode: "apply",
      ok: false,
      outputRoots: plan.outputRoots,
      reason,
      sourceRoot: plan.sourceRoot,
      warnings: [],
    };
  }
}

export function renderDevWatchPreview(report: DevWatchPreviewReport): string {
  const lines = [
    `skillset: dev ${report.mode} ${report.ok ? "passed" : "failed"} (${report.reason})`,
    `  source: ${report.sourceRoot}`,
    `  outputs: ${report.outputRoots.length === 0 ? "none" : report.outputRoots.join(", ")}`,
  ];

  if (!report.ok) {
    lines.push(`  error: ${report.error ?? "unknown error"}`);
    if (report.mode === "apply") {
      lines.push("  next: fix the source or output error; no completed apply was reported");
      lines.push("  recovery: if a backup was reported before the failure, use skillset restore <backup-id>");
    } else {
      lines.push("  next: fix the source error; the watcher will rerun the preview on the next edit");
    }
    return `${lines.join("\n")}\n`;
  }

  for (const warning of report.warnings) lines.push(`  warn: ${warning}`);
  for (const diagnostic of report.diagnostics) {
    const path = diagnostic.path ?? "";
    lines.push(`  ${diagnostic.severity}: ${path}${path.length === 0 ? "" : ": "}${diagnostic.code}: ${diagnostic.message}`);
  }
  lines.push(`  source diagnostics: checked ${report.checkedSkills} source skill${report.checkedSkills === 1 ? "" : "s"}`);
  if (report.mode === "apply") {
    const writes = report.writes;
    const writtenPaths = writes?.writtenPaths ?? [];
    const deletedPaths = writes?.deletedPaths ?? [];
    for (const path of writtenPaths) lines.push(`  generated wrote ${path}`);
    for (const path of deletedPaths) lines.push(`  generated removed ${path}`);
    lines.push(`  generated apply: ${writtenPaths.length} written, ${deletedPaths.length} removed`);
    if (writes?.backupManifestPath !== undefined) {
      const count = writes.backupRecords?.length ?? 0;
      lines.push(`  backup: ${count} file${count === 1 ? "" : "s"} saved to ${writes.backupManifestPath}`);
      if (writes.backupRunId !== undefined) {
        lines.push(`  recovery: skillset restore ${writes.backupRunId} --yes`);
      }
    }
    lines.push(writtenPaths.length === 0 && deletedPaths.length === 0
      ? "  next: generated output already fresh; watching for source edits"
      : "  next: generated output applied; watching for source edits");
    return `${lines.join("\n")}\n`;
  }

  const { added, changed, missing, removed } = report.diff;
  for (const path of added) lines.push(`  generated + ${path}`);
  for (const path of changed) lines.push(`  generated ~ ${path}`);
  for (const path of missing) lines.push(`  generated ! ${path}`);
  for (const path of removed) lines.push(`  generated - ${path}`);
  lines.push(`  generated preview: ${added.length} added, ${changed.length} changed, ${missing.length} missing, ${removed.length} removed`);
  lines.push("  next: run skillset build --yes when you want to write generated output");
  return `${lines.join("\n")}\n`;
}

export async function runDevWatch(
  rootPath: string,
  options: SkillsetOptions = {},
  output: NodeJS.WritableStream = process.stdout,
  mode: DevWatchMode = "preview",
  machineMode?: "jsonl",
  runtime: DevWatchRuntime = {
    addSignalListeners: (listener) => {
      process.once("SIGINT", listener);
      process.once("SIGTERM", listener);
    },
    collectDirectories: collectDevWatchDirectories,
    removeSignalListeners: (listener) => {
      process.off("SIGINT", listener);
      process.off("SIGTERM", listener);
    },
    runOnce: runDevWatchOnce,
    scheduler: defaultScheduler,
    watch,
  }
): Promise<void> {
  const plan = await createDevWatchPlan(rootPath, options);
  const stream = machineMode === "jsonl" ? createDevWatchJsonlStream(output) : undefined;
  if (stream === undefined) output.write(renderDevWatchStart(plan, mode));
  else stream.started(plan, mode);
  const writeOperation = async (reason = "initial") => {
    const report = await runtime.runOnce(rootPath, options, mode, reason);
    if (initialSignalReceived) return;
    if (stream === undefined) output.write(renderDevWatchPreview(report));
    else stream.operation(report);
  };
  let activeOperation: Promise<void> | undefined;
  let pendingOperationError: unknown;
  let pendingSignal = false;
  let initialSignalReceived = false;
  let resolveInitialSignal: (() => void) | undefined;
  const initialSignal = new Promise<void>((resolvePromise) => {
    resolveInitialSignal = resolvePromise;
  });
  let stopWithError: ((error: unknown) => void) | undefined;
  let stopFromSignal: (() => void) | undefined;
  const signalStop = () => {
    if (stopFromSignal === undefined) {
      pendingSignal = true;
      initialSignalReceived = true;
      resolveInitialSignal?.();
    } else stopFromSignal();
  };
  const startOperation = async (reason: string) => {
    const previous = activeOperation;
    const operation = (previous ?? Promise.resolve()).then(() => writeOperation(reason));
    activeOperation = operation;
    try {
      await operation;
    } finally {
      if (activeOperation === operation) activeOperation = undefined;
    }
  };
  runtime.addSignalListeners(signalStop);
  const initialOperation = startOperation("initial");
  try {
    await Promise.race([initialOperation, initialSignal]);
  } catch (error) {
    runtime.removeSignalListeners(signalStop);
    if (stream === undefined) throw error;
    stream.failed(error instanceof Error ? error.message : String(error), "initial-operation");
    if (output === process.stdout) process.exitCode = 1;
    return;
  }
  if (pendingSignal) {
    runtime.removeSignalListeners(signalStop);
    void initialOperation.catch(() => {});
    if (stream === undefined) output.write("skillset: dev watch stopped\n");
    else stream.completed();
    return;
  }

  const watchers: FSWatcher[] = [];
  const debouncer = createDevWatchDebouncer(async (reason) => {
    try {
      await startOperation(reason);
    } catch (error) {
      if (stopWithError === undefined) pendingOperationError = error;
      else stopWithError(error);
    }
  }, DEFAULT_DEBOUNCE_MS, runtime.scheduler);

  try {
    for (const watchRoot of await runtime.collectDirectories(plan)) {
      watchers.push(runtime.watch(resolve(plan.rootPath, watchRoot), (_event, filename) => {
        const eventPath = filename === null
          ? undefined
          : normalizeRelativePath(join(watchRoot, filename.toString()));
        if (shouldRunDevPreviewForPath(plan, eventPath)) {
          debouncer.trigger(eventPath ?? "change");
        }
      }));
    }
  } catch (error) {
    for (const watcher of watchers) watcher.close();
    runtime.removeSignalListeners(signalStop);
    if (stream === undefined) throw error;
    stream.failed(error instanceof Error ? error.message : String(error), "watch-setup");
    if (output === process.stdout) process.exitCode = 1;
    return;
  }

  await new Promise<void>((resolvePromise, rejectPromise) => {
    let stopping = false;
    const stop = (operationError?: unknown) => {
      if (stopping) return;
      stopping = true;
      debouncer.cancel();
      for (const watcher of watchers) watcher.close();
      runtime.removeSignalListeners(signalStop);
      void (async () => {
        try {
          await activeOperation;
          if (operationError !== undefined) throw operationError;
          if (stream === undefined) output.write("skillset: dev watch stopped\n");
          else stream.completed();
          resolvePromise();
        } catch (error) {
          if (stream === undefined) rejectPromise(error);
          else {
            stream.failed(error instanceof Error ? error.message : String(error), "operation");
            if (output === process.stdout) process.exitCode = 1;
            resolvePromise();
          }
        }
      })();
    };
    stopFromSignal = () => stop();
    stopWithError = (error) => stop(error);
    if (pendingSignal) stop();
    if (pendingOperationError !== undefined) stop(pendingOperationError);
  });
}

export async function collectDevWatchDirectories(plan: DevWatchPlan): Promise<readonly string[]> {
  const directories = new Set<string>();
  for (const root of plan.watchRoots) {
    const absoluteRoot = resolve(plan.rootPath, root);
    if (!(await isDirectory(absoluteRoot))) continue;
    directories.add(root);
    if (root === plan.sourceRoot) {
      for (const child of await collectDirectories(absoluteRoot)) {
        directories.add(normalizeRelativePath(relative(plan.rootPath, child)));
      }
    }
  }
  return [...directories].sort();
}

function renderDevWatchStart(plan: DevWatchPlan, mode: DevWatchMode): string {
  if (mode === "apply") {
    return [
      "skillset: dev watch started (apply mode)",
      `  source: ${plan.sourceRoot}`,
      `  watching: ${plan.watchRoots.join(", ")}`,
      `  ignoring: ${plan.ignoredRoots.join(", ")}`,
      "  writes: enabled; applies generated output with build ownership and backup safeguards",
      "  recovery: if a backup is reported, use skillset restore <backup-id>",
    ].join("\n") + "\n";
  }

  return [
    "skillset: dev watch started (preview-only)",
    `  source: ${plan.sourceRoot}`,
    `  watching: ${plan.watchRoots.join(", ")}`,
    `  ignoring: ${plan.ignoredRoots.join(", ")}`,
    "  writes: disabled; use skillset build --yes to write generated output",
  ].join("\n") + "\n";
}

async function runDevWatchOnce(
  rootPath: string,
  options: SkillsetOptions,
  mode: DevWatchMode,
  reason = "initial"
): Promise<DevWatchPreviewReport> {
  return mode === "apply"
    ? runDevWatchApply(rootPath, options, reason)
    : runDevWatchPreview(rootPath, options, reason);
}

async function collectDirectories(rootPath: string): Promise<readonly string[]> {
  const directories: string[] = [];
  const entries = await readdir(rootPath, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const child = join(rootPath, entry.name);
    directories.push(child);
    directories.push(...await collectDirectories(child));
  }
  return directories;
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

function normalizeEventPath(rootPath: string, eventPath: string): string | undefined {
  const candidate = isAbsolute(eventPath)
    ? relative(rootPath, eventPath)
    : eventPath;
  const normalized = normalizeRelativePath(candidate);
  if (normalized.startsWith("../") || normalized === "..") return undefined;
  return normalized;
}

function relativePath(rootPath: string, path: string): string {
  return normalizeRelativePath(relative(rootPath, path));
}

function normalizeRelativePath(path: string): string {
  return path.replaceAll("\\", "/").replace(/\/+/gu, "/").replace(/\/$/u, "") || ".";
}

function isSameOrInside(path: string, root: string): boolean {
  const normalizedRoot = normalizeRelativePath(root);
  return path === normalizedRoot || path.startsWith(`${normalizedRoot}/`);
}

function sortedUnique(values: readonly string[]): readonly string[] {
  return [...new Set(values.map(normalizeRelativePath))].sort();
}
