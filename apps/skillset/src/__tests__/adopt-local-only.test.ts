import { expect, spyOn, test } from "bun:test";
import { delimiter, join } from "node:path";
import { chmod } from "node:fs/promises";
import { createTestFixtureRoot, tempEntriesLeftBy } from "../../../../scripts/test-helpers/fixture-root";
import { adoptAcquiredSkillset, adoptSkillset, type AdoptAcquisition } from "../adopt";

const unsupported = [
  "https://example.invalid/repo.git",
  "ssh://git@example.invalid/repo.git",
  "git@example.invalid:repo.git",
  "file:///nonexistent/repo",
  "missing-local-directory",
];

test("adoption rejects remote and missing inputs before spawning or allocating a clone", async () => {
  const cwd = await createTestFixtureRoot("adopt-local-only-");
  const spawn = spyOn(Bun, "spawn").mockImplementation(() => { throw new Error("unexpected spawn"); });
  try {
    const { leftovers } = await tempEntriesLeftBy("skillset-adopt-remote-", async () => {
      for (const source of unsupported) for (const write of [false, true]) {
        await expect(adoptSkillset(source, { cwd, write, destination: "destination" })).rejects.toThrow("adoption requires an existing local directory");
      }
    });
    expect(spawn).not.toHaveBeenCalled();
    expect(leftovers).toEqual([]);
    expect(await Bun.file(join(cwd, "destination/skillset.yaml")).exists()).toBe(false);
  } finally {
    spawn.mockRestore();
  }
});

test("direct acquired adoption rejects a remote acquisition and non-directory roots", async () => {
  const root = await createTestFixtureRoot("adopt-acquired-local-only-");
  await Bun.write(join(root, "file"), "authored\n");
  const acquisitions = [
    { kind: "git", input: "https://example.invalid/repo.git", rootPath: root, repo: "https://example.invalid/repo.git", ref: "a".repeat(40) },
    { kind: "path", input: "missing", rootPath: join(root, "missing") },
    { kind: "path", input: "file", rootPath: join(root, "file") },
  ] as unknown as AdoptAcquisition[];
  const spawn = spyOn(Bun, "spawn").mockImplementation(() => { throw new Error("unexpected spawn"); });
  try {
    for (const acquired of acquisitions) {
      await expect(adoptAcquiredSkillset(acquired, { write: true })).rejects.toThrow("adoption requires an existing local directory");
    }
    expect(spawn).not.toHaveBeenCalled();
    expect(await Bun.file(join(root, "file")).text()).toBe("authored\n");
    expect(await Bun.file(join(root, "skillset.yaml")).exists()).toBe(false);
  } finally {
    spawn.mockRestore();
  }
});

test("public init adoption rejects remote inputs without cloning or creating a workspace", async () => {
  const cwd = await createTestFixtureRoot("init-local-only-");
  const gitPath = join(cwd, process.platform === "win32" ? "bin/git.cmd" : "bin/git");
  await Bun.write(gitPath, process.platform === "win32"
    ? '@echo off\r\nif "%1"=="clone" echo attempted > "%ADOPT_CLONE_MARKER%"\r\nexit /b 1\r\n'
    : '#!/bin/sh\nif [ "$1" = "clone" ]; then printf attempted > "$ADOPT_CLONE_MARKER"; fi\nexit 1\n');
  await chmod(gitPath, 0o755);
  const marker = join(cwd, "clone-attempt");
  for (const source of unsupported) {
    const proc = Bun.spawn({
      cmd: [process.execPath, join(import.meta.dir, "../cli.ts"), "init", source, "--adopt", "all", "--yes"],
      cwd,
      env: { ...process.env, ADOPT_CLONE_MARKER: marker, PATH: `${join(cwd, "bin")}${delimiter}${process.env.PATH ?? ""}` },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [code, stdout, stderr] = await Promise.all([proc.exited, new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
    expect(code).not.toBe(0);
    expect(`${stdout}${stderr}`).toMatch(/directory|ENOENT|not.*exist/u);
    expect(await Bun.file(marker).exists()).toBe(false);
    expect(await Bun.file(join(cwd, source, "skillset.yaml")).exists()).toBe(false);
  }
});
