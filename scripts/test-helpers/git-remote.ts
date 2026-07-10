import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
  options: { readonly repository?: string; readonly rootPath?: string } = {}
): Promise<TestGitRemote> {
  const rootPath = options.rootPath ?? await mkdtemp(join(tmpdir(), "skillset-test-git-remote-"));
  const remotePath = join(rootPath, "origin.git");
  const repository = options.repository ?? "https://git.example/acme/plugin.git";
  await runTestGit(workPath, "init", "--initial-branch=main");
  await runTestGit(workPath, "config", "user.email", "skillset@example.test");
  await runTestGit(workPath, "config", "user.name", "Skillset Tests");
  await runTestGit(workPath, "add", "--all");
  await runTestGit(workPath, "commit", "-m", "fixture");
  const sha = await runTestGit(workPath, "rev-parse", "HEAD");
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

export async function runTestGit(cwd: string, ...args: readonly string[]): Promise<string> {
  const proc = Bun.spawn({
    cmd: ["git", "-C", cwd, ...args],
    env: process.env,
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
