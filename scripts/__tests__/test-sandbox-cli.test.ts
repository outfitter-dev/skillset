import { expect, test } from "bun:test";
import { stat } from "node:fs/promises";
import { join } from "node:path";

import { validateTestSandbox } from "../../apps/skillset/src/verification-sandbox";
import { createTestFixtureRoot } from "../test-helpers/fixture-root";
import { skillsetCliCommand } from "../test-helpers/skillset-cli";
import { sandboxCliPath } from "../test-sandbox-cli";

const runner = join(import.meta.dir, "..", "test-sandbox.ts");
const helper = join(import.meta.dir, "..", "test-helpers", "skillset-cli.ts");
const sourceCli = join(import.meta.dir, "..", "..", "apps", "skillset", "src", "cli.ts");

// Prints what a fresh runner hands its tests: the sandbox, the command, and
// whether the binary was written after that sandbox's descriptor.
const probe = `
const { skillsetCliCommand } = await import(${JSON.stringify(helper)});
const fs = await import("node:fs/promises");
const descriptor = JSON.parse(await fs.readFile(process.env.SKILLSET_TEST_SANDBOX, "utf8"));
const command = await skillsetCliCommand();
const built = command.length === 1 ? (await fs.stat(command[0])).mtimeMs : null;
console.log(JSON.stringify({ built, command, createdAt: Date.parse(descriptor.createdAt), sandbox: descriptor.sandboxPath }));
`;

interface ProbeResult {
  readonly built: number | null;
  readonly command: readonly string[];
  readonly createdAt: number;
  readonly sandbox: string;
}

test("SET-629: behavior tests spawn the CLI compiled into this run's sandbox", async () => {
  const sandbox = await validateTestSandbox();
  const command = await skillsetCliCommand();
  if (process.env.SKILLSET_TEST_CLI === "source") {
    expect(command).toEqual(["bun", sourceCli]);
    return;
  }
  expect(command).toEqual([sandboxCliPath(sandbox.descriptor.sandboxPath)]);
});

test("SET-629: every fresh run compiles its own binary from the tree under test", async () => {
  const first = await probeFreshRun();
  const second = await probeFreshRun();

  for (const run of [first, second]) {
    expect(run.command).toEqual([sandboxCliPath(run.sandbox)]);
    expect(run.built).not.toBeNull();
    // Written after the sandbox was created: nothing earlier can be reused.
    expect(run.built ?? 0).toBeGreaterThanOrEqual(run.createdAt - 1_000);
  }
  expect(second.sandbox).not.toBe(first.sandbox);
  // Teardown removed the first run's sandbox, binary included.
  expect(await stat(first.sandbox).catch(() => undefined)).toBeUndefined();
});

test("SET-629: SKILLSET_TEST_CLI=source keeps spawns on the source entrypoint", async () => {
  const run = await probeFreshRun({ SKILLSET_TEST_CLI: "source" });
  expect(run.command).toEqual(["bun", sourceCli]);
  expect(run.built).toBeNull();
});

test("SET-629: an unknown SKILLSET_TEST_CLI value fails the run", async () => {
  const result = await spawnRunner(["bun", "-e", "console.log('unexpected')"], {
    SKILLSET_TEST_CLI: "compiled",
  });
  expect(result.exitCode).toBe(1);
  expect(result.stdout).not.toContain("unexpected");
  expect(result.stderr).toContain('SKILLSET_TEST_CLI must be unset or "source"');
});

test("SET-629: the compiled CLI matches the source entrypoint byte for byte", async () => {
  const command = await skillsetCliCommand();
  if (command.length !== 1) return;
  const missing = join(await createTestFixtureRoot("skillset-cli-diff-"), "missing");
  for (const args of [
    ["--version"],
    ["--help"],
    ["check", "--help"],
    ["check", "--root", missing],
    ["check", "--root", missing, "--json"],
    ["not-a-command"],
  ]) {
    const [compiled, source] = await Promise.all([
      capture([...command, ...args]),
      capture(["bun", sourceCli, ...args]),
    ]);
    expect(compiled, args.join(" ")).toEqual(source);
  }
});

async function probeFreshRun(env: Record<string, string> = {}): Promise<ProbeResult> {
  const result = await spawnRunner(["bun", "-e", probe], env);
  expect(result.exitCode, result.stderr).toBe(0);
  return JSON.parse(result.stdout.trim()) as ProbeResult;
}

function spawnRunner(command: readonly string[], env: Record<string, string>) {
  return capture(["bun", runner, "--", ...command], {
    ...process.env,
    SKILLSET_TEST_CLI: undefined,
    SKILLSET_TEST_SANDBOX: "",
    ...env,
  });
}

async function capture(
  cmd: readonly string[],
  env: Record<string, string | undefined> = process.env
): Promise<{ readonly exitCode: number; readonly stderr: string; readonly stdout: string }> {
  const proc = Bun.spawn({ cmd: [...cmd], env, stderr: "pipe", stdout: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { exitCode, stderr, stdout };
}
