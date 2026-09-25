import { describe, expect, test } from "bun:test";

import { isGitEnvSourcePath, scanGitEnvSource } from "../git-env-guard";

describe("git env guard", () => {
  test("SET-632: flags a newly introduced bare git spawn", () => {
    const violations = scanGitEnvSource(
      "packages/core/src/example.ts",
      `
import { execFile } from "node:child_process";
async function outputRootIsIgnored(cwd: string) {
  await execFile("git", ["check-ignore", "-q", "--", "out/"], { cwd });
}
`
    );

    expect(violations).toEqual([
      {
        column: 9,
        file: "packages/core/src/example.ts",
        line: 4,
        owner: "outputRootIsIgnored",
        text: 'execFile("git", ["check-ignore", "-q", "--", "out/"], { cwd })',
      },
    ]);
  });

  test("SET-632: flags inherited-env test inits and accepts sanitized helpers", () => {
    expect(
      scanGitEnvSource(
        "packages/core/src/__tests__/example.test.ts",
        `execFileSync("git", ["init", "-q", root]);`
      )
    ).toHaveLength(1);

    expect(
      scanGitEnvSource(
        "packages/core/src/example.ts",
        `
import { gitSafeEnv } from "./git-env";
await execFile("git", ["status"], { cwd, env: gitSafeEnv() });
Bun.spawn({ cmd: ["git", "status"], env: gitSafeEnv() });
const env = gitSafeEnv();
Bun.spawn(["git", "rev-parse", "HEAD"], { env });
Bun.spawn({ cmd: ["git", "status"], env: testGitEnv() });
`
      )
    ).toEqual([]);
  });

  test("SET-632: resolves local argv aliases and rejects ambient env restored after sanitizing", () => {
    const violations = scanGitEnvSource(
      "packages/core/src/example.ts",
      `
import { gitSafeEnv } from "./git-env";
const command = ["git", "status"] as const;
const inherited = process.env;
Bun.spawn(command, { env: { ...gitSafeEnv(), ...inherited } });
const args = command;
Bun.spawn({ cmd: [...args], env: gitSafeEnv() });
`
    );

    expect(violations).toHaveLength(1);
    expect(violations[0]?.text).toBe(
      "Bun.spawn(command, { env: { ...gitSafeEnv(), ...inherited } })"
    );
  });

  test("SET-632: rejects copied ambient env restored after sanitizing", () => {
    const violations = scanGitEnvSource(
      "packages/core/src/example.ts",
      `
const inherited = { ...process.env };
Bun.spawn(["git", "status"], { env: { ...gitSafeEnv(), ...inherited } });
`
    );

    expect(violations).toHaveLength(1);
  });

  test("SET-632: resolves aliases from their lexical scope", () => {
    const violations = scanGitEnvSource(
      "packages/core/src/example.ts",
      `
const env = process.env;
{
  const env = gitSafeEnv();
  void env;
}
Bun.spawn(["git", "status"], { env });
`
    );

    expect(violations).toHaveLength(1);
  });

  test("SET-632: sanitizer mentions outside an environment spread do not satisfy the guard", () => {
    const violations = scanGitEnvSource(
      "packages/core/src/example.ts",
      `
Bun.spawn(["git", "status"], { env: { PATH: gitSafeEnv().PATH } });
Bun.spawn(["git", "status"], { env: { ...gitSafeEnv(), GIT_DIR: ".git" } });
`
    );
    expect(violations).toHaveLength(2);
  });

  test("SET-632: scans production and test TypeScript under apps, packages, and scripts", () => {
    expect(isGitEnvSourcePath("packages/core/src/render-project-hooks.ts")).toBe(true);
    expect(isGitEnvSourcePath("packages/core/src/__tests__/render-project-hooks.test.ts")).toBe(true);
    expect(isGitEnvSourcePath("scripts/test-sandbox.ts")).toBe(true);
    expect(isGitEnvSourcePath("docs/project/tenets.md")).toBe(false);
  });
});
