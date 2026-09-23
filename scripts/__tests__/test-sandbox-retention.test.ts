import { expect, test } from "bun:test";
import { access, mkdir, mkdtemp, realpath, symlink, utimes, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import {
  TEST_SANDBOX_SCHEMA_VERSION,
  testSandboxGit,
  testSandboxXdg,
} from "../../apps/skillset/src/verification-sandbox";
import { createTestFixtureRoot } from "../test-helpers/fixture-root";
import {
  collectStaleTestSandboxes,
  removeOwnedSandbox,
  resolveTestRepoIdentity,
  TEST_SANDBOX_LEASE,
} from "../test-sandbox-retention";

const DAY_MS = 24 * 60 * 60 * 1000;
const repoRoot = await realpath(join(import.meta.dir, "..", ".."));
const gitCommonDir = await resolveTestRepoIdentity(repoRoot);

async function makeSandbox(
  root: string,
  ageDays: number,
  options: { repoRoot?: string; gitCommonDir?: string; lease?: boolean; pid?: number } = {}
) {
  const sandboxPath = await mkdtemp(join(root, "skillset-test-"));
  const xdg = testSandboxXdg(sandboxPath);
  const git = testSandboxGit(sandboxPath);
  await Promise.all(Object.values(xdg).map((path) => mkdir(path, { recursive: true })));
  await mkdir(dirname(git.global), { recursive: true });
  await Promise.all(Object.values(git).map((path) => writeFile(path, "")));
  const invocationId = crypto.randomUUID();
  const createdAt = new Date(Date.now() - ageDays * DAY_MS).toISOString();
  await writeFile(join(sandboxPath, "descriptor.json"), `${JSON.stringify({
    createdAt,
    invocationId,
    repoRoot: options.repoRoot ?? repoRoot,
    sandboxPath,
    schemaVersion: TEST_SANDBOX_SCHEMA_VERSION,
  })}\n`);
  if (options.lease !== false) {
    await writeFile(join(sandboxPath, TEST_SANDBOX_LEASE), `${JSON.stringify({
      gitCommonDir: options.gitCommonDir ?? gitCommonDir,
      invocationId,
      pid: options.pid ?? 12345,
    })}\n`);
  }
  const time = new Date(createdAt);
  await utimes(sandboxPath, time, time);
  return { invocationId, sandboxPath };
}

test("SET-628: collect old lease-proven sandboxes across worktrees of this repository", async () => {
  const root = await createTestFixtureRoot("skillset-retention-");
  const old = await makeSandbox(root, 8);
  const young = await makeSandbox(root, 1);
  const otherRepo = await createTestFixtureRoot("skillset-other-repo-");
  const foreign = await makeSandbox(root, 8, { gitCommonDir: otherRepo });
  const retired = await makeSandbox(root, 8, { repoRoot: join(root, "retired-worktree") });
  const result = await collectStaleTestSandboxes(root, repoRoot, { isAlive: () => false });

  expect(result).toEqual({ collected: 2, retained: 1, skipped: 1, failures: [] });
  await expect(access(old.sandboxPath)).rejects.toThrow();
  await expect(access(retired.sandboxPath)).rejects.toThrow();
  await expect(access(young.sandboxPath)).resolves.toBeNull();
  await expect(access(foreign.sandboxPath)).resolves.toBeNull();
});

test("SET-628: invalid descriptors and symlink names never authorize deletion", async () => {
  const root = await createTestFixtureRoot("skillset-retention-");
  const invalid = await mkdtemp(join(root, "skillset-test-"));
  await writeFile(join(invalid, "descriptor.json"), "{}\n");
  const prefixOnly = await mkdtemp(join(root, "skillset-test-"));
  const old = new Date(Date.now() - 8 * DAY_MS);
  await utimes(invalid, old, old);
  const target = await createTestFixtureRoot("skillset-retention-decoy-");
  await writeFile(join(target, "sentinel"), "do not remove\n");
  await symlink(target, join(root, "skillset-test-link"));

  const result = await collectStaleTestSandboxes(root, repoRoot);
  expect(result).toEqual({ collected: 0, retained: 0, skipped: 3, failures: [] });
  await expect(access(join(invalid, "descriptor.json"))).resolves.toBeNull();
  await expect(access(prefixOnly)).resolves.toBeNull();
  await expect(access(join(target, "sentinel"))).resolves.toBeNull();
});

test("SET-628: an active owner protects an old sandbox even when its mtime is old", async () => {
  const root = await createTestFixtureRoot("skillset-retention-");
  const active = await makeSandbox(root, 8, { pid: process.pid });
  const old = new Date(Date.now() - 8 * DAY_MS);
  await utimes(active.sandboxPath, old, old);

  const result = await collectStaleTestSandboxes(root, repoRoot);
  expect(result).toEqual({ collected: 0, retained: 1, skipped: 0, failures: [] });
  await expect(access(join(active.sandboxPath, "descriptor.json"))).resolves.toBeNull();
});

test("SET-628: a dead owner can be collected and malformed or missing leases fail closed", async () => {
  const root = await createTestFixtureRoot("skillset-retention-");
  const dead = await makeSandbox(root, 8);
  const malformed = await makeSandbox(root, 8);
  await writeFile(join(malformed.sandboxPath, TEST_SANDBOX_LEASE), "not JSON\n");
  const legacy = await makeSandbox(root, 8, { lease: false });
  const old = new Date(Date.now() - 8 * DAY_MS);
  await Promise.all([utimes(dead.sandboxPath, old, old), utimes(malformed.sandboxPath, old, old), utimes(legacy.sandboxPath, old, old)]);

  const result = await collectStaleTestSandboxes(root, repoRoot, { isAlive: () => false });
  expect(result).toEqual({ collected: 1, retained: 0, skipped: 2, failures: [] });
  await expect(access(dead.sandboxPath)).rejects.toThrow();
  await expect(access(join(malformed.sandboxPath, "descriptor.json"))).resolves.toBeNull();
  await expect(access(join(legacy.sandboxPath, "descriptor.json"))).resolves.toBeNull();
});

test("SET-628: cleanup failure is reported without removing the candidate", async () => {
  const root = await createTestFixtureRoot("skillset-retention-");
  const candidate = await makeSandbox(root, 8);
  const result = await collectStaleTestSandboxes(root, repoRoot, {
    isAlive: () => false,
    remove: async () => { throw new Error("permission denied"); },
  });
  expect(result.collected).toBe(0);
  expect(result.failures).toHaveLength(1);
  expect(result.failures[0]).toContain("permission denied");
  await expect(access(candidate.sandboxPath)).resolves.toBeNull();
});

test("SET-628: path ownership still rejects non-sandbox directories", async () => {
  const root = await createTestFixtureRoot("skillset-retention-");
  const decoy = await createTestFixtureRoot("skillset-retention-decoy-");
  await expect(removeOwnedSandbox(decoy, root)).rejects.toThrow("refusing to clean unowned test sandbox");
  await expect(access(decoy)).resolves.toBeNull();
});
