import { afterEach, expect, test } from "bun:test";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { withLockProvenance } from "@skillset/core/internal/lock-provenance";
import { writeReleaseState } from "@skillset/core/internal/release-state";

import {
  createTestGitFixtureRoot,
  initializeTestGitRepository,
  runTestGit,
} from "../../../../scripts/test-helpers/git-remote";
import { changeCheck } from "../change-entries";
import { changeStatus, collectSourceInventory } from "../change-status";

const roots: string[] = [];
const skillPath = ".skillset/skills/demo/SKILL.md";
const skill = (body: string) =>
  `---\nname: demo\ndescription: Demo skill.\n---\n\n${body}\n`;
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});

async function fixture() {
  const disposableRoot = await createTestGitFixtureRoot(
    "change-default-branch-"
  );
  roots.push(disposableRoot);
  const root = join(disposableRoot, "repo");
  await mkdir(join(root, ".skillset/skills/demo"), { recursive: true });
  await writeFile(
    join(root, "skillset.yaml"),
    "skillset:\n  name: baseline-test\n"
  );
  await writeFile(join(root, skillPath), skill("Original body."));
  const base = await initializeTestGitRepository(root, { disposableRoot });
  await runTestGit(root, "branch", "-m", "master");
  await runTestGit(root, "update-ref", "refs/remotes/origin/master", base);
  await runTestGit(
    root,
    "symbolic-ref",
    "refs/remotes/origin/HEAD",
    "refs/remotes/origin/master"
  );
  await runTestGit(root, "switch", "-c", "feature");
  await writeFile(join(root, skillPath), skill("Committed feature body."));
  await runTestGit(root, "add", skillPath);
  await runTestGit(root, "commit", "-m", "feature change");
  const head = await runTestGit(root, "rev-parse", "HEAD");
  return { root, base, head };
}

async function expectBaseline(root: string, sha: string, changed: boolean) {
  const status = await changeStatus(root);
  expect(status.baseline).toEqual({
    kind: "git-ref",
    ref: sha,
    resolvedRef: sha,
  });
  expect(status.sourceChanges.map((change) => change.id)).toEqual(
    changed ? ["skill:demo"] : []
  );
}

test("remote master detects committed changes through status and change check without writes", async () => {
  const { root, base } = await fixture();
  const refs = await runTestGit(root, "show-ref");
  const bytes = await readFile(join(root, skillPath));
  await expectBaseline(root, base, true);
  const implicit = await changeStatus(root);
  const explicit = await changeStatus(root, { since: "origin/master" });
  expect(implicit.sourceChanges).toEqual(explicit.sourceChanges);
  const check = await changeCheck(root);
  expect(check.issues).toEqual(
    (await changeCheck(root, { since: "origin/master" })).issues
  );
  expect(check.issues.some((issue) => issue.code === "change-uncovered")).toBe(
    true
  );
  expect(await runTestGit(root, "show-ref")).toBe(refs);
  expect(await readFile(join(root, skillPath))).toEqual(bytes);
  expect(await runTestGit(root, "status", "--porcelain")).toBe("");
});

test("remote default uses the merge base and wins over main refs", async () => {
  const { root, base, head } = await fixture();
  await runTestGit(root, "switch", "master");
  await writeFile(join(root, "trunk.txt"), "Trunk advanced independently.\n");
  await runTestGit(root, "add", "trunk.txt");
  await runTestGit(root, "commit", "-m", "advance trunk");
  await runTestGit(root, "update-ref", "refs/remotes/origin/master", "HEAD");
  await runTestGit(root, "switch", "feature");
  await runTestGit(root, "update-ref", "refs/remotes/origin/main", head);
  await runTestGit(root, "branch", "main", head);
  await expectBaseline(root, base, true);
});

for (const remoteHead of ["absent", "dangling"] as const) {
  for (const fallback of ["origin/main", "main", "HEAD"] as const) {
    test(`${remoteHead} remote default falls back to ${fallback}`, async () => {
      const { root, base, head } = await fixture();
      if (remoteHead === "absent")
        await runTestGit(
          root,
          "symbolic-ref",
          "--delete",
          "refs/remotes/origin/HEAD"
        );
      else
        await runTestGit(
          root,
          "symbolic-ref",
          "refs/remotes/origin/HEAD",
          "refs/remotes/origin/missing"
        );
      if (fallback === "origin/main")
        await runTestGit(root, "update-ref", "refs/remotes/origin/main", base);
      if (fallback === "main") await runTestGit(root, "branch", "main", base);
      await expectBaseline(
        root,
        fallback === "HEAD" ? head : base,
        fallback !== "HEAD"
      );
    });
  }
}

test("explicit since and staged comparisons retain precedence over remote default", async () => {
  const { root, head } = await fixture();
  const explicit = await changeStatus(root, { since: "HEAD" });
  const staged = await changeStatus(root, { staged: true });
  for (const status of [explicit, staged]) {
    expect(status.baseline).toEqual({
      kind: "git-ref",
      ref: "HEAD",
      resolvedRef: head,
    });
    expect(status.sourceChanges).toEqual([]);
  }
});

test("generated inventory still precedes the Git fallback", async () => {
  const { root } = await fixture();
  const inventory = await collectSourceInventory(root);
  await writeFile(
    join(root, "skillset.lock"),
    JSON.stringify(
      withLockProvenance({
        generatedBy: "skillset@0.1.0",
        items: [],
        outputRoot: ".",
        schemaVersion: 4,
        standardProfileEvidence: {},
        selectedStandards: [],
        selectedTargets: [],
        sourceInventory: {
          hashSchema: inventory.hashSchema,
          units: inventory.units.map(({ hash, id, kind, sourcePath }) => ({
            hash,
            id,
            kind,
            sourcePath,
          })),
        },
        target: "workspace",
      })
    )
  );
  const status = await changeStatus(root);
  expect(status.baseline).toMatchObject({
    kind: "source-inventory",
    label: "skillset.lock",
  });
  expect(status.sourceChanges).toEqual([]);
});

test("release-owned scopes override Git while uncovered scopes retain its baseline", async () => {
  const { root } = await fixture();
  const inventory = await collectSourceInventory(root);
  const demo = inventory.units.find((unit) => unit.id === "skill:demo");
  if (demo === undefined) throw new Error("expected demo source unit");
  await writeReleaseState(
    root,
    { scopes: { "skill:demo": { sourceHash: demo.hash, version: "0.1.0" } } },
    { sourceDir: ".skillset" }
  );
  await writeFile(
    join(root, "skillset.yaml"),
    "skillset:\n  name: changed-baseline-test\n"
  );
  const status = await changeStatus(root);
  expect(status.baseline.kind).toBe("source-inventory");
  expect(status.sourceChanges.map((change) => change.id)).not.toContain(
    "skill:demo"
  );
  expect(status.sourceChanges.length).toBeGreaterThan(0);
});

test("partial release inventory retains committed changes in uncovered scopes", async () => {
  const { root } = await fixture();
  const inventory = await collectSourceInventory(root);
  const config = inventory.units.find((unit) => unit.kind === "root-config");
  if (config === undefined) throw new Error("expected root config source unit");
  await writeReleaseState(
    root,
    { scopes: { [config.id]: { sourceHash: config.hash, version: "0.1.0" } } },
    { sourceDir: ".skillset" }
  );
  const status = await changeStatus(root);
  expect(status.baseline.kind).toBe("source-inventory");
  expect(status.sourceChanges.map((change) => change.id)).toEqual([
    "skill:demo",
  ]);
});
