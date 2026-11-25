import { mkdir, rm, symlink } from "node:fs/promises";
import type { FSWatcher } from "node:fs";
import { basename, join } from "node:path";
import { Writable } from "node:stream";

import { expect, test } from "bun:test";

import { createTestFixtureRoot } from "../../../../scripts/test-helpers/fixture-root";
import { reapOwnedProcess, waitForCondition } from "../../../../scripts/test-helpers/wait";
import {
  collectDevWatchDirectories,
  createDevWatchJsonlStream,
  createDevWatchDebouncer,
  createDevWatchPlan,
  renderDevWatchPreview,
  runDevWatch,
  runDevWatchApply,
  runDevWatchPreview,
  shouldRunDevPreviewForPath,
  type DevWatchPlan,
  type DevWatchPreviewReport,
  type DevWatchScheduler,
} from "../dev-watch";
import { parseCliEventStream } from "../cli-output";

test("SET-647: missing watch roots stay omitted and a watch-root loop raises", async () => {
  const root = await createTestFixtureRoot("skillset-dev-watch-existence-");
  const loop = join(root, "loop");
  await symlink(basename(loop), loop);
  const plan = (watchRoots: readonly string[]): DevWatchPlan => ({
    configPaths: ["skillset.yaml"],
    ignoredRoots: [],
    outputRoots: [],
    rootPath: root,
    sourceRoot: ".skillset",
    watchRoots,
  });

  await expect(collectDevWatchDirectories(plan(["missing"]))).resolves.toEqual([]);
  await mkdir(join(root, ".skillset"), { recursive: true });
  await expect(collectDevWatchDirectories(plan([".skillset"]))).resolves.toEqual([
    ".skillset",
  ]);
  await expect(collectDevWatchDirectories(plan(["loop"]))).rejects.toMatchObject({
    code: "ELOOP",
    path: loop,
  });
});

test("SET-210: dev watch plan covers ordinary source and ignores generated churn", async () => {
  const root = await createTestFixtureRoot("skillset-dev-watch-ordinary-");
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
  const parent = await createTestFixtureRoot("skillset-dev-watch-root-");
  await expect(runSkillsetCli("create", "team-loadout", "--root", parent, "--yes")).resolves.toMatchObject({
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

test("native root guidance triggers preview without watching generated AGENTS files", async () => {
  const root = await createTestFixtureRoot("skillset-native-watch-");
  await Bun.write(join(root, "AGENTS.md"), "# Authored\n");
  await expect(runSkillsetCli("init", "--root", root, "--yes")).resolves.toMatchObject({ exitCode: 0 });
  const plan = await createDevWatchPlan(root);
  expect(shouldRunDevPreviewForPath(plan, "AGENTS.md")).toBe(true);
  expect(shouldRunDevPreviewForPath(plan, "AGENTS.override.md")).toBe(true);
  expect(shouldRunDevPreviewForPath(plan, "nested/AGENTS.md")).toBe(false);
  expect(shouldRunDevPreviewForPath(plan, "nested/AGENTS.override.md")).toBe(false);
});

test.each(["during", "after"] as const)("watch retries when authored guidance appears %s a configuration refresh", async (arrival) => {
  const root = await createTestFixtureRoot("skillset-native-watch-transition-");
  await expect(runSkillsetCli("init", "--root", root, "--yes")).resolves.toMatchObject({ exitCode: 0 });
  let trigger: ((event: string, filename: string | null) => void) | undefined;
  let stop: (() => void) | undefined;
  let runs = 0;
  let scheduledRuns = 0;
  let resumeRefresh: (() => void) | undefined;
  let refreshPaused: (() => void) | undefined;
  const paused = new Promise<void>((resolve) => { refreshPaused = resolve; });
  let pauseGeneratedRefresh = false;
  let generatedRefreshPaused: (() => void) | undefined;
  const generatedPaused = new Promise<void>((resolve) => { generatedRefreshPaused = resolve; });
  let output = "";
  const operationCount = () => output.split("\n").filter((line) => line.includes('"event":"operation"')).length;
  let ready: (() => void) | undefined;
  const watchingReady = new Promise<void>((resolve) => { ready = resolve; });
  const watching = runDevWatch(root, {}, { write: (chunk) => { output += String(chunk); return true; } } as NodeJS.WritableStream, "preview", "jsonl", {
    addSignalListeners: (listener) => { stop = listener; },
    removeSignalListeners: () => {},
    collectDirectories: async () => ["."],
    runOnce: async (runRoot, options, _mode, reason) => {
      runs += 1;
      const report = await runDevWatchPreview(runRoot, options, reason);
      if (arrival === "during" && report.error?.includes("requires authored root AGENTS.md")) {
        const resume = new Promise<void>((resolve) => { resumeRefresh = resolve; });
        refreshPaused?.();
        await resume;
      }
      if (pauseGeneratedRefresh && reason === "skillset.yaml") {
        pauseGeneratedRefresh = false;
        const resume = new Promise<void>((resolve) => { resumeRefresh = resolve; });
        generatedRefreshPaused?.();
        await resume;
      }
      return report;
    },
    scheduler: { clearTimeout: () => {}, setTimeout: (callback) => { scheduledRuns += 1; callback(); return 0; } },
    watch: ((_path: string, callback: (event: string, filename: string | null) => void) => {
      trigger = callback;
      ready?.();
      return { close: () => {} } as FSWatcher;
    }) as typeof import("node:fs").watch,
  });
  await watchingReady;
  await Bun.write(join(root, "skillset.yaml"), "workspace: [invalid\n");
  trigger?.("change", "skillset.yaml");
  await waitForCondition("invalid transition preview", () => operationCount() === 2);
  expect(output).toContain('"ok":false');
  expect(await runDevWatchApply(root)).toMatchObject({ ok: false, mode: "write", error: expect.any(String) });
  await rm(join(root, ".skillset/RULES.md"));
  await Bun.write(join(root, "skillset.yaml"), "workspace:\n  nativeAgents: true\n");
  trigger?.("change", "skillset.yaml");
  if (arrival === "during") {
    await paused;
  } else {
    await waitForCondition("missing authored guidance reported", () => operationCount() === 3);
  }
  await Bun.write(join(root, "AGENTS.md"), "# Authored\n");
  trigger?.("rename", "AGENTS.md");
  resumeRefresh?.();
  await waitForCondition("authored guidance appeared", () => operationCount() === 4);
  expect(output).toContain("requires authored root AGENTS.md");
  expect(output.trim().split("\n").at(-1)).toContain('"ok":true');
  trigger?.("change", "AGENTS.md");
  await waitForCondition("native guidance preview", () => operationCount() === 5);
  await Bun.write(join(root, "AGENTS.override.md"), "# Override\n");
  trigger?.("rename", "AGENTS.override.md");
  await waitForCondition("native override appeared", () => operationCount() === 6);
  expect(output.trim().split("\n").at(-1)).toContain("codex-agents-override-shadow");
  await rm(join(root, "AGENTS.override.md"));
  trigger?.("rename", "AGENTS.override.md");
  await waitForCondition("native override removed", () => operationCount() === 7);
  expect(output.trim().split("\n").at(-1)).not.toContain("codex-agents-override-shadow");
  await Bun.write(join(root, ".skillset/RULES.md"), "# Generated source\n");
  await rm(join(root, "AGENTS.md"));
  await Bun.write(join(root, "skillset.yaml"), "compile:\n  targets: [codex]\n");
  pauseGeneratedRefresh = true;
  trigger?.("change", "skillset.yaml");
  await generatedPaused;
  const scheduledBeforeGeneratedOutput = scheduledRuns;
  try {
    expect(await runDevWatchApply(root)).toMatchObject({ ok: true });
    expect(await Bun.file(join(root, "AGENTS.md")).exists()).toBe(true);
    trigger?.("change", "AGENTS.md");
    resumeRefresh?.();
    await waitForCondition("generated transition preview", () => operationCount() >= 8);
    trigger?.("change", "AGENTS.md");
    trigger?.("change", "nested/AGENTS.md");
  } finally {
    resumeRefresh?.();
    stop?.();
    await watching;
  }
  expect(scheduledRuns).toBe(scheduledBeforeGeneratedOutput);
  expect(runs).toBe(8);
});

test.each([
  { guidance: "authored", timing: "after", failures: 1, checkFails: false },
  { guidance: "generated", timing: "after", failures: 1, checkFails: false },
  { guidance: "authored", timing: "during", failures: 1, checkFails: false },
  { guidance: "generated", timing: "during", failures: 1, checkFails: false },
  { guidance: "authored", timing: "during", failures: 2, checkFails: false },
  { guidance: "authored", timing: "during", failures: 1, checkFails: true },
] as const)(
  "SET-882: $guidance event $timing refresh (planner failures: $failures, check fails: $checkFails)",
  async ({ guidance, timing, failures, checkFails }) => {
    const root = await createTestFixtureRoot("skillset-watch-refresh-retry-");
    const agents = join(root, "AGENTS.md");
    const config = join(root, "skillset.yaml");
    await Bun.write(agents, "# Project notes\n");
    await expect(runSkillsetCli("init", "--root", root, "--yes")).resolves.toMatchObject({ exitCode: 0 });
    let trigger: ((event: string, filename: string | null) => void) | undefined;
    let stop: (() => void) | undefined;
    let failuresRemaining = 0;
    let failedRefreshes = 0;
    let pauseFailure = timing === "during";
    let planAttempts = 0;
    let planReads = 0;
    let scheduled = 0;
    let resumeRefresh: (() => void) | undefined;
    let failNextCheck: string | undefined = checkFails ? "AGENTS.md" : undefined;
    const failedChecks: string[] = [];
    const reasons: string[] = [];
    const mode = guidance === "generated" && timing === "during" ? "write" : "preview";
    const output = new Writable({ write: (_chunk, _encoding, done) => done() });
    const watching = runDevWatch(root, {}, output, mode, "jsonl", {
      addSignalListeners: (listener) => { stop = listener; },
      removeSignalListeners: () => {},
      collectDirectories: async () => ["."],
      createPlan: async (runRoot, options) => {
        planAttempts += 1;
        if (failuresRemaining > 0) {
          failuresRemaining -= 1;
          if (pauseFailure) {
            pauseFailure = false;
            await new Promise<void>((resolve) => { resumeRefresh = resolve; });
          }
          failedRefreshes += 1;
          throw new Error("transient plan refresh failure");
        }
        const plan = await createDevWatchPlan(runRoot, options);
        planReads += 1;
        return plan;
      },
      runOnce: async (runRoot, options, runMode, reason) => {
        const report = runMode === "write"
          ? await runDevWatchApply(runRoot, options, reason)
          : await runDevWatchPreview(runRoot, options, reason);
        reasons.push(report.reason);
        expect(report.ok).toBe(true);
        if (failNextCheck === report.reason) {
          failNextCheck = undefined;
          failedChecks.push(report.reason);
          return { ...report, ok: false, error: "transient check failure" };
        }
        return report;
      },
      scheduler: { clearTimeout: () => {}, setTimeout: (callback) => { scheduled += 1; callback(); return 0; } },
      watch: ((_path: string, callback: (event: string, filename: string | null) => void) => {
        trigger = callback;
        return { close: () => {} } as FSWatcher;
      }) as typeof import("node:fs").watch,
    });
    try {
      await waitForCondition("watch setup", () => trigger !== undefined, { timeoutMs: 2_000 });
      if (guidance === "generated") {
        await rm(agents);
        await Bun.write(join(root, ".skillset/RULES.md"), "# Generated source\n");
        await Bun.write(config, "compile:\n  targets: [codex]\n");
      } else {
        await Bun.write(config, "workspace:\n  nativeAgents: true\ncompile:\n  targets: [codex]\n");
      }
      failuresRemaining = failures;
      trigger?.("change", "skillset.yaml");
      if (timing === "during") {
        await waitForCondition("in-flight configuration refresh", () => resumeRefresh !== undefined, { timeoutMs: 2_000 });
      } else {
        await waitForCondition("failed configuration refresh", () => failedRefreshes === 1, { timeoutMs: 2_000 });
      }
      expect(reasons).toEqual(["initial", "skillset.yaml"]);
      expect(scheduled).toBe(1);
      if (guidance === "generated") {
        if (mode === "preview") expect(await runDevWatchApply(root)).toMatchObject({ ok: true });
        expect(await Bun.file(agents).exists()).toBe(true);
      } else {
        await Bun.write(agents, "# Updated project notes\n");
      }
      trigger?.("change", "AGENTS.md");
      resumeRefresh?.();
      if (failures === 2) {
        await waitForCondition("one failed reclassification", () => failedRefreshes === 2, { timeoutMs: 2_000 });
        await new Promise<void>((resolve) => setImmediate(resolve));
        expect(planAttempts).toBe(4);
        expect(reasons).toEqual(["initial", "skillset.yaml"]);
        expect(scheduled).toBe(1);
      } else if (guidance === "authored") {
        await waitForCondition("authored edit checked", () => reasons.length === 3, { timeoutMs: 2_000 });
        expect(reasons).toEqual(["initial", "skillset.yaml", "AGENTS.md"]);
        expect(scheduled).toBe(2);
      } else {
        await waitForCondition("generated guidance classified", () => planReads >= 3, { timeoutMs: 2_000 });
        expect(reasons).toEqual(["initial", "skillset.yaml"]);
        expect(scheduled).toBe(1);
      }
      if (checkFails) {
        await waitForCondition("failed authored check finished", () => planReads >= 4, { timeoutMs: 2_000 });
        expect(failedChecks).toEqual(["AGENTS.md"]);
        expect(reasons).toHaveLength(3);
        await Bun.write(config, "workspace:\n  nativeAgents: true\ncompile:\n  targets: [claude]\n");
        failuresRemaining = 1;
        failNextCheck = "skillset.yaml";
        trigger?.("change", "skillset.yaml");
        await waitForCondition("retained authored edit checked", () => reasons.length === 5, { timeoutMs: 2_000 });
        expect(reasons.slice(3)).toEqual(["skillset.yaml", "AGENTS.md"]);
        expect(failedChecks).toEqual(["AGENTS.md", "skillset.yaml"]);
      }
    } finally {
      resumeRefresh?.();
      stop?.();
      await watching;
    }
  }
);

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
  const root = await createTestFixtureRoot("skillset-dev-watch-preview-");
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

test("SET-451: dev preview reports blocked output collisions in text and JSONL", async () => {
  const root = await createTestFixtureRoot("skillset-dev-watch-blocked-preview-");
  await Bun.write(
    join(root, "skillset.yaml"),
    "skillset:\n  name: blocked-preview\ncompile:\n  targets: [claude]\n"
  );
  await mkdir(join(root, ".skillset/rules"), { recursive: true });
  await Bun.write(
    join(root, ".skillset/RULES.md"),
    "# Generated project instructions\n"
  );
  await Bun.write(join(root, ".claude/CLAUDE.md"), "# Unmanaged project instructions\n");

  const report = await runDevWatchPreview(root, {}, "test");
  const rendered = renderDevWatchPreview(report);
  let output = "";
  const stream = createDevWatchJsonlStream({
    write: (chunk) => {
      output += String(chunk);
      return true;
    },
  });
  stream.operation(report);
  stream.completed("test");
  const event = parseCliEventStream(output).find(
    (entry) => entry.event === "operation"
  );

  expect(report.ok).toBe(false);
  expect(report.error).toContain("unmanaged-output-collision");
  expect(report.diagnostics).toContainEqual(
    expect.objectContaining({ code: "unmanaged-output-collision" })
  );
  expect(rendered).toContain("skillset: dev preview failed (test)");
  expect(rendered).toContain("unmanaged-output-collision");
  expect(rendered).not.toContain("run skillset build --yes");
  expect(event).toMatchObject({
    event: "operation",
    data: {
      error: expect.stringContaining("unmanaged-output-collision"),
      ok: false,
    },
  });
});

test("SET-212: dev write writes generated output with build safeguards", async () => {
  const root = await createTestFixtureRoot("skillset-dev-watch-apply-");
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

test("SET-212: dev write blocks unmanaged collisions without backup writes", async () => {
  const root = await createTestFixtureRoot("skillset-dev-watch-apply-backup-");
  await expect(runSkillsetCli("init", "--root", root, "--yes")).resolves.toMatchObject({ exitCode: 0 });
  await expect(runSkillsetCli("new", "skill", "Review Notes", "--root", root, "--yes")).resolves.toMatchObject({
    exitCode: 0,
  });
  await mkdir(join(root, ".claude/skills/review-notes"), { recursive: true });
  await Bun.write(join(root, ".claude/skills/review-notes/SKILL.md"), "hand-authored collision\n");

  const report = await runDevWatchApply(root, {}, "test");
  const rendered = renderDevWatchPreview(report);

  expect(report.ok).toBe(false);
  expect(report.writes?.paths).toEqual([]);
  expect(rendered).not.toContain("backup:");
  expect(await Bun.file(join(root, ".claude/skills/review-notes/SKILL.md")).text()).toBe("hand-authored collision\n");
  expect(await Bun.file(join(root, ".skillset/snapshots")).exists()).toBe(false);
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
  expect(writeFlag.exitCode).toBe(2);
  expect(writeFlag.stderr).toContain("write mode with --write");

  const applyWrongCommand = await runSkillsetCli("build", "--apply");
  expect(applyWrongCommand.exitCode).toBe(2);
  expect(applyWrongCommand.stderr).toContain("unknown option --apply");

  const wrongCommand = await runSkillsetCli("build", "--watch");
  expect(wrongCommand.exitCode).toBe(2);
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
  const root = await createTestFixtureRoot("skillset-dev-jsonl-setup-");
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
  expect(exitCode).toBe(1);
});

test("SET-289: initial JSONL operation failures stay in the active sequence", async () => {
  const root = await createTestFixtureRoot("skillset-dev-jsonl-initial-failure-");
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
  const root = await createTestFixtureRoot("skillset-dev-jsonl-operation-");
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
  const root = await createTestFixtureRoot("skillset-dev-jsonl-initial-signal-");
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
  const root = await createTestFixtureRoot("skillset-dev-jsonl-stalled-initial-signal-");
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
  const root = await createTestFixtureRoot("skillset-dev-jsonl-stalled-roots-signal-");
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

test("SET-289: write signals wait for the initial operation before completing", async () => {
  const root = await createTestFixtureRoot("skillset-dev-jsonl-apply-signal-");
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

  const watching = runDevWatch(root, {}, { write: (chunk) => { output += String(chunk); return true; } } as NodeJS.WritableStream, "write", "jsonl", {
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
    mode: "write",
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
  const root = await createTestFixtureRoot("skillset-dev-jsonl-queued-signal-");
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
  const root = await createTestFixtureRoot("skillset-dev-jsonl-");
  await expect(runSkillsetCli("init", "--root", root, "--yes")).resolves.toMatchObject({ exitCode: 0 });
  const proc = Bun.spawn({
    cmd: ["bun", join(import.meta.dir, "..", "cli.ts"), "dev", "--jsonl", "--root", root],
    stderr: "pipe",
    stdout: "pipe",
  });
  const stdout = { text: "" };
  const stdoutDone = accumulateStream(proc.stdout, stdout);
  try {
    await waitForCondition(
      "dev watch started JSONL event",
      () => jsonlHasEvent(stdout.text, "started")
    );
    await waitForCondition(
      "dev watch initial operation JSONL event",
      () => jsonlHasEvent(stdout.text, "operation")
    );
    proc.kill("SIGTERM");
    const [stderr, exitCode] = await Promise.all([
      new Response(proc.stderr).text(),
      proc.exited,
      stdoutDone,
    ]);
    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
    const events = parseCliEventStream(stdout.text);
    expect(events.map((event) => event.event)).toEqual(["started", "operation", "completed"]);
    expect(stdout.text).not.toContain("skillset: dev");
  } finally {
    await reapOwnedProcess(proc);
  }
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

function jsonlHasEvent(text: string, event: string): boolean {
  return text.split("\n").some((line) => {
    if (line.length === 0) return false;
    try {
      const record: unknown = JSON.parse(line);
      return typeof record === "object" && record !== null && "event" in record && record.event === event;
    } catch {
      return false;
    }
  });
}

async function accumulateStream(
  stream: ReadableStream<Uint8Array>,
  sink: { text: string }
): Promise<void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  while (true) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- Stream chunks are observed incrementally until the process closes.
    const next = await reader.read();
    if (next.done) {
      sink.text += decoder.decode();
      return;
    }
    sink.text += decoder.decode(next.value, { stream: true });
  }
}
