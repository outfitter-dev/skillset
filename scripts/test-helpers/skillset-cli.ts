import { lstat } from "node:fs/promises";
import { join } from "node:path";

import { validateTestSandbox } from "../../apps/skillset/src/verification-sandbox";
import { sandboxCliPath } from "../test-sandbox-cli";

const SOURCE_CLI = join(import.meta.dir, "..", "..", "apps", "skillset", "src", "cli.ts");

let resolved: Promise<readonly string[]> | undefined;

/**
 * The argv prefix behavior tests use to spawn the CLI: the binary the test
 * runner compiled into this run's sandbox, or the source entrypoint when the
 * run opted out with `SKILLSET_TEST_CLI=source`. Tests about the process
 * boundary or the source entrypoint itself spawn `bun cli.ts` directly.
 */
export function skillsetCliCommand(): Promise<readonly string[]> {
  resolved ??= resolveCommand();
  return resolved;
}

export async function runSkillsetCli(...args: readonly string[]): Promise<{
  readonly exitCode: number;
  readonly stderr: string;
  readonly stdout: string;
}> {
  const proc = Bun.spawn({
    cmd: [...(await skillsetCliCommand()), ...args],
    stderr: "pipe",
    stdout: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { exitCode, stderr, stdout };
}

async function resolveCommand(): Promise<readonly string[]> {
  const sandbox = await validateTestSandbox();
  const binary = sandboxCliPath(sandbox.descriptor.sandboxPath);
  const stat = await lstat(binary).catch(() => undefined);
  if (stat === undefined) return ["bun", SOURCE_CLI];
  if (!stat.isFile()) {
    throw new Error(`test CLI must be a regular file: ${binary}`);
  }
  return [binary];
}
