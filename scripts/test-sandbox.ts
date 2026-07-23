import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, isAbsolute, join, relative } from "node:path";

import {
  TEST_SANDBOX_ENV,
  TEST_SANDBOX_RETAIN_ENV,
  TEST_SANDBOX_SCHEMA_VERSION,
  testSandboxXdg,
  validateTestSandbox,
  type TestSandboxDescriptor,
} from "../apps/skillset/src/verification-sandbox";

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
  await writeFile(descriptorPath, `${JSON.stringify(descriptor, null, 2)}\n`, {
    flag: "wx",
  });
  const env = {
    ...process.env,
    NODE_ENV: "test",
    [TEST_SANDBOX_ENV]: descriptorPath,
    XDG_CACHE_HOME: xdg.cache,
    XDG_CONFIG_HOME: xdg.config,
    XDG_DATA_HOME: xdg.data,
    XDG_STATE_HOME: xdg.state,
  };
  await validateTestSandbox(env, repoRoot);
  process.exitCode = await run(command, env);
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

async function run(
  childArgv: readonly string[],
  env: Record<string, string | undefined>
): Promise<number> {
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

async function removeOwnedSandbox(
  sandboxPath: string,
  tempRoot: string
): Promise<void> {
  const canonical = await realpath(sandboxPath).catch(() => undefined);
  const relativePath =
    canonical === undefined ? undefined : relative(tempRoot, canonical);
  if (
    canonical !== sandboxPath ||
    !relativePath ||
    relativePath.startsWith("..") ||
    isAbsolute(relativePath) ||
    !basename(canonical).startsWith("skillset-test-")
  ) {
    throw new Error(`refusing to clean unowned test sandbox: ${sandboxPath}`);
  }
  await rm(canonical, { recursive: true });
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
