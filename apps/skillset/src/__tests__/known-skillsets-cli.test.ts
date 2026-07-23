import { mkdir, mkdtemp, readdir, readFile, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, test } from "bun:test";

import {
  createTestGitFixtureRoot,
  initializeTestGitRepository,
  runTestGit,
} from "../../../../scripts/test-helpers/git-remote";

test("SET-233: check records the workspace in the managed known-Skillsets index", async () => {
  const root = await createTestGitFixtureRoot("skillset-known-cli-");
  const xdgConfigHome = join(root, "xdg-config");
  const workspace = join(root, "workspace");
  await writeWorkspace(workspace);
  await initializeTestGitRepository(workspace, { disposableRoot: root });
  await runGit(workspace, "remote", "add", "origin", "git@github.com:Acme/docs-cli.git");
  await runSkillsetCli(
    { GIT_DIR: ".git", GIT_WORK_TREE: process.cwd(), XDG_CONFIG_HOME: xdgConfigHome },
    "build",
    "--yes",
    "--root",
    workspace
  );
  const before = await readdir(workspace);

  const checked = await runSkillsetCli(
    {
      GIT_DIR: ".git",
      GIT_WORK_TREE: process.cwd(),
      XDG_CONFIG_HOME: xdgConfigHome,
    },
    "check",
    "--root",
    workspace
  );

  expect(checked).toMatchObject({ exitCode: 0 });
  await expect(readdir(workspace)).resolves.toEqual(before);
  const index = JSON.parse(await readFile(join(xdgConfigHome, "skillset", "skillsets.json"), "utf8")) as {
    readonly skillsets: readonly {
      readonly cacheKey: string;
      readonly identities: readonly string[];
      readonly path: string;
      readonly repository?: string;
    }[];
  };
  expect(index.skillsets).toEqual([{
    cacheKey: "docs-cli",
    identities: ["github:acme/docs-cli"],
    path: await realpath(workspace),
    repository: "git@github.com:Acme/docs-cli.git",
  }]);
});

test("SET-288: JSON build records the workspace in the managed index", async () => {
  const root = await createTestGitFixtureRoot("skillset-known-json-build-");
  const xdgConfigHome = join(root, "xdg-config");
  const workspace = join(root, "workspace");
  await writeWorkspace(workspace);
  await initializeTestGitRepository(workspace, { disposableRoot: root });
  await runGit(workspace, "remote", "add", "origin", "git@github.com:Acme/docs-cli.git");

  const built = await runSkillsetCli(
    { GIT_DIR: ".git", GIT_WORK_TREE: process.cwd(), XDG_CONFIG_HOME: xdgConfigHome },
    "build",
    "--yes",
    "--json",
    "--root",
    workspace
  );

  expect(built.exitCode).toBe(0);
  const index = JSON.parse(await readFile(join(xdgConfigHome, "skillset", "skillsets.json"), "utf8")) as {
    readonly skillsets: readonly { readonly path: string }[];
  };
  expect(index.skillsets.map((entry) => entry.path)).toEqual([await realpath(workspace)]);
});

test("SET-288: JSON build preview records the workspace in the managed index", async () => {
  const root = await createTestGitFixtureRoot("skillset-known-json-preview-");
  const xdgConfigHome = join(root, "xdg-config");
  const workspace = join(root, "workspace");
  await writeWorkspace(workspace);
  await initializeTestGitRepository(workspace, { disposableRoot: root });
  await runGit(workspace, "remote", "add", "origin", "git@github.com:Acme/docs-cli.git");

  const preview = await runSkillsetCli(
    { GIT_DIR: ".git", GIT_WORK_TREE: process.cwd(), XDG_CONFIG_HOME: xdgConfigHome },
    "build",
    "--json",
    "--root",
    workspace
  );

  expect(preview.exitCode).toBe(0);
  const index = JSON.parse(await readFile(join(xdgConfigHome, "skillset", "skillsets.json"), "utf8")) as {
    readonly skillsets: readonly { readonly path: string }[];
  };
  expect(index.skillsets.map((entry) => entry.path)).toEqual([await realpath(workspace)]);
});

test("SET-384: a successful command preserves and recovers a malformed managed index", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillset-known-recovery-cli-"));
  const xdgConfigHome = join(root, "xdg-config");
  const skillsetConfig = join(xdgConfigHome, "skillset");
  const workspace = join(root, "workspace");
  const malformed = Buffer.from('{"schemaVersion":1,"skillsets":[\0\0', "utf8");
  await writeWorkspace(workspace);
  await mkdir(skillsetConfig, { recursive: true });
  await writeFile(join(skillsetConfig, "skillsets.json"), malformed);

  const checked = await runSkillsetCli(
    { XDG_CONFIG_HOME: xdgConfigHome },
    "build",
    "--yes",
    "--root",
    workspace
  );

  expect(checked.exitCode, checked.stderr).toBe(0);
  const files = await readdir(skillsetConfig);
  const backup = files.find((file) => file.startsWith("skillsets.corrupt-") && file.endsWith(".json"));
  expect(backup).toBeDefined();
  expect(await readFile(join(skillsetConfig, backup!))).toEqual(malformed);
  expect(JSON.parse(await readFile(join(skillsetConfig, "skillsets.json"), "utf8"))).toMatchObject({
    schemaVersion: 1,
    skillsets: [{ path: await realpath(workspace) }],
  });
});

test("SET-388: direct test-mode checks refuse user-state mutation without a valid marker", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillset-known-hermetic-cli-"));
  const xdgConfigHome = join(root, "xdg-config");
  const indexPath = join(xdgConfigHome, "skillset", "skillsets.json");
  const workspace = join(root, "workspace");
  const decoy = Buffer.from('{"schemaVersion":1,"skillsets":[]}\n');
  await writeWorkspace(workspace);
  await mkdir(join(xdgConfigHome, "skillset"), { recursive: true });
  await writeFile(indexPath, decoy);

  const checked = await runSkillsetCli(
    {
      NODE_ENV: "test",
      SKILLSET_TEST_SANDBOX: "",
      XDG_CONFIG_HOME: xdgConfigHome,
    },
    "build",
    "--yes",
    "--root",
    workspace
  );

  expect(checked.exitCode).toBe(1);
  expect(`${checked.stdout}${checked.stderr}`).toContain("NODE_ENV=test requires");
  expect(`${checked.stdout}${checked.stderr}`).toContain("bun run test:sandbox");
  expect(await readFile(indexPath)).toEqual(decoy);
  expect(await readdir(join(xdgConfigHome, "skillset"))).toEqual([
    "skillsets.json",
  ]);
});

test("SET-388: a valid sandbox marker registers only in isolated XDG state", async () => {
  const sandbox = await mkdtemp(join(tmpdir(), "skillset-test-cli-registration-"));
  const xdg = {
    cache: join(sandbox, "xdg", "cache"),
    config: join(sandbox, "xdg", "config"),
    data: join(sandbox, "xdg", "data"),
    state: join(sandbox, "xdg", "state"),
  };
  await Promise.all(Object.values(xdg).map((path) => mkdir(path, { recursive: true })));
  const git = {
    global: join(sandbox, "git", "global-config"),
    system: join(sandbox, "git", "system-config"),
  };
  await mkdir(join(sandbox, "git"), { recursive: true });
  await Promise.all(Object.values(git).map((path) => writeFile(path, "")));
  const marker = join(sandbox, "descriptor.json");
  await writeFile(marker, JSON.stringify({
    createdAt: new Date().toISOString(),
    invocationId: crypto.randomUUID(),
    repoRoot: await realpath(process.cwd()),
    sandboxPath: await realpath(sandbox),
    schemaVersion: 1,
  }));
  const workspace = join(sandbox, "workspace");
  await writeWorkspace(workspace);

  const checked = await runSkillsetCli(
    {
      NODE_ENV: "test",
      GIT_CONFIG_GLOBAL: git.global,
      GIT_CONFIG_SYSTEM: git.system,
      GIT_TERMINAL_PROMPT: "0",
      SKILLSET_TEST_SANDBOX: marker,
      XDG_CACHE_HOME: xdg.cache,
      XDG_CONFIG_HOME: xdg.config,
      XDG_DATA_HOME: xdg.data,
      XDG_STATE_HOME: xdg.state,
    },
    "build",
    "--yes",
    "--root",
    workspace
  );

  expect(checked.exitCode, `${checked.stdout}${checked.stderr}`).toBe(0);
  const index = JSON.parse(
    await readFile(join(xdg.config, "skillset", "skillsets.json"), "utf8")
  ) as { readonly skillsets: readonly { readonly path: string }[] };
  expect(index.skillsets.map((entry) => entry.path)).toEqual([
    await realpath(workspace),
  ]);
});

test("SET-388: malformed sandbox markers fail before the registration warning boundary", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillset-known-marker-cli-"));
  const marker = join(root, "descriptor.json");
  const workspace = join(root, "workspace");
  await writeWorkspace(workspace);
  await writeFile(marker, "{");

  const checked = await runSkillsetCli(
    {
      NODE_ENV: "test",
      SKILLSET_TEST_SANDBOX: marker,
    },
    "build",
    "--yes",
    "--root",
    workspace
  );

  expect(checked.exitCode).toBe(1);
  expect(`${checked.stdout}${checked.stderr}`).toContain(
    "invalid SKILLSET_TEST_SANDBOX descriptor JSON"
  );
  expect(`${checked.stdout}${checked.stderr}`).not.toContain(
    "warning: could not update known Skillsets index"
  );
});

async function writeWorkspace(root: string): Promise<void> {
  await mkdir(join(root, ".skillset/skills/demo"), { recursive: true });
  await writeFile(join(root, "skillset.yaml"), `
skillset:
  name: docs-cli
workspace:
  cacheKey: docs-cli
`);
  await writeFile(join(root, ".skillset/skills/demo/SKILL.md"), `
---
name: demo
description: Demo skill.
---

Use this demo skill.
`);
}

async function runSkillsetCli(
  env: Record<string, string>,
  ...args: readonly string[]
): Promise<{
  readonly exitCode: number;
  readonly stderr: string;
  readonly stdout: string;
}> {
  const proc = Bun.spawn({
    cmd: ["bun", join(import.meta.dir, "..", "cli.ts"), ...args],
    env: {
      ...process.env,
      NODE_ENV: "development",
      SKILLSET_TEST_SANDBOX: "",
      ...env,
    },
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

async function runGit(root: string, ...args: readonly string[]): Promise<void> {
  await runTestGit(root, ...args);
}
