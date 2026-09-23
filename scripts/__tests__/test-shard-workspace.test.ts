import { expect, test } from "bun:test";
import { mkdir, readFile, symlink } from "node:fs/promises";
import { dirname, join } from "node:path";

import { createTestFixtureRoot } from "../test-helpers/fixture-root";
import {
  prepareShardOutput,
  prepareShardWorkspace,
  removeOwnedRunRoot,
  writeFailedShardReceipt,
} from "../test-shard-workspace";

test("SET-608: report output cannot overlap source or follow a direct symlink", async () => {
  const root = await createTestFixtureRoot("skillset-shard-output-");
  const repo = join(root, "repo");
  await mkdir(repo);
  await expect(prepareShardOutput(repo, join(repo, "reports"))).rejects.toThrow(
    "overlaps the source checkout"
  );
  const out = await prepareShardOutput(repo, join(root, "reports"));
  expect(out).toBe(join(root, "reports"));
  await symlink(out, join(root, "linked-reports"));
  await expect(
    prepareShardOutput(repo, join(root, "linked-reports"))
  ).rejects.toThrow("symlink");
});

test("SET-608: every shard owns distinct Git, XDG, temp and dependency state", async () => {
  const root = await createTestFixtureRoot("skillset-shard-state-");
  const runRoot = join(root, "run");
  const out = join(root, "reports");
  await Promise.all([mkdir(runRoot), mkdir(out)]);
  const pinned = {
    binPath: process.execPath,
    binDir: dirname(process.execPath),
    version: Bun.version,
    source: "adopted" as const,
  };
  const first = await prepareShardWorkspace(runRoot, out, 1, pinned);
  const second = await prepareShardWorkspace(runRoot, out, 2, pinned);
  for (const key of [
    "TMPDIR",
    "XDG_CACHE_HOME",
    "XDG_CONFIG_HOME",
    "XDG_DATA_HOME",
    "XDG_STATE_HOME",
    "GIT_CONFIG_GLOBAL",
    "GIT_CONFIG_SYSTEM",
  ]) {
    expect(first.env[key]).toBeDefined();
    expect(second.env[key]).toBeDefined();
    expect(first.env[key]).not.toBe(second.env[key]);
  }
  expect(first.env.HOME).toBe(process.env.HOME);
  expect(second.env.SKILLSET_TEST_SANDBOX).toBeUndefined();
  expect(first.bunCache).not.toBe(second.bunCache);
  expect(first.repo).not.toBe(second.repo);
});

test("SET-608: canceled runs publish failure and refuse unowned cleanup", async () => {
  const root = await createTestFixtureRoot("skillset-shard-failure-");
  const out = join(root, "reports");
  await mkdir(out);
  await writeFailedShardReceipt(
    out,
    "2026-09-23T00:00:00.000Z",
    "interrupted by SIGTERM",
    root
  );
  const receipt = JSON.parse(
    await readFile(join(out, "aggregate.json"), "utf8")
  ) as { status: string; reason: string; retainedRunRoot: string };
  expect(receipt).toMatchObject({
    status: "failed",
    reason: "interrupted by SIGTERM",
    retainedRunRoot: root,
  });
  await expect(removeOwnedRunRoot(root, "not-the-owner")).rejects.toThrow();
  expect(await readFile(join(out, "aggregate.json"), "utf8")).toContain(
    "interrupted by SIGTERM"
  );
});
