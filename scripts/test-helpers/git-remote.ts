import { lstat, mkdtemp, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";

import { gitSafeEnv } from "../../apps/skillset/src/git-env";
import { validateTestSandbox } from "../../apps/skillset/src/verification-sandbox";

export interface TestGitRemote {
  readonly env: Record<string, string>;
  readonly remotePath: string;
  readonly repository: string;
  readonly sha: string;
  readonly workPath: string;
  readonly xdg: {
    readonly env: Record<string, string>;
    readonly homeDir: string;
  };
}

export async function createTestGitRemote(
  workPath: string,
  options: {
    readonly disposableRoot: string;
    readonly repository?: string;
    readonly rootPath?: string;
  }
): Promise<TestGitRemote> {
  const sandbox = await validateTestSandbox();
  const disposableRoot = await validateDisposableRoot(
    options.disposableRoot,
    sandbox.descriptor.sandboxPath
  );
  await assertDisposableRepositoryTarget(
    workPath,
    disposableRoot,
    sandbox.descriptor.repoRoot
  );
  const rootPath =
    options.rootPath ??
    (await mkdtemp(join(disposableRoot, "skillset-test-git-remote-")));
  const remoteRoot = await validateContainedDirectory(
    rootPath,
    disposableRoot,
    "Git remote root"
  );
  if (
    (await hasGitMarker(remoteRoot)) ||
    (await readRepositoryTopology(remoteRoot)) !== undefined
  ) {
    throw new Error("Git remote root must not be an existing repository");
  }
  const remotePath = join(rootPath, "origin.git");
  const repository = options.repository ?? "https://git.example/acme/plugin.git";
  const sha = await initializeTestGitRepository(workPath, {
    disposableRoot,
  });
  await runTestGit(rootPath, "clone", "--bare", workPath, remotePath);
  const env = {
    GIT_ALLOW_PROTOCOL: "file",
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: `url.file://${remotePath}/.insteadOf`,
    GIT_CONFIG_VALUE_0: repository,
    XDG_CACHE_HOME: join(rootPath, "cache"),
    XDG_CONFIG_HOME: join(rootPath, "config"),
  };
  return {
    env,
    remotePath,
    repository,
    sha,
    workPath,
    xdg: {
      env,
      homeDir: join(rootPath, "home"),
    },
  };
}

export async function initializeTestGitRepository(
  workPath: string,
  options: { readonly disposableRoot: string }
): Promise<string> {
  const sandbox = await validateTestSandbox();
  const disposableRoot = await validateDisposableRoot(
    options.disposableRoot,
    sandbox.descriptor.sandboxPath
  );
  await assertDisposableRepositoryTarget(
    workPath,
    disposableRoot,
    sandbox.descriptor.repoRoot
  );
  await runTestGit(workPath, "init", "--initial-branch=main");
  await runTestGit(workPath, "config", "user.email", "skillset@example.test");
  await runTestGit(workPath, "config", "user.name", "Skillset Tests");
  await runTestGit(workPath, "add", "--all");
  await runTestGit(workPath, "commit", "-m", "fixture");
  return runTestGit(workPath, "rev-parse", "HEAD");
}

export async function createTestGitFixtureRoot(
  prefix = "skillset-test-git-fixture-"
): Promise<string> {
  const sandbox = await validateTestSandbox();
  return mkdtemp(
    join(sandbox.descriptor.sandboxPath, validateFixturePrefix(prefix))
  );
}

export async function runTestGit(cwd: string, ...args: readonly string[]): Promise<string> {
  const proc = Bun.spawn({
    cmd: ["git", "-C", cwd, ...args],
    env: testGitEnv(),
    stderr: "pipe",
    stdout: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (exitCode !== 0) throw new Error(`${stdout}${stderr}`.trim());
  return stdout.trim();
}

async function validateDisposableRoot(
  rootPath: string,
  sandboxPath: string
): Promise<string> {
  return validateContainedDirectory(
    rootPath,
    sandboxPath,
    "disposable Git fixture root"
  );
}

async function validateContainedDirectory(
  path: string,
  parent: string,
  label: string
): Promise<string> {
  if (!isAbsolute(path)) throw new Error(`${label} must be an absolute path`);
  const entry = await lstat(path);
  if (!entry.isDirectory() || entry.isSymbolicLink()) {
    throw new Error(`${label} must be a real directory`);
  }
  const canonical = await realpath(path);
  if (!isInside(parent, canonical)) {
    throw new Error(`${label} must be inside the owned test sandbox`);
  }
  return canonical;
}

async function assertDisposableRepositoryTarget(
  workPath: string,
  disposableRoot: string,
  repoRoot: string
): Promise<void> {
  const target = await validateContainedDirectory(
    workPath,
    disposableRoot,
    "Git fixture target"
  );
  if (target === repoRoot) {
    throw new Error("Git fixture target must not be the Skillset repository");
  }

  const topology = await readRepositoryTopology(target);
  if (topology === undefined) {
    if (await hasGitMarker(target)) {
      throw new Error("Git fixture target must not be an existing repository");
    }
    return;
  }

  const skillsetCommonDir = await readGitPath(
    repoRoot,
    "--path-format=absolute",
    "--git-common-dir"
  );
  if (topology.commonDir === skillsetCommonDir) {
    throw new Error(
      "Git fixture target must not share the Skillset repository common Git directory"
    );
  }
  if (topology.gitDir !== topology.commonDir) {
    throw new Error("Git fixture target must not be a linked worktree");
  }
  throw new Error("Git fixture target must not be an existing repository");
}

async function readRepositoryTopology(
  workPath: string
): Promise<{ readonly commonDir: string; readonly gitDir: string } | undefined> {
  const gitDir = Bun.spawnSync({
    cmd: ["git", "-C", workPath, "rev-parse", "--absolute-git-dir"],
    env: testGitEnv(),
    stderr: "ignore",
    stdout: "pipe",
  });
  if (gitDir.exitCode !== 0) return undefined;
  const commonDir = await readGitPath(
    workPath,
    "--path-format=absolute",
    "--git-common-dir"
  );
  return {
    commonDir,
    gitDir: await realpath(resolve(workPath, gitDir.stdout.toString().trim())),
  };
}

async function readGitPath(
  cwd: string,
  ...args: readonly string[]
): Promise<string> {
  const output = await runTestGit(cwd, "rev-parse", ...args);
  return realpath(resolve(cwd, output));
}

function testGitEnv(): Record<string, string> {
  const env = gitSafeEnv();
  for (const key of Object.keys(env)) {
    if (
      key === "EMAIL" ||
      key === "GIT_CONFIG_PARAMETERS" ||
      key === "GIT_TEMPLATE_DIR" ||
      /^GIT_(?:AUTHOR|COMMITTER)_(?:DATE|EMAIL|NAME)$/u.test(key) ||
      /^GIT_CONFIG_(?:COUNT|KEY_\d+|VALUE_\d+)$/u.test(key)
    ) {
      delete env[key];
    }
  }
  env.GIT_AUTHOR_EMAIL = "skillset@example.test";
  env.GIT_AUTHOR_NAME = "Skillset Tests";
  env.GIT_COMMITTER_EMAIL = "skillset@example.test";
  env.GIT_COMMITTER_NAME = "Skillset Tests";
  env.GIT_TERMINAL_PROMPT = "0";
  return env;
}

function isInside(parent: string, child: string): boolean {
  const path = relative(parent, child);
  return path.length > 0 && !path.startsWith("..") && !isAbsolute(path);
}

function validateFixturePrefix(prefix: string): string {
  if (
    prefix.length === 0 ||
    prefix === "." ||
    prefix === ".." ||
    isAbsolute(prefix) ||
    prefix.includes("/") ||
    prefix.includes("\\")
  ) {
    throw new Error("Git fixture prefix must be a non-empty safe basename");
  }
  return prefix;
}

async function hasGitMarker(path: string): Promise<boolean> {
  try {
    await lstat(join(path, ".git"));
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}
