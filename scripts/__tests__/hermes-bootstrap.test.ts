import { expect, test } from "bun:test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { delimiter, join } from "node:path";

import { createTestFixtureRoot } from "../test-helpers/fixture-root";
import {
  createTestGitFixtureRoot,
  initializeTestGitRepository,
} from "../test-helpers/git-remote";

const sharedModule = join(import.meta.dir, "..", "bootstrap", "shared.ts");

const contaminatedEnv = (): Record<string, string | undefined> => ({
  ...process.env,
  GIT_DIR: "/absent/old-worktree/.git",
  GIT_CONFIG_COUNT: "1",
  GIT_CONFIG_KEY_0: "core.bare",
  GIT_CONFIG_VALUE_0: "true",
  VIRTUAL_ENV: "/absent/hermes-venv",
  VIRTUAL_ENV_PROMPT: "hermes",
  PATH: [
    join(
      "/absent/hermes-venv",
      process.platform === "win32" ? "Scripts" : "bin"
    ),
    process.env.PATH,
  ].join(delimiter),
});

for (const mode of ["count", "parameters", "config-file"]) {
  test(`bootstrap child ignores inherited ${mode} config injection and stale repository paths`, async () => {
    const root = await createTestGitFixtureRoot("skillset-hermes-git-");
    const work = join(root, "work");
    await mkdir(work);
    await writeFile(join(work, "marker.txt"), "fixture\n");
    await initializeTestGitRepository(work, { disposableRoot: root });
    const env = contaminatedEnv();
    if (mode !== "count") {
      delete env.GIT_CONFIG_COUNT;
      if (mode === "parameters") env.GIT_CONFIG_PARAMETERS = "'core.bare=true'";
      else {
        const injected = join(root, "injected.gitconfig");
        await writeFile(injected, "[core]\n  bare = true\n");
        env.GIT_CONFIG = injected;
      }
    }
    const result = Bun.spawnSync(
      [
        process.execPath,
        "--eval",
        `
    import { run } from ${JSON.stringify(sharedModule)};
    console.log(JSON.stringify(run(["git", "config", "--get", "core.bare"], ${JSON.stringify(work)})));
  `,
      ],
      { env, stdout: "pipe", stderr: "pipe" }
    );
    expect(result.exitCode).toBe(0);
    expect(new TextDecoder().decode(result.stderr)).toBe("");
    expect(JSON.parse(new TextDecoder().decode(result.stdout))).toEqual({
      exitCode: 0,
      stdout: "false\n",
      stderr: "",
    });
  });
}

test("bootstrap install children shed virtualenv state while preserving parent, HOME, sandbox and hooks", async () => {
  const root = await createTestFixtureRoot("skillset-hermes-env-");
  const output = join(root, "child.json");
  const capture = join(root, "capture.ts");
  await writeFile(
    capture,
    `await Bun.write(${JSON.stringify(output)}, JSON.stringify(process.env));`
  );
  const env: NodeJS.ProcessEnv = { ...contaminatedEnv(), CI: "parent-ci", LEFTHOOK: "1" };
  const result = Bun.spawnSync(
    [
      process.execPath,
      "--eval",
      `
    import { runInherit } from ${JSON.stringify(sharedModule)};
    const before = JSON.stringify(process.env);
    const exitCode = await runInherit([process.execPath, ${JSON.stringify(capture)}], ${JSON.stringify(root)});
    if (before !== JSON.stringify(process.env)) throw new Error("parent environment changed");
    process.exit(exitCode);
  `,
    ],
    { env, stdout: "pipe", stderr: "pipe" }
  );
  expect(result.exitCode).toBe(0);
  expect(new TextDecoder().decode(result.stderr)).toBe("");
  const child = JSON.parse(await readFile(output, "utf-8"));
  for (const key of [
    "VIRTUAL_ENV",
    "VIRTUAL_ENV_PROMPT",
    "GIT_DIR",
    "GIT_CONFIG_COUNT",
    "GIT_CONFIG_KEY_0",
    "GIT_CONFIG_VALUE_0",
  ]) {
    expect(child[key]).toBeUndefined();
  }
  expect(child.PATH).toBe(process.env.PATH);
  for (const key of [
    "HOME",
    "GIT_CONFIG_GLOBAL",
    "GIT_CONFIG_SYSTEM",
    "GIT_CONFIG_NOSYSTEM",
    "CI",
    "LEFTHOOK",
  ]) {
    expect(child[key]).toBe(env[key]);
  }
});
