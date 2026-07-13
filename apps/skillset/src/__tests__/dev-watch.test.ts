import { mkdir, mkdtemp } from "node:fs/promises";
import type { FSWatcher } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, test } from "bun:test";

import {
  createDevWatchJsonlStream,
  createDevWatchDebouncer,
  createDevWatchPlan,
  renderDevWatchPreview,
  runDevWatch,
  runDevWatchApply,
  runDevWatchPreview,
  shouldRunDevPreviewForPath,
  type DevWatchPreviewReport,
  type DevWatchScheduler,
} from "../dev-watch";
import { parseCliEventStream } from "../cli-output";

test("SET-210: dev watch plan covers ordinary source and ignores generated churn", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillset-dev-watch-ordinary-"));
  await expect(runSkillsetCli("init", "--root", root, "--yes")).resolves.toMatchObject({ exitCode: 0 });
  await expect(runSkillsetCli("new", "skill", "Review Notes", "--root", root, "--yes")).resolves.toMatchObject({
    exitCode: 0,
  });

  const plan = await createDevWatchPlan(root);

  expect(plan.sourceRoot).toBe(".skillset");
  expect(plan.configPaths).toEqual(["skillset.yaml"]);
  expect(plan.watchRoots).toContain(".skillset");
  expect(plan.watchRoots).toContain(".skillset");
  expect(plan.ignoredRoots).toContain(".skillset/cache");
  expect(plan.ignoredRoots).toContain(".skillset/snapshots");
  expect(plan.ignoredRoots).toContain(".agents/skills");
  expect(plan.ignoredRoots).toContain(".claude/skills");

  expect(shouldRunDevPreviewForPath(plan, ".skillset/skills/review-notes/SKILL.md")).toBe(true);
  expect(shouldRunDevPreviewForPath(plan, "skillset.yaml")).toBe(true);
  expect(shouldRunDevPreviewForPath(plan, ".agents/skills/review-notes/SKILL.md")).toBe(false);
  expect(shouldRunDevPreviewForPath(plan, ".skillset/cache/reports/skillset-ci-report.md")).toBe(false);
  expect(shouldRunDevPreviewForPath(plan, ".skillset/snapshots/run/manifest.json")).toBe(false);
  expect(shouldRunDevPreviewForPath(plan, "skillset.lock")).toBe(false);
  expect(shouldRunDevPreviewForPath(plan, "AGENTS.md")).toBe(false);
  expect(shouldRunDevPreviewForPath(plan, undefined)).toBe(true);
});

test("SET-210: dev watch plan covers created source repos", async () => {
  const parent = await mkdtemp(join(tmpdir(), "skillset-dev-watch-root-"));
  await expect(runSkillsetCli("init", "team-loadout", "--root", parent, "--yes")).resolves.toMatchObject({
    exitCode: 0,
  });
  const root = join(parent, "team-loadout");
  await expect(runSkillsetCli("new", "skill", "Review Notes", "--root", root, "--yes")).resolves.toMatchObject({
    exitCode: 0,
  });

  const plan = await createDevWatchPlan(root);

  expect(plan.sourceRoot).toBe(".skillset");
  expect(plan.configPaths).toEqual(["skillset.yaml"]);
  expect(plan.watchRoots).toContain(".skillset");
  expect(shouldRunDevPreviewForPath(plan, ".skillset/skills/review-notes/SKILL.md")).toBe(true);
  expect(shouldRunDevPreviewForPath(plan, "skillset.yaml")).toBe(true);
  expect(shouldRunDevPreviewForPath(plan, ".claude/skills/review-notes/SKILL.md")).toBe(false);
});

test("SET-210: dev watch debounces repeated triggers without sleeping", () => {
  const scheduled: Array<{ callback: () => void; cleared: boolean; delayMs: number }> = [];
  const scheduler: DevWatchScheduler = {
    clearTimeout: (handle) => {
      scheduled[handle as number]!.cleared = true;
    },
    setTimeout: (callback, delayMs) => {
      scheduled.push({ callback, cleared: false, delayMs });
      return scheduled.length - 1;
    },
  };
  const reasons: string[] = [];

  const debouncer = createDevWatchDebouncer((reason) => {
    reasons.push(reason);
  }, 50, scheduler);
  debouncer.trigger("first");
  debouncer.trigger("second");

  expect(scheduled).toEqual([
    { callback: expect.any(Function), cleared: true, delayMs: 50 },
    { callback: expect.any(Function), cleared: false, delayMs: 50 },
  ]);
  if (!scheduled[0]!.cleared) scheduled[0]!.callback();
  expect(reasons).toEqual([]);
  if (!scheduled[1]!.cleared) scheduled[1]!.callback();
  expect(reasons).toEqual(["second"]);
});

test("SET-210: dev preview reports clean generated-output state", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillset-dev-watch-preview-"));
  await expect(runSkillsetCli("init", "--root", root, "--yes")).resolves.toMatchObject({ exitCode: 0 });
  await expect(runSkillsetCli("new", "skill", "Review Notes", "--root", root, "--yes")).resolves.toMatchObject({
    exitCode: 0,
  });
  await expect(runSkillsetCli("build", "--root", root, "--yes")).resolves.toMatchObject({ exitCode: 0 });

  const report = await runDevWatchPreview(root, {}, "test");
  const rendered = renderDevWatchPreview(report);

  expect(report.ok).toBe(true);
  expect(rendered).toContain("skillset: dev preview passed (test)");
  expect(rendered).toContain("source diagnostics: checked 1 source skill");
  expect(rendered).toContain("generated preview: 0 added, 0 changed, 0 missing, 0 removed");
  expect(rendered).toContain("run skillset build --yes");
});

test("SET-212: dev write writes generated output with build safeguards", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillset-dev-watch-apply-"));
  await expect(runSkillsetCli("init", "--root", root, "--yes")).resolves.toMatchObject({ exitCode: 0 });
  await expect(runSkillsetCli("new", "skill", "Review Notes", "--root", root, "--yes")).resolves.toMatchObject({
    exitCode: 0,
  });

  const report = await runDevWatchApply(root, {}, "test");
  const rendered = renderDevWatchPreview(report);

  expect(report.ok).toBe(true);
  expect(report.mode).toBe("write");
  expect(report.writes?.writtenPaths.length).toBeGreaterThan(0);
  expect(report.writes?.writtenPaths).toContain(".claude/skills/review-notes/SKILL.md");
  expect(await Bun.file(join(root, ".claude/skills/review-notes/SKILL.md")).exists()).toBe(true);
  expect(rendered).toContain("skillset: dev write passed (test)");
  expect(rendered).toContain("generated write:");
  expect(rendered).toContain("generated output applied");

  const freshReport = await runDevWatchApply(root, {}, "fresh");
  const freshRendered = renderDevWatchPreview(freshReport);

  expect(freshReport.ok).toBe(true);
  expect(freshReport.writes?.writtenPaths).toEqual([]);
  expect(freshReport.writes?.deletedPaths).toEqual([]);
  expect(freshRendered).toContain("generated output already fresh");
});

test("SET-212: dev write reports backup recovery guidance", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillset-dev-watch-apply-backup-"));
  await expect(runSkillsetCli("init", "--root", root, "--yes")).resolves.toMatchObject({ exitCode: 0 });
  await expect(runSkillsetCli("new", "skill", "Review Notes", "--root", root, "--yes")).resolves.toMatchObject({
    exitCode: 0,
  });
  await mkdir(join(root, ".claude/skills/review-notes"), { recursive: true });
  await Bun.write(join(root, ".claude/skills/review-notes/SKILL.md"), "hand-authored collision\n");

  const report = await runDevWatchApply(root, {}, "test");
  const rendered = renderDevWatchPreview(report);

  expect(report.ok).toBe(true);
  expect(report.writes?.backupRunId).toBeString();
  expect(report.writes?.backupManifestPath).toBe(`.skillset/snapshots/${report.writes?.backupRunId}/manifest.json`);
  expect(rendered).toContain("backup: 1 file saved");
  expect(rendered).toContain(`skillset restore ${report.writes?.backupRunId} --yes`);
});

test("SET-212: dev write failures render recovery guidance", () => {
  const rendered = renderDevWatchPreview({
    checkedSkills: 0,
    diagnostics: [],
    diff: { added: [], changed: [], missing: [], removed: [] },
    error: "write failed",
    mode: "write",
    ok: false,
    outputRoots: [".claude/skills"],
    reason: "test",
    sourceRoot: ".skillset",
    warnings: [],
  });

  expect(rendered).toContain("skillset: dev write failed (test)");
  expect(rendered).toContain("no completed write was reported");
  expect(rendered).toContain("skillset restore <backup-id>");
});

test("SET-210/SET-212: dev command validation keeps writes explicitly opt-in", async () => {
  const writeFlag = await runSkillsetCli("dev", "--yes");
  expect(writeFlag.exitCode).toBe(1);
  expect(writeFlag.stderr).toContain("write mode with --write");

  const applyWrongCommand = await runSkillsetCli("build", "--apply");
  expect(applyWrongCommand.exitCode).toBe(1);
  expect(applyWrongCommand.stderr).toContain("unknown option --apply");

  const wrongCommand = await runSkillsetCli("build", "--watch");
  expect(wrongCommand.exitCode).toBe(1);
  expect(wrongCommand.stderr).toContain("unknown option --watch");
});

test("SET-289: dev JSONL emits controlled started, operation, and terminal events", () => {
  let output = "";
  const stream = createDevWatchJsonlStream({ write: (chunk) => { output += String(chunk); return true; } });
  stream.started({
    configPaths: ["skillset.yaml"],
    ignoredRoots: ["plugins"],
    outputRoots: ["plugins"],
    rootPath: "/repo",
    sourceRoot: ".skillset",
    watchRoots: [".", ".skillset"],
  }, "preview");
  stream.operation({
    checkedSkills: 1,
    diagnostics: [],
    diff: { added: [], changed: [], missing: [], removed: [] },
    mode: "preview",
    ok: true,
    outputRoots: ["plugins"],
    reason: "initial",
    sourceRoot: ".skillset",
    warnings: [],
  });
  stream.completed();
  const events = parseCliEventStream(output);
  expect(events.map((event) => event.event)).toEqual(["started", "operation", "completed"]);
  expect(events.map((event) => event.sequence)).toEqual([1, 2, 3]);
  expect(output).not.toContain("skillset: dev");
});

test("SET-289: JSONL watch setup failures stay in the active sequence", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillset-dev-jsonl-setup-"));
  await expect(runSkillsetCli("init", "--root", root, "--yes")).resolves.toMatchObject({ exitCode: 0 });
  let output = "";
  let exitCode: number | undefined;

  await runDevWatch(root, {}, { write: (chunk) => { output += String(chunk); return true; } } as NodeJS.WritableStream, "preview", "jsonl", {
    addSignalListeners: () => {},
    collectDirectories: async () => ["."],
    removeSignalListeners: () => {},
    runOnce: runDevWatchPreview,
    scheduler: { clearTimeout: () => {}, setTimeout: () => 0 },
    setExitCode: (code) => { exitCode = code; },
    watch: () => { throw new Error("watch setup failed"); },
  });

  const events = parseCliEventStream(output);
  expect(events.map((event) => event.event)).toEqual(["started", "operation", "failed"]);
  expect(events.map((event) => event.sequence)).toEqual([1, 2, 3]);
  expect(events[2]?.data).toMatchObject({ stage: "watch-setup" });
  expect(exitCode).toBe(3);
});

test("SET-289: initial JSONL operation failures stay in the active sequence", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillset-dev-jsonl-initial-failure-"));
  await expect(runSkillsetCli("init", "--root", root, "--yes")).resolves.toMatchObject({ exitCode: 0 });
  let output = "";

  await runDevWatch(root, {}, { write: (chunk) => { output += String(chunk); return true; } } as NodeJS.WritableStream, "preview", "jsonl", {
    addSignalListeners: () => {},
    collectDirectories: async () => ["."],
    removeSignalListeners: () => {},
    runOnce: async () => { throw new Error("initial operation failed"); },
    scheduler: { clearTimeout: () => {}, setTimeout: () => 0 },
    watch: () => ({ close: () => {} } as FSWatcher),
  });

  const events = parseCliEventStream(output);
  expect(events.map((event) => event.event)).toEqual(["started", "failed"]);
  expect(events.map((event) => event.sequence)).toEqual([1, 2]);
  expect(events[1]?.data).toMatchObject({ message: "initial operation failed", stage: "initial-operation" });
});

test("SET-289: debounced JSONL operation failures terminate the active sequence", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillset-dev-jsonl-operation-"));
  await expect(runSkillsetCli("init", "--root", root, "--yes")).resolves.toMatchObject({ exitCode: 0 });
  let output = "";
  let runs = 0;

  await runDevWatch(root, {}, { write: (chunk) => { output += String(chunk); return true; } } as NodeJS.WritableStream, "preview", "jsonl", {
    addSignalListeners: () => {},
    collectDirectories: async () => ["."],
    removeSignalListeners: () => {},
    runOnce: async (runRoot, runOptions, _mode, reason) => {
      runs += 1;
      if (runs > 1) throw new Error("debounced operation failed");
      return runDevWatchPreview(runRoot, runOptions, reason);
    },
    scheduler: { clearTimeout: () => {}, setTimeout: (callback) => { callback(); return 0; } },
    watch: ((_path: string, callback: (event: string, filename: string | null) => void) => {
      queueMicrotask(() => callback("change", "skillset.yaml"));
      return { close: () => {} } as FSWatcher;
    }) as typeof import("node:fs").watch,
  });

  const events = parseCliEventStream(output);
  expect(events.map((event) => event.event)).toEqual(["started", "operation", "failed"]);
  expect(events[2]?.data).toMatchObject({ message: "debounced operation failed", stage: "operation" });
});

test("SET-289: JSONL signals during the initial operation still terminate the sequence", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillset-dev-jsonl-initial-signal-"));
  await expect(runSkillsetCli("init", "--root", root, "--yes")).resolves.toMatchObject({ exitCode: 0 });
  let output = "";

  await runDevWatch(root, {}, { write: (chunk) => { output += String(chunk); return true; } } as NodeJS.WritableStream, "preview", "jsonl", {
    addSignalListeners: (listener) => listener(),
    collectDirectories: async () => ["."],
    removeSignalListeners: () => {},
    runOnce: runDevWatchPreview,
    scheduler: { clearTimeout: () => {}, setTimeout: () => 0 },
    watch: () => ({ close: () => {} } as FSWatcher),
  });

  const events = parseCliEventStream(output);
  expect(events.map((event) => event.event)).toEqual(["started", "completed"]);
});

test("SET-289: signals do not wait for a stalled initial operation", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillset-dev-jsonl-stalled-initial-signal-"));
  await expect(runSkillsetCli("init", "--root", root, "--yes")).resolves.toMatchObject({ exitCode: 0 });
  let output = "";
  let signal: (() => void) | undefined;
  let markStarted: (() => void) | undefined;
  const started = new Promise<void>((resolvePromise) => {
    markStarted = resolvePromise;
  });
  const stalled = new Promise<DevWatchPreviewReport>(() => {});

  const watching = runDevWatch(root, {}, { write: (chunk) => { output += String(chunk); return true; } } as NodeJS.WritableStream, "preview", "jsonl", {
    addSignalListeners: (listener) => { signal = listener; },
    collectDirectories: async () => ["."],
    removeSignalListeners: () => {},
    runOnce: async () => {
      markStarted?.();
      return stalled;
    },
    scheduler: { clearTimeout: () => {}, setTimeout: () => 0 },
    watch: () => ({ close: () => {} } as FSWatcher),
  });

  await started;
  signal?.();
  await expect(Promise.race([
    watching.then(() => "stopped"),
    Bun.sleep(100).then(() => "timed-out"),
  ])).resolves.toBe("stopped");
  expect(parseCliEventStream(output).map((event) => event.event)).toEqual(["started", "completed"]);
});

test("SET-289: signals do not wait for stalled watch-root collection", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillset-dev-jsonl-stalled-roots-signal-"));
  await expect(runSkillsetCli("init", "--root", root, "--yes")).resolves.toMatchObject({ exitCode: 0 });
  let output = "";
  let signal: (() => void) | undefined;
  let markCollecting: (() => void) | undefined;
  const collecting = new Promise<void>((resolvePromise) => {
    markCollecting = resolvePromise;
  });
  const stalled = new Promise<readonly string[]>(() => {});

  const watching = runDevWatch(root, {}, { write: (chunk) => { output += String(chunk); return true; } } as NodeJS.WritableStream, "preview", "jsonl", {
    addSignalListeners: (listener) => { signal = listener; },
    collectDirectories: async () => {
      markCollecting?.();
      return stalled;
    },
    removeSignalListeners: () => {},
    runOnce: runDevWatchPreview,
    scheduler: { clearTimeout: () => {}, setTimeout: () => 0 },
    watch: () => ({ close: () => {} } as FSWatcher),
  });

  await collecting;
  signal?.();
  await expect(Promise.race([
    watching.then(() => "stopped"),
    Bun.sleep(100).then(() => "timed-out"),
  ])).resolves.toBe("stopped");
  expect(parseCliEventStream(output).map((event) => event.event)).toEqual([
    "started",
    "operation",
    "completed",
  ]);
});

test("SET-289: apply signals wait for the initial write before completing", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillset-dev-jsonl-apply-signal-"));
  await expect(runSkillsetCli("init", "--root", root, "--yes")).resolves.toMatchObject({ exitCode: 0 });
  let output = "";
  let signal: (() => void) | undefined;
  let markStarted: (() => void) | undefined;
  let finishApply: ((report: DevWatchPreviewReport) => void) | undefined;
  const started = new Promise<void>((resolvePromise) => {
    markStarted = resolvePromise;
  });
  const apply = new Promise<DevWatchPreviewReport>((resolvePromise) => {
    finishApply = resolvePromise;
  });

  const watching = runDevWatch(root, {}, { write: (chunk) => { output += String(chunk); return true; } } as NodeJS.WritableStream, "apply", "jsonl", {
    addSignalListeners: (listener) => { signal = listener; },
    collectDirectories: async () => ["."],
    removeSignalListeners: () => {},
    runOnce: async () => {
      markStarted?.();
      return apply;
    },
    scheduler: { clearTimeout: () => {}, setTimeout: () => 0 },
    watch: () => ({ close: () => {} } as FSWatcher),
  });

  await started;
  signal?.();
  await expect(Promise.race([
    watching.then(() => "stopped"),
    Bun.sleep(50).then(() => "pending"),
  ])).resolves.toBe("pending");
  finishApply?.({
    checkedSkills: 1,
    diagnostics: [],
    diff: { added: [], changed: [], missing: [], removed: [] },
    mode: "apply",
    ok: true,
    outputRoots: [".claude/skills"],
    reason: "initial",
    sourceRoot: ".skillset",
    warnings: [],
    writes: {
      deletedPaths: [],
      mode: "write",
      paths: [".claude/skills/demo/SKILL.md"],
      writtenPaths: [".claude/skills/demo/SKILL.md"],
    },
  });
  await watching;

  expect(parseCliEventStream(output).map((event) => event.event)).toEqual(["started", "operation", "completed"]);
});

test("SET-289: shutdown cancels operations queued behind an active run", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillset-dev-jsonl-queued-signal-"));
  await expect(runSkillsetCli("init", "--root", root, "--yes")).resolves.toMatchObject({ exitCode: 0 });
  let output = "";
  let runs = 0;
  let signal: (() => void) | undefined;
  let trigger: ((event: string, filename: string | null) => void) | undefined;
  let finishChange: ((report: DevWatchPreviewReport) => void) | undefined;
  let markWatching: (() => void) | undefined;
  const watchingReady = new Promise<void>((resolvePromise) => {
    markWatching = resolvePromise;
  });
  const activeChange = new Promise<DevWatchPreviewReport>((resolvePromise) => {
    finishChange = resolvePromise;
  });

  const watching = runDevWatch(root, {}, { write: (chunk) => { output += String(chunk); return true; } } as NodeJS.WritableStream, "preview", "jsonl", {
    addSignalListeners: (listener) => { signal = listener; },
    collectDirectories: async () => ["."],
    removeSignalListeners: () => {},
    runOnce: async (runRoot, runOptions, _mode, reason) => {
      runs += 1;
      if (runs === 2) return activeChange;
      return runDevWatchPreview(runRoot, runOptions, reason);
    },
    scheduler: { clearTimeout: () => {}, setTimeout: (callback) => { callback(); return 0; } },
    watch: ((_path: string, callback: (event: string, filename: string | null) => void) => {
      trigger = callback;
      markWatching?.();
      return { close: () => {} } as FSWatcher;
    }) as typeof import("node:fs").watch,
  });

  await watchingReady;
  trigger?.("change", "skillset.yaml");
  await Promise.resolve();
  trigger?.("change", ".skillset/skills/demo/SKILL.md");
  signal?.();
  finishChange?.(await runDevWatchPreview(root, {}, "skillset.yaml"));
  await watching;

  expect(runs).toBe(2);
  expect(parseCliEventStream(output).map((event) => event.event)).toEqual([
    "started",
    "operation",
    "operation",
    "completed",
  ]);
});

test("SET-289: dev --jsonl terminates a real controlled stream without human output", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillset-dev-jsonl-"));
  await expect(runSkillsetCli("init", "--root", root, "--yes")).resolves.toMatchObject({ exitCode: 0 });
  const proc = Bun.spawn({
    cmd: ["bun", join(import.meta.dir, "..", "cli.ts"), "dev", "--jsonl", "--root", root],
    stderr: "pipe",
    stdout: "pipe",
  });
  const timer = setTimeout(() => proc.kill("SIGTERM"), 1000);
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  clearTimeout(timer);
  expect(exitCode).toBe(0);
  expect(stderr).toBe("");
  const events = parseCliEventStream(stdout);
  expect(events.map((event) => event.event)).toEqual(["started", "operation", "completed"]);
  expect(stdout).not.toContain("skillset: dev");
});

async function runSkillsetCli(...args: readonly string[]): Promise<{
  readonly exitCode: number;
  readonly stderr: string;
  readonly stdout: string;
}> {
  const proc = Bun.spawn({
    cmd: ["bun", join(import.meta.dir, "..", "cli.ts"), ...args],
    stderr: "pipe",
    stdout: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { exitCode, stderr, stdout };
}
