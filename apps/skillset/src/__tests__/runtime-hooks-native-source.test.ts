import { afterEach, expect, test } from "bun:test";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { buildSkillset } from "@skillset/core";

import {
  createTestGitFixtureRoot,
  initializeTestGitRepository,
  runTestGit,
} from "../../../../scripts/test-helpers/git-remote";
import { readHookSourceGate, runHookEvent } from "../runtime-hooks";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});

async function fixture(native: boolean, tracked = true) {
  const disposableRoot = await createTestGitFixtureRoot("hook-native-source-");
  roots.push(disposableRoot);
  const root = join(disposableRoot, "repo");
  await mkdir(root);
  await writeFile(
    join(root, "skillset.yaml"),
    `skillset:\n  name: hooks-test\n${native ? "workspace:\n  nativeAgents: true\n" : ""}`
  );
  if (tracked)
    await writeFile(join(root, "AGENTS.md"), "Original guidance.\r\n");
  await initializeTestGitRepository(root, { disposableRoot });
  return root;
}

for (const edit of ["tracked", "untracked", "deleted"] as const) {
  test(`declared native ${edit} root triggers real hook dispatch without source writes`, async () => {
    const root = await fixture(true, edit !== "untracked");
    expect((await readHookSourceGate(root)).changed).toBe(false);
    if (edit === "deleted") await rm(join(root, "AGENTS.md"));
    else await writeFile(join(root, "AGENTS.md"), "Changed guidance.\r\n");
    const status = await runTestGit(root, "status", "--porcelain");
    const gate = await readHookSourceGate(root);
    expect(gate).toMatchObject({ ok: true, changed: true, exitCode: 0 });
    expect(gate.paths).toContain("AGENTS.md");
    const calls: string[] = [];
    const commandRunner = async (args: readonly string[]) => {
      calls.push(args.join(" "));
      return 0;
    };
    const post = await runHookEvent("post-tool-use", {
      rootPath: root,
      commandRunner,
      env: {},
    });
    const stop = await runHookEvent("stop", {
      rootPath: root,
      commandRunner,
      env: {},
    });
    expect(post.sourceChanged).toBe(true);
    expect(stop.exitCode).toBe(0);
    expect(calls).toEqual([
      "change status --root .",
      "change check --root .",
      "check --root .",
    ]);
    expect(await runTestGit(root, "status", "--porcelain")).toBe(status);
    if (edit !== "deleted")
      expect(await readFile(join(root, "AGENTS.md"), "utf8")).toBe(
        "Changed guidance.\r\n"
      );
  });
}

test("undeclared root and unrelated edits remain outside the source gate", async () => {
  const root = await fixture(false);
  await writeFile(
    join(root, "AGENTS.md"),
    "Generated or otherwise undeclared guidance.\n"
  );
  await writeFile(join(root, "README.md"), "Unrelated.\n");
  const gate = await readHookSourceGate(root);
  expect(gate).toMatchObject({ ok: true, changed: false });
  expect(gate.paths).not.toContain("AGENTS.md");
});

for (const config of ["workspace: [", "workspace:\n  nativeAgents: false\n"]) {
  test(`invalid ownership configuration is an inspection failure: ${JSON.stringify(config)}`, async () => {
    const root = await fixture(true);
    await writeFile(join(root, "skillset.yaml"), config);
    await runTestGit(root, "add", "skillset.yaml");
    await runTestGit(root, "commit", "-m", "invalid ownership declaration");
    expect((await readHookSourceGate(root)).ok).toBe(false);
    const commandRunner = async () => {
      throw new Error("must not run with unknown ownership");
    };
    const stop = await runHookEvent("stop", {
      rootPath: root,
      commandRunner,
      env: {},
    });
    const post = await runHookEvent("post-tool-use", {
      rootPath: root,
      commandRunner,
      env: {},
    });
    expect(stop.exitCode).not.toBe(0);
    expect(stop.sourceGateOk).toBe(false);
    expect(post.exitCode).toBe(0);
    expect(post.sourceGateOk).toBe(false);
  });
}

test("unreadable config fails inspection while deletion remains a relevant source edit", async () => {
  const root = await fixture(true);
  await rm(join(root, "skillset.yaml"));
  expect(await readHookSourceGate(root)).toMatchObject({
    ok: true,
    changed: true,
  });
  await mkdir(join(root, "skillset.yaml"));
  expect((await readHookSourceGate(root)).ok).toBe(false);
});

test("managed generated root changes do not trigger native-source checks", async () => {
  const root = await fixture(false, false);
  await mkdir(join(root, ".skillset"));
  await writeFile(
    join(root, ".skillset/RULES.md"),
    "# Managed guidance\n\nFollow repository conventions.\n"
  );
  await buildSkillset(root, { targetFilter: ["codex"] });
  await runTestGit(root, "add", "--all");
  await runTestGit(root, "commit", "-m", "generated guidance");
  const lock = JSON.parse(await readFile(join(root, "skillset.lock"), "utf8"));
  expect(
    lock.items.some((item: { files: string[] }) =>
      item.files.includes("AGENTS.md")
    )
  ).toBe(true);
  await writeFile(join(root, "AGENTS.md"), "Edited managed output.\n");
  expect(await readHookSourceGate(root)).toMatchObject({
    ok: true,
    changed: false,
  });
});

test("removing the native declaration still triggers checks for the config edit", async () => {
  const root = await fixture(true);
  await writeFile(
    join(root, "skillset.yaml"),
    "skillset:\n  name: hooks-test\n"
  );
  const gate = await readHookSourceGate(root);
  expect(gate).toMatchObject({ ok: true, changed: true });
  expect(gate.paths).not.toContain("AGENTS.md");
});
