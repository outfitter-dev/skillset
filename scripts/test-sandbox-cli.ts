/**
 * Per-run compiled CLI for the owned test sandbox (SET-629).
 *
 * Behavior tests that only need the CLI's exit code and output spawn this
 * binary instead of `bun apps/skillset/src/cli.ts`: a real command runs about
 * a quarter faster and uses roughly half the CPU, which matters when the
 * corpus spawns the CLI hundreds of times under a parallel load.
 *
 * The binary is compiled from the tree under test into the sandbox the runner
 * just created, so it can never be reused across runs or checkouts. Its path
 * derives from the validated sandbox descriptor rather than an environment
 * variable, so nothing outside the sandbox can be substituted for it.
 */
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";

/** Set to `source` to run every test against `bun apps/skillset/src/cli.ts`. */
export const TEST_CLI_ENV = "SKILLSET_TEST_CLI";

export function sandboxCliPath(
  sandboxPath: string,
  platform: NodeJS.Platform = process.platform
): string {
  return join(
    sandboxPath,
    "cli",
    platform === "win32" ? "skillset.exe" : "skillset"
  );
}

export async function compileSandboxCli(options: {
  readonly bunPath: string;
  readonly env: Record<string, string | undefined>;
  readonly repoRoot: string;
  readonly sandboxPath: string;
}): Promise<string> {
  const executablePath = sandboxCliPath(options.sandboxPath);
  const scratch = join(dirname(executablePath), "tmp");
  await mkdir(scratch, { recursive: true });
  // Bun stages the executable in its working directory before moving it into
  // place, so run from the sandbox: an interrupted compile must not leave a
  // partial binary in the repository.
  const env = { ...options.env, TEMP: scratch, TMP: scratch, TMPDIR: scratch };
  await runStep(
    [
      options.bunPath,
      "build",
      join(options.repoRoot, "apps", "skillset", "src", "cli.ts"),
      "--compile",
      "--minify",
      "--no-compile-autoload-dotenv",
      "--no-compile-autoload-bunfig",
      `--outfile=${executablePath}`,
    ],
    scratch,
    env
  );
  if (process.platform === "darwin") {
    // Bun leaves an invalid embedded signature on Darwin binaries and the
    // kernel kills them until they carry one. Ad hoc signing has no identity.
    await runStep(
      ["codesign", "--force", "--sign", "-", "--timestamp=none", executablePath],
      scratch,
      env
    );
  }
  return executablePath;
}

async function runStep(
  cmd: readonly string[],
  cwd: string,
  env: Record<string, string | undefined>
): Promise<void> {
  const child = Bun.spawn({
    cmd: [...cmd],
    cwd,
    env,
    stderr: "pipe",
    stdout: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  if (exitCode !== 0) {
    throw new Error(
      `could not compile the test CLI (${cmd[0]} exited ${exitCode}):\n${stdout}${stderr}`
    );
  }
}
