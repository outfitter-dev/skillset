import { existsSync, readFileSync } from "node:fs";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Relative source import: bootstrap runs before `bun install` links the
// @skillset/* workspace packages, so it must not resolve them by name.
import { gitSafeEnv } from "../../packages/core/src/git-env";

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

export const has = (tool: string): boolean =>
  Bun.which(tool, { PATH: bootstrapChildEnv().PATH ?? "" }) !== null;

/** Bootstrap children must not inherit a previous agent's Git overrides or Python activation. */
const bootstrapChildEnv = (
  source: NodeJS.ProcessEnv = process.env
): NodeJS.ProcessEnv => {
  const env = Object.fromEntries(
    Object.entries(source).filter(
      ([key]) =>
        !/^(?:GIT_CONFIG(?:_COUNT|_PARAMETERS|_KEY_\d+|_VALUE_\d+)?|VIRTUAL_ENV(?:_PROMPT)?)$/u.test(
          key
        )
    )
  );
  if (source.VIRTUAL_ENV !== undefined && env.PATH !== undefined) {
    const virtualBin = join(
      source.VIRTUAL_ENV,
      process.platform === "win32" ? "Scripts" : "bin"
    );
    env.PATH = env.PATH.split(delimiter)
      .filter((entry) => entry !== virtualBin)
      .join(delimiter);
  }
  return env;
};

export const run = (cmd: readonly string[], cwd: string): ExecResult => {
  const result = Bun.spawnSync({
    cmd: [...cmd],
    cwd,
    // Bootstrap runs inside agent/git hooks; repository-targeting GIT_* vars
    // must not leak into spawned commands (see @skillset/core gitSafeEnv).
    env: gitSafeEnv(bootstrapChildEnv()),
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
    env: gitSafeEnv(bootstrapChildEnv()),
    stderr: "inherit",
    stdout: "inherit",
  });
  return await proc.exited;
};

export const repoFile = (repoRoot: string, path: string): string =>
  resolve(repoRoot, path);

export const isRepoRoot = (path: string): boolean => {
  const packageJsonPath = repoFile(path, "package.json");
  const hasWorkspaceMarker =
    existsSync(repoFile(path, "skillset.yaml")) ||
    existsSync(repoFile(path, "skillset.yaml")) ||
    (existsSync(repoFile(path, "skillset.yaml")) &&
      existsSync(repoFile(path, "skillset")));
  if (
    !existsSync(packageJsonPath) ||
    !existsSync(repoFile(path, "apps/skillset/src/cli.ts")) ||
    !existsSync(repoFile(path, ".bun-version")) ||
    !hasWorkspaceMarker
  ) {
    return false;
  }

  try {
    const packageJson = JSON.parse(
      readFileSync(packageJsonPath, "utf8")
    ) as PackageJson;
    return packageJson.name === "skillset-workspace";
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
