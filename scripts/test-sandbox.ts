import { mkdir, mkdtemp, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import { gitSafeEnv } from "../apps/skillset/src/git-env";
import {
  TEST_SANDBOX_ENV,
  TEST_SANDBOX_RETAIN_ENV,
  TEST_SANDBOX_SCHEMA_VERSION,
  testSandboxGit,
  testSandboxXdg,
  validateTestSandbox,
  type TestSandboxDescriptor,
} from "../apps/skillset/src/verification-sandbox";
import { prependExecutablePath, resolvePinnedBun } from "./pinned-bun";
import {
  collectStaleTestSandboxes,
  removeOwnedSandbox,
  resolveTestRepoIdentity,
  TEST_SANDBOX_LEASE,
} from "./test-sandbox-retention";

const argv = process.argv.slice(2);
const command = argv[0] === "--" ? argv.slice(1) : argv;
if (command.length === 0) {
  console.error("usage: bun run test:sandbox -- <command> [args...]");
  process.exit(2);
}

const repoRoot = await realpath(join(import.meta.dir, ".."));
const inheritedMarker = process.env[TEST_SANDBOX_ENV]?.trim();
if (inheritedMarker) {
  try {
    await validateTestSandbox(process.env, repoRoot);
  } catch (error) {
    console.error(
      `skillset: invalid inherited test sandbox: ${message(error)}`
    );
    process.exit(1);
  }
  process.exit(await run(command, process.env));
}

const tempRoot = await realpath(tmpdir());
const sandboxPath = await mkdtemp(join(tempRoot, "skillset-test-"));
const descriptorPath = join(sandboxPath, "descriptor.json");
const git = testSandboxGit(sandboxPath);
const xdg = testSandboxXdg(sandboxPath);
const descriptor: TestSandboxDescriptor = {
  createdAt: new Date().toISOString(),
  invocationId: crypto.randomUUID(),
  repoRoot,
  sandboxPath,
  schemaVersion: TEST_SANDBOX_SCHEMA_VERSION,
};
let retain = process.env[TEST_SANDBOX_RETAIN_ENV] === "1";

try {
  await Promise.all(
    Object.values(xdg).map((path) => mkdir(path, { recursive: true }))
  );
  await mkdir(join(sandboxPath, "git"));
  await Promise.all(
    Object.values(git).map((path) => writeFile(path, "", { flag: "wx" }))
  );
  await writeFile(descriptorPath, `${JSON.stringify(descriptor, null, 2)}\n`, {
    flag: "wx",
  });
  try {
    const gitCommonDir = await resolveTestRepoIdentity(repoRoot);
    await writeFile(
      join(sandboxPath, TEST_SANDBOX_LEASE),
      `${JSON.stringify({ gitCommonDir, invocationId: descriptor.invocationId, pid: process.pid })}\n`,
      { flag: "wx" }
    );
  } catch (error) {
    // Without a valid lease the collector fails closed; test execution must
    // not depend on housekeeping being available.
    console.error(`skillset: could not record test sandbox lease: ${message(error)}`);
  }
  try {
    const collected = await collectStaleTestSandboxes(tempRoot, repoRoot);
    console.error(`skillset: collected ${collected.collected} stale test sandbox(es); ${collected.retained} retained; ${collected.skipped} unowned or invalid`);
    for (const failure of collected.failures) console.error(`skillset: could not collect stale test sandbox ${failure}`);
  } catch (error) {
    console.error(`skillset: could not scan stale test sandboxes: ${message(error)}`);
  }
  const env: Record<string, string | undefined> = {
    ...gitSafeEnv(),
    // Bun 1.4 persists transpiled files larger than 50 KB under the ambient
    // cache root. Tests use disposable source and own the complete sandbox, so
    // the documented cache-disable switch keeps both nested and decoy runs
    // write-contained.
    BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0",
    GIT_CONFIG_GLOBAL: git.global,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_SYSTEM: git.system,
    GIT_TERMINAL_PROMPT: "0",
    NODE_ENV: "test",
    [TEST_SANDBOX_ENV]: descriptorPath,
    XDG_CACHE_HOME: xdg.cache,
    XDG_CONFIG_HOME: xdg.config,
    XDG_DATA_HOME: xdg.data,
    XDG_STATE_HOME: xdg.state,
  };
  scrubGitConfigParameters(env);
  // Pin the interpreter, not the machine. Checks such as the native size
  // baseline compare recorded evidence against `Bun.version`, so a contributor
  // whose global Bun differs from `.bun-version` would otherwise fail tests
  // that pass in CI. Resolution always yields a path under our own cache, even
  // when the ambient Bun already matches the pin: that path is shared with
  // every other repository whose bootstrap installs a pinned Bun over it, and
  // this PATH entry governs the whole run. A matching ambient interpreter is
  // adopted by copy, so CI pays one copy on a cold cache rather than nothing.
  const pinnedBun = await resolvePinnedBun(repoRoot);
  env.PATH = prependExecutablePath(pinnedBun.binDir, env.PATH);
  const childCommand =
    basename(command[0] ?? "") === "bun"
      ? [pinnedBun.binPath, ...command.slice(1)]
      : [...command];

  await validateTestSandbox(env, repoRoot);
  process.exitCode = await run(childCommand, env);
} catch (error) {
  retain = true;
  console.error(`skillset: test sandbox failed: ${message(error)}`);
  process.exitCode = 1;
} finally {
  if (retain) {
    console.error(
      `skillset: retained test sandbox ${sandboxPath} (descriptor: ${descriptorPath})`
    );
  } else {
    try {
      await removeOwnedSandbox(sandboxPath, tempRoot);
    } catch (error) {
      process.exitCode ||= 1;
      console.error(
        `skillset: could not clean test sandbox ${sandboxPath}: ${message(error)}`
      );
      console.error(
        `skillset: retained test sandbox ${sandboxPath} (descriptor: ${descriptorPath})`
      );
    }
  }
}

function scrubGitConfigParameters(
  env: Record<string, string | undefined>
): void {
  for (const key of Object.keys(env)) {
    if (/^GIT_CONFIG_(?:COUNT|KEY_\d+|VALUE_\d+)$/u.test(key)) {
      delete env[key];
    }
  }
}

async function run(
  childArgv: readonly string[],
  env: Record<string, string | undefined>
): Promise<number> {
  // Git materializes ordinary tracked files through the caller's umask. Keep
  // disposable clones and generated-mode fixtures portable across contributor
  // shells while leaving the private sandbox roots created above untouched.
  if (process.platform !== "win32") {
    process.umask(0o022);
  }
  const child = Bun.spawn({
    cmd: [...childArgv],
    env,
    stderr: "inherit",
    stdin: "inherit",
    stdout: "inherit",
  });
  let signal: NodeJS.Signals | undefined;
  let forceTimer: ReturnType<typeof setTimeout> | undefined;
  const forward = (next: NodeJS.Signals) => {
    signal ??= next;
    child.kill(next);
    forceTimer ??= setTimeout(() => child.kill("SIGKILL"), 2000);
  };
  const onInterrupt = () => forward("SIGINT");
  const onTerminate = () => forward("SIGTERM");
  process.once("SIGINT", onInterrupt);
  process.once("SIGTERM", onTerminate);
  try {
    const exitCode = await child.exited;
    if (signal === "SIGINT") return 130;
    if (signal === "SIGTERM") return 143;
    return exitCode;
  } finally {
    if (forceTimer) clearTimeout(forceTimer);
    process.off("SIGINT", onInterrupt);
    process.off("SIGTERM", onTerminate);
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
