import { mkdir, mkdtemp, readdir, readFile, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, test } from "bun:test";

import { gitSafeEnv } from "../git-env";

test("SET-233: check records the workspace in the managed known-Skillsets index", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillset-known-cli-"));
  const xdgConfigHome = join(root, "xdg-config");
  const workspace = join(root, "workspace");
  await writeWorkspace(workspace);
  await runGit(workspace, "init", "-q");
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
  const root = await mkdtemp(join(tmpdir(), "skillset-known-json-build-"));
  const xdgConfigHome = join(root, "xdg-config");
  const workspace = join(root, "workspace");
  await writeWorkspace(workspace);
  await runGit(workspace, "init", "-q");
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
  const root = await mkdtemp(join(tmpdir(), "skillset-known-json-preview-"));
  const xdgConfigHome = join(root, "xdg-config");
  const workspace = join(root, "workspace");
  await writeWorkspace(workspace);
  await runGit(workspace, "init", "-q");
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
    env: { ...process.env, ...env },
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
  const proc = Bun.spawn({
    cmd: ["git", ...args],
    cwd: root,
    env: gitSafeEnv(),
    stderr: "pipe",
    stdout: "pipe",
  });
  const [stderr, exitCode] = await Promise.all([
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (exitCode !== 0) throw new Error(`git ${args.join(" ")} failed: ${stderr}`);
}
