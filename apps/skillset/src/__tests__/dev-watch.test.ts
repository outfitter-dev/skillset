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

test("SET-212: dev apply writes generated output with build safeguards", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillset-dev-watch-apply-"));
  await expect(runSkillsetCli("init", "--root", root, "--yes")).resolves.toMatchObject({ exitCode: 0 });
  await expect(runSkillsetCli("new", "skill", "Review Notes", "--root", root, "--yes")).resolves.toMatchObject({
    exitCode: 0,
  });

  const report = await runDevWatchApply(root, {}, "test");
  const rendered = renderDevWatchPreview(report);

  expect(report.ok).toBe(true);
  expect(report.mode).toBe("apply");
  expect(report.writes?.writtenPaths.length).toBeGreaterThan(0);
  expect(report.writes?.writtenPaths).toContain(".claude/skills/review-notes/SKILL.md");
  expect(await Bun.file(join(root, ".claude/skills/review-notes/SKILL.md")).exists()).toBe(true);
  expect(rendered).toContain("skillset: dev apply passed (test)");
  expect(rendered).toContain("generated apply:");
  expect(rendered).toContain("generated output applied");

  const freshReport = await runDevWatchApply(root, {}, "fresh");
  const freshRendered = renderDevWatchPreview(freshReport);

  expect(freshReport.ok).toBe(true);
  expect(freshReport.writes?.writtenPaths).toEqual([]);
  expect(freshReport.writes?.deletedPaths).toEqual([]);
  expect(freshRendered).toContain("generated output already fresh");
});

test("SET-212: dev apply reports backup recovery guidance", async () => {
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

test("SET-212: dev apply failures render recovery guidance", () => {
  const rendered = renderDevWatchPreview({
    checkedSkills: 0,
    diagnostics: [],
    diff: { added: [], changed: [], missing: [], removed: [] },
    error: "write failed",
    mode: "apply",
    ok: false,
    outputRoots: [".claude/skills"],
    reason: "test",
    sourceRoot: ".skillset",
    warnings: [],
  });

  expect(rendered).toContain("skillset: dev apply failed (test)");
  expect(rendered).toContain("no completed apply was reported");
  expect(rendered).toContain("skillset restore <backup-id>");
});

test("SET-210/SET-212: dev command validation keeps writes explicitly opt-in", async () => {
  const missingWatch = await runSkillsetCli("dev");
  expect(missingWatch.exitCode).toBe(1);
  expect(missingWatch.stderr).toContain("dev currently requires --watch");

  const writeFlag = await runSkillsetCli("dev", "--watch", "--yes");
  expect(writeFlag.exitCode).toBe(1);
  expect(writeFlag.stderr).toContain("write mode with --apply");

  const applyWrongCommand = await runSkillsetCli("build", "--apply");
  expect(applyWrongCommand.exitCode).toBe(1);
  expect(applyWrongCommand.stderr).toContain("--apply is only supported with dev");

  const wrongCommand = await runSkillsetCli("build", "--watch");
  expect(wrongCommand.exitCode).toBe(1);
  expect(wrongCommand.stderr).toContain("--watch is only supported with dev");
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

  await runDevWatch(root, {}, { write: (chunk) => { output += String(chunk); return true; } } as NodeJS.WritableStream, "preview", "jsonl", {
    addSignalListeners: () => {},
    collectDirectories: async () => ["."],
    removeSignalListeners: () => {},
    runOnce: runDevWatchPreview,
    scheduler: { clearTimeout: () => {}, setTimeout: () => 0 },
    watch: () => { throw new Error("watch setup failed"); },
  });

  const events = parseCliEventStream(output);
  expect(events.map((event) => event.event)).toEqual(["started", "operation", "failed"]);
  expect(events.map((event) => event.sequence)).toEqual([1, 2, 3]);
  expect(events[2]?.data).toMatchObject({ stage: "watch-setup" });
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
  expect(events.map((event) => event.event)).toEqual(["started", "operation", "completed"]);
});

test("SET-289: dev --jsonl terminates a real controlled stream without human output", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillset-dev-jsonl-"));
  await expect(runSkillsetCli("init", "--root", root, "--yes")).resolves.toMatchObject({ exitCode: 0 });
  const proc = Bun.spawn({
    cmd: ["bun", join(import.meta.dir, "..", "cli.ts"), "dev", "--watch", "--jsonl", "--root", root],
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
