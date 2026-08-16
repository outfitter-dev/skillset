import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { expect, test } from "bun:test";

import { changeCheck } from "../change-entries";
import {
  createTestGitFixtureRoot,
  initializeTestGitRepository,
  runTestGit,
} from "../../../../scripts/test-helpers/git-remote";

const GHOST_SCOPE = "skill:not-a-real-source-unit";

test("SET-503 change check verdict is invariant across baseline resolution", async () => {
  const root = await removedUnitFixture();

  const beforeMerge = await changeCheck(root);
  expect(errorCodes(beforeMerge)).toEqual([]);
  expect(beforeMerge.ok).toBe(true);
  expect(beforeMerge.status.sourceChanges.map((change) => change.id)).toContain("skill:doomed");

  await advanceTrunkToHead(root);

  const afterMerge = await changeCheck(root);
  expect(afterMerge.status.sourceChanges.map((change) => change.id)).not.toContain("skill:doomed");
  expect(errorCodes(afterMerge)).toEqual(errorCodes(beforeMerge));
  expect(afterMerge.ok).toBe(beforeMerge.ok);
});

test("SET-503 a pending scope without machine-owned evidence stays invalid under either baseline", async () => {
  const root = await removedUnitFixture();
  await writeFile(
    join(root, ".skillset/changes/aabbccddeeff.md"),
    `Scope: ${GHOST_SCOPE}\nBump: patch\n\nThis hand-written entry names a selector that no ledger or release record has ever mentioned.\n`,
    "utf8"
  );

  const beforeMerge = await changeCheck(root);
  expect(errorCodes(beforeMerge)).toContain("change-scope-invalid");

  await advanceTrunkToHead(root);

  const afterMerge = await changeCheck(root);
  expect(errorCodes(afterMerge)).toContain("change-scope-invalid");
  expect(errorCodes(afterMerge)).toEqual(errorCodes(beforeMerge));
  expect(afterMerge.issues).toContainEqual(
    expect.objectContaining({ code: "change-scope-invalid", path: ".skillset/changes/aabbccddeeff.md" })
  );
});

test("SET-503 check --ci and check --ci --fix pass on the post-merge-main shape", async () => {
  const root = await removedUnitFixture();
  await advanceTrunkToHead(root);

  const ci = await runCli("check", "--ci", "--root", root);
  expect(ci.stdout + ci.stderr).not.toContain("change-scope-invalid");
  expect(ci.exitCode).toBe(0);

  const fixed = await runCli("check", "--ci", "--fix", "--root", root);
  expect(fixed.stdout + fixed.stderr).not.toContain("change-scope-invalid");
  expect(fixed.exitCode).toBe(0);
});

/**
 * Builds a worktree whose committed source unit `skill:doomed` was removed on the
 * current branch after the ledger recorded a covering reason for it. The tree is
 * identical before and after {@link advanceTrunkToHead}; only the merge base moves.
 */
async function removedUnitFixture(): Promise<string> {
  const disposableRoot = await createTestGitFixtureRoot("skillset-change-scope-history-");
  const root = await mkdtemp(join(disposableRoot, "repo-"));
  await mkdir(join(root, ".skillset/skills/demo"), { recursive: true });
  await mkdir(join(root, ".skillset/skills/doomed"), { recursive: true });
  await writeFile(
    join(root, "skillset.yaml"),
    "skillset:\n  name: scope-history-test\n  version: 0.1.0\nclaude: true\ncodex: false\n",
    "utf8"
  );
  await writeFile(join(root, ".skillset/skills/demo/SKILL.md"), skill("demo", "Baseline body."), "utf8");
  await writeFile(join(root, ".skillset/skills/doomed/SKILL.md"), skill("doomed", "Baseline body."), "utf8");
  await initializeTestGitRepository(root, { disposableRoot });
  await runTestGit(root, "checkout", "-b", "feature");

  await rm(join(root, ".skillset/skills/doomed"), { force: true, recursive: true });
  const added = await runCli(
    "change", "add", "--root", root, "--since", "HEAD", "--scope", "skill:doomed", "--bump", "patch",
    "--reason", "Retire the doomed skill now that its guidance moved into the demo skill for good."
  );
  expect(added.exitCode).toBe(0);
  const built = await runCli("build", "--root", root, "--yes");
  expect(built.exitCode).toBe(0);

  await runTestGit(root, "add", "--all");
  await runTestGit(root, "commit", "-m", "remove doomed skill");
  return root;
}

/** Moves `main` onto HEAD so the merge base becomes the removal commit itself. */
async function advanceTrunkToHead(root: string): Promise<void> {
  await runTestGit(root, "branch", "--force", "main", "HEAD");
}

function errorCodes(report: Awaited<ReturnType<typeof changeCheck>>): readonly string[] {
  return report.issues.filter((issue) => issue.severity === "error").map((issue) => issue.code).toSorted();
}

function skill(name: string, body: string): string {
  return `---\nname: ${name}\ndescription: Demo skill for ${name}.\nversion: 0.1.0\n---\n\n${body}\n`;
}

async function runCli(...args: readonly string[]): Promise<{ readonly exitCode: number; readonly stderr: string; readonly stdout: string }> {
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
