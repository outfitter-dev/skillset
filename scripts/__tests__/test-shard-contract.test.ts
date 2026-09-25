import { expect, test } from "bun:test";
import { mkdir, realpath, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";

import { createTestFixtureRoot } from "../test-helpers/fixture-root";
import {
  createTestGitFixtureRoot,
  initializeTestGitRepository,
  runTestGit,
} from "../test-helpers/git-remote";
import {
  assertRepoIdentity,
  safeGitEnv,
  sha256,
  verifyBaselineReport,
} from "../test-shard-contract";

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

const BASELINE = {
  head: "8b1c1c147416fb7d22394696f917255aae9dbd20",
  tree: "a9844b9718a6f2a77a6315a0d728769b71e7065f",
  lockSha256: "0".repeat(64),
  bunVersion: "1.4.0",
} as const;

function measuredReport(
  repoRoot: string,
  outfile: string,
  output: { readonly path: string; readonly sha256: string }
): Uint8Array {
  const revision = {
    repoRoot,
    head: BASELINE.head,
    headTree: BASELINE.tree,
    lockfileSha256: BASELINE.lockSha256,
    dirty: false,
  };
  const toolchain = { resolvedBunVersion: BASELINE.bunVersion };
  return new TextEncoder().encode(
    JSON.stringify({
      schemaVersion: 4,
      attributable: true,
      commandSucceeded: true,
      command: [
        "bun",
        "test",
        "--reporter=junit",
        `--reporter-outfile=${outfile}`,
      ],
      revision,
      revisionAfter: revision,
      toolchainBefore: toolchain,
      toolchainAfter: toolchain,
      outputs: [output],
    })
  );
}

test("SET-667: a relative baseline JUnit path names the measured outfile", async () => {
  const root = await createTestFixtureRoot("skillset-shard-baseline-");
  const junit = join(root, "out", "baseline.xml");
  await mkdir(join(root, "out"));
  await writeFile(junit, "measured\n");
  const report = measuredReport(root, "./out/../out/baseline.xml", {
    path: junit,
    sha256: sha256("measured\n"),
  });
  await expect(
    verifyBaselineReport(report, {
      ...BASELINE,
      baselineJunit: `${relative(process.cwd(), root)}/out/../out/baseline.xml`,
      baselineBytes: new TextEncoder().encode("measured\n"),
    })
  ).resolves.toBe(await realpath(root));
});

test("SET-667: baseline JUnit rewritten after the measured run is rejected", async () => {
  const root = await createTestFixtureRoot("skillset-shard-baseline-");
  const junit = join(root, "baseline.xml");
  const report = measuredReport(root, junit, {
    path: junit,
    sha256: sha256("measured\n"),
  });
  await writeFile(junit, "overwritten\n");
  await expect(
    verifyBaselineReport(report, {
      ...BASELINE,
      baselineJunit: junit,
      baselineBytes: new TextEncoder().encode("overwritten\n"),
    })
  ).rejects.toThrow("baseline report does not prove");
});
