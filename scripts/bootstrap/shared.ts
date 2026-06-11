import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { gitSafeEnv } from "../../src/git-env";

export const BOOTSTRAP_DIR = dirname(fileURLToPath(import.meta.url));
export const SCRIPTS_DIR = resolve(BOOTSTRAP_DIR, "..");
export const DEFAULT_REPO_ROOT = resolve(SCRIPTS_DIR, "..");

export interface ExecResult {
  readonly exitCode: number;
  readonly stderr: string;
  readonly stdout: string;
}

interface PackageJson {
  readonly name?: string;
}

export const has = (tool: string): boolean => Bun.which(tool) !== null;

export const run = (cmd: readonly string[], cwd: string): ExecResult => {
  const result = Bun.spawnSync({
    cmd: [...cmd],
    cwd,
    // Bootstrap runs inside agent/git hooks; repository-targeting GIT_* vars
    // must not leak into spawned commands (see src/git-env.ts).
    env: gitSafeEnv(),
    stderr: "pipe",
    stdout: "pipe",
  });
  return {
    exitCode: result.exitCode,
    stderr: new TextDecoder().decode(result.stderr),
    stdout: new TextDecoder().decode(result.stdout),
  };
};

export const runInherit = async (
  cmd: readonly string[],
  cwd: string
): Promise<number> => {
  const proc = Bun.spawn([...cmd], {
    cwd,
    env: gitSafeEnv(),
    stderr: "inherit",
    stdout: "inherit",
  });
  return await proc.exited;
};

export const repoFile = (repoRoot: string, path: string): string =>
  resolve(repoRoot, path);

export const isRepoRoot = (path: string): boolean => {
  const packageJsonPath = repoFile(path, "package.json");
  if (
    !existsSync(packageJsonPath) ||
    !existsSync(repoFile(path, "src/cli.ts")) ||
    !existsSync(repoFile(path, ".bun-version")) ||
    !existsSync(repoFile(path, ".skillset/config.yaml"))
  ) {
    return false;
  }

  try {
    const packageJson = JSON.parse(
      readFileSync(packageJsonPath, "utf8")
    ) as PackageJson;
    return packageJson.name === "skillset";
  } catch {
    return false;
  }
};

export const info = (message: string): void => {
  console.error(`> ${message}`);
};

export const success = (message: string): void => {
  console.error(`ok: ${message}`);
};

export const warn = (message: string): void => {
  console.error(`warn: ${message}`);
};
