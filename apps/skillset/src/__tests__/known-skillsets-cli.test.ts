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
