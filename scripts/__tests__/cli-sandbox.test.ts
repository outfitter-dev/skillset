import { expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { gitSafeEnv } from "../../apps/skillset/src/git-env";
import { validateTestSandbox } from "../../apps/skillset/src/verification-sandbox";
import {
  createOwnedCliTestEnvironment,
  FIXED_SHARED_TEST_STATE_ROOT_ALLOWLIST,
  isCliTestRunnerSite,
  isSandboxDescriptorConstructionSite,
  RECORDED_CLI_TEST_RUNNER_SITES,
  RECORDED_SANDBOX_DESCRIPTOR_SITES,
  scanFixedSharedTestStateRoots,
} from "../test-helpers/cli-sandbox";

test("SET-650: owned CLI environments take HOME, TMP, XDG, provider roots, and sanitized Git from the sandbox", async () => {
  const sandbox = await validateTestSandbox();
  const owned = await createOwnedCliTestEnvironment({
    env: {
      GIT_DIR: ".git",
      GIT_WORK_TREE: process.cwd(),
      GIT_INDEX_FILE: ".git/index",
    },
  });

  expect(owned.env.HOME).toBe(process.env.HOME);
  expect(owned.env.TMPDIR.startsWith(sandbox.descriptor.sandboxPath + "/")).toBeTrue();
  expect(owned.env.TMP).toBe(owned.env.TMPDIR);
  expect(owned.env.TEMP).toBe(owned.env.TMPDIR);
  expect(owned.xdg).toEqual(sandbox.xdg);
  expect(owned.env.XDG_CONFIG_HOME).toBe(sandbox.xdg.config);
  expect(owned.env.CLAUDE_CONFIG_DIR.startsWith(sandbox.xdg.config + "/")).toBeTrue();
  expect(owned.env.CODEX_HOME.startsWith(sandbox.xdg.config + "/")).toBeTrue();
  expect(owned.env.CURSOR_CONFIG_DIR.startsWith(sandbox.xdg.config + "/")).toBeTrue();
  expect(owned.env.GIT_CONFIG_GLOBAL).toBe(sandbox.git.global);
  expect(owned.env.GIT_CONFIG_SYSTEM).toBe(sandbox.git.system);
  expect(owned.env.GIT_TERMINAL_PROMPT).toBe("0");
  expect(owned.env.GIT_DIR).toBeUndefined();
  expect(owned.env.GIT_WORK_TREE).toBeUndefined();
  expect(owned.env.GIT_INDEX_FILE).toBeUndefined();
  expect(Object.keys(owned.env)).toEqual(Object.keys(gitSafeEnv(owned.env)));
});

test("SET-650: owned CLI environments reject state roots that escape the sandbox", async () => {
  await expect(
    createOwnedCliTestEnvironment({
      env: { XDG_CONFIG_HOME: join(tmpdir(), "skillset-marketplace-cli-xdg") },
    })
  ).rejects.toThrow("XDG_CONFIG_HOME");
});

test("SET-650: isolated CLI sandboxes do not share marketplace XDG state", async () => {
  const [first, second] = await Promise.all([
    createOwnedCliTestEnvironment({ isolate: true }),
    createOwnedCliTestEnvironment({ isolate: true }),
  ]);

  expect(first.sandbox.descriptor.sandboxPath).not.toBe(
    second.sandbox.descriptor.sandboxPath
  );
  expect(first.env.XDG_CONFIG_HOME).not.toBe(second.env.XDG_CONFIG_HOME);
  expect(first.env.XDG_CONFIG_HOME.startsWith(first.sandbox.descriptor.sandboxPath + "/")).toBeTrue();
  expect(second.env.XDG_CONFIG_HOME.startsWith(second.sandbox.descriptor.sandboxPath + "/")).toBeTrue();

  const firstMarker = join(first.env.XDG_CONFIG_HOME, "skillset", "alpha.marker");
  const secondMarker = join(second.env.XDG_CONFIG_HOME, "skillset", "beta.marker");
  await mkdir(dirname(firstMarker), { recursive: true });
  await mkdir(dirname(secondMarker), { recursive: true });
  await writeFile(firstMarker, "alpha\n");
  await writeFile(secondMarker, "beta\n");

  await expect(Bun.file(join(second.env.XDG_CONFIG_HOME, "skillset", "alpha.marker")).exists()).resolves.toBe(false);
  await expect(Bun.file(join(first.env.XDG_CONFIG_HOME, "skillset", "beta.marker")).exists()).resolves.toBe(false);
});

test("SET-650: the shared-root scan rejects a new fixed test-state path", () => {
  const leaked = scanFixedSharedTestStateRoots(
    "apps/skillset/src/__tests__/example.test.ts",
    [
      'const xdg = join(tmpdir(), "skillset-marketplace-cli-xdg");',
      'const env = { XDG_CONFIG_HOME: "/tmp/skillset-shared-xdg" };',
    ].join("\n")
  );
  expect(leaked.map((finding) => finding.kind)).toEqual([
    "join-tmpdir",
    "literal-xdg",
  ]);

  expect(
    scanFixedSharedTestStateRoots(
      "apps/skillset/src/__tests__/example.test.ts",
      'const root = await mkdtemp(join(tmpdir(), "skillset-marketplace-cli-"));'
    )
  ).toEqual([]);
  expect(
    scanFixedSharedTestStateRoots(
      FIXED_SHARED_TEST_STATE_ROOT_ALLOWLIST[0]!.file,
      '    XDG_CONFIG_HOME: "/tmp/skillset-test-owned/xdg/config",'
    )
  ).toEqual([]);
});

test("SET-650: tracked tests do not introduce a new fixed shared test-state root", async () => {
  const findings = [];
  for (const file of await listTrackedTestFiles()) {
    findings.push(
      ...scanFixedSharedTestStateRoots(file, await Bun.file(file).text())
    );
  }
  expect(findings).toEqual([]);
});

test("SET-650: remaining CLI runner and descriptor sites stay recorded for SET-629 and SET-625", async () => {
  const runners: string[] = [];
  const descriptors: string[] = [];
  for (const file of await listTrackedTestFiles()) {
    const content = await Bun.file(file).text();
    if (isCliTestRunnerSite(content)) runners.push(file);
    if (isSandboxDescriptorConstructionSite(file, content)) descriptors.push(file);
  }

  expect(runners).toEqual([...RECORDED_CLI_TEST_RUNNER_SITES]);
  expect(descriptors).toEqual([...RECORDED_SANDBOX_DESCRIPTOR_SITES]);
});

test("SET-650: runner detection ignores inventory and fixture mentions of cli.ts", () => {
  expect(
    isCliTestRunnerSite(
      'const files = ["create-cli.ts", "distribution-cli.ts"];'
    )
  ).toBe(false);
  expect(
    isCliTestRunnerSite('writeFileSync(join(root, "apps/skillset/src/cli.ts"), "");')
  ).toBe(false);
  expect(
    isCliTestRunnerSite(
      'const proc = Bun.spawn({ cmd: ["bun", join(import.meta.dir, "..", "cli.ts"), ...args] });'
    )
  ).toBe(true);
});

async function listTrackedTestFiles(): Promise<string[]> {
  const proc = Bun.spawn({
    cmd: [
      "git",
      "ls-files",
      "apps/**/*.test.ts",
      "scripts/**/*.test.ts",
      "scripts/fixtures/**/*.test.ts",
    ],
    stderr: "pipe",
    stdout: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (exitCode !== 0) throw new Error(stderr.trim() || "git ls-files failed");
  return stdout.split("\n").map((line) => line.trim()).filter(Boolean);
}
