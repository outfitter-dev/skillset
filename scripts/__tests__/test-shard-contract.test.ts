import { expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  createTestGitFixtureRoot,
  initializeTestGitRepository,
  runTestGit,
} from "../test-helpers/git-remote";
import { assertRepoIdentity, safeGitEnv, sha256 } from "../test-shard-contract";

test("SET-608: shard Git commands cannot inherit repository or config injection", () => {
  const env = safeGitEnv({
    HOME: "/unchanged/home",
    GIT_DIR: "/wrong/repo/.git",
    GIT_WORK_TREE: "/wrong/repo",
    GIT_INDEX_FILE: "/wrong/index",
    GIT_CONFIG_PARAMETERS: "'core.hooksPath=/wrong/hooks'",
    GIT_TEMPLATE_DIR: "/wrong/template",
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "core.hooksPath",
    GIT_CONFIG_VALUE_0: "/wrong/hooks",
  });
  expect(env.HOME).toBe("/unchanged/home");
  for (const key of [
    "GIT_DIR",
    "GIT_WORK_TREE",
    "GIT_INDEX_FILE",
    "GIT_CONFIG_PARAMETERS",
    "GIT_TEMPLATE_DIR",
    "GIT_CONFIG_COUNT",
    "GIT_CONFIG_KEY_0",
    "GIT_CONFIG_VALUE_0",
  ]) {
    expect(env[key]).toBeUndefined();
  }
});

test("SET-608: source identity is checked again after a shard changes its checkout", async () => {
  const root = await createTestGitFixtureRoot("skillset-shard-identity-");
  const repo = join(root, "repo");
  await mkdir(join(repo, "scripts", "__tests__"), { recursive: true });
  await writeFile(join(repo, "bun.lock"), "fixture lock\n");
  await writeFile(
    join(repo, "scripts", "__tests__", "fixture.test.ts"),
    "test('fixture', () => {});\n"
  );
  const head = await initializeTestGitRepository(repo, {
    disposableRoot: root,
  });
  const contract = {
    head,
    tree: await runTestGit(repo, "rev-parse", "HEAD^{tree}"),
    lockSha256: sha256("fixture lock\n"),
    manifest: ["scripts/__tests__/fixture.test.ts"],
  };
  await expect(
    assertRepoIdentity(repo, contract, "source during shards")
  ).resolves.toBeUndefined();
  await writeFile(join(repo, "bun.lock"), "changed lock\n");
  await expect(
    assertRepoIdentity(repo, contract, "source during shards")
  ).rejects.toThrow("source during shards checkout identity changed");
});
