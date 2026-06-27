import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, test } from "bun:test";

import {
  createDevWatchDebouncer,
  createDevWatchPlan,
  renderDevWatchPreview,
  runDevWatchPreview,
  shouldRunDevPreviewForPath,
  type DevWatchScheduler,
} from "../dev-watch";

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

test("SET-210: dev command validation keeps watch preview-only", async () => {
  const missingWatch = await runSkillsetCli("dev");
  expect(missingWatch.exitCode).toBe(1);
  expect(missingWatch.stderr).toContain("dev currently requires --watch");

  const writeFlag = await runSkillsetCli("dev", "--watch", "--yes");
  expect(writeFlag.exitCode).toBe(1);
  expect(writeFlag.stderr).toContain("dev --watch is preview-only");

  const wrongCommand = await runSkillsetCli("build", "--watch");
  expect(wrongCommand.exitCode).toBe(1);
  expect(wrongCommand.stderr).toContain("--watch is only supported with dev");
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
