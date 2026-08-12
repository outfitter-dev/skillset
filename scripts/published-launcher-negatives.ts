import { chmod, readFile, rename, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { getNativeDistribution } from "../apps/skillset/src/native-distribution";

interface CommandResult {
  readonly exitCode: number;
  readonly stderr: string;
  readonly stdout: string;
}

async function runLauncher(executable: string): Promise<CommandResult> {
  const command =
    process.platform === "win32" && executable.toLowerCase().endsWith(".cmd")
      ? [
          process.env.ComSpec ?? "cmd.exe",
          "/d",
          "/s",
          "/c",
          executable,
          "--version",
        ]
      : [executable, "--version"];
  const child = Bun.spawn(command, {
    env: process.env,
    stderr: "pipe",
    stdout: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { exitCode, stderr, stdout };
}

function assertDiagnostic(
  result: CommandResult,
  expected: RegExp,
  label: string
): void {
  if (
    result.exitCode !== 1 ||
    result.stdout !== "" ||
    !expected.test(result.stderr)
  ) {
    throw new Error(
      `${label} did not produce the expected finite diagnostic: exit=${result.exitCode} stdout=${JSON.stringify(result.stdout)} stderr=${JSON.stringify(result.stderr)}`
    );
  }
}

export async function provePublishedLauncherNegatives(options: {
  readonly executable: string;
  readonly globalRoot: string;
  readonly suffix: string;
}): Promise<void> {
  const executable = resolve(options.executable);
  const distribution = getNativeDistribution(options.suffix);
  const packageDirectory = join(
    resolve(options.globalRoot),
    "skillset",
    "node_modules",
    ...distribution.npmPackage.split("/")
  );
  const heldPackage = `${packageDirectory}.set424-missing`;
  await rename(packageDirectory, heldPackage);
  try {
    assertDiagnostic(
      await runLauncher(executable),
      /native package .* is missing.*Reinstall with optional dependencies/isu,
      "omitted native package"
    );
  } finally {
    await rename(heldPackage, packageDirectory);
  }

  const manifestPath = join(packageDirectory, "package.json");
  const originalManifest = await readFile(manifestPath);
  const manifest = JSON.parse(originalManifest.toString()) as Record<
    string,
    unknown
  >;
  manifest.version = "0.0.0-set424-mismatch";
  await writeFile(manifestPath, `${JSON.stringify(manifest)}\n`);
  try {
    assertDiagnostic(
      await runLauncher(executable),
      /Package version mismatch:.*Reinstall/isu,
      "native package version mismatch"
    );
  } finally {
    await writeFile(manifestPath, originalManifest);
  }

  const nativeExecutable = join(
    packageDirectory,
    "bin",
    distribution.executable
  );
  const originalExecutable = await readFile(nativeExecutable);
  const originalMode = (await stat(nativeExecutable)).mode;
  await writeFile(nativeExecutable, new Uint8Array());
  try {
    assertDiagnostic(
      await runLauncher(executable),
      /native executable .* is missing or corrupt.*Reinstall/isu,
      "corrupt native executable"
    );
  } finally {
    await writeFile(nativeExecutable, originalExecutable);
    if (process.platform !== "win32") {
      await chmod(nativeExecutable, originalMode);
    }
  }
}

function readValue(args: readonly string[], flag: string): string {
  const index = args.indexOf(flag);
  const value = index === -1 ? undefined : args[index + 1];
  if (!value || value.startsWith("--"))
    throw new Error(`${flag} requires a value`);
  return value;
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  await provePublishedLauncherNegatives({
    executable: readValue(args, "--executable"),
    globalRoot: readValue(args, "--global-root"),
    suffix: readValue(args, "--suffix"),
  }).then(
    () => console.error("skillset: published launcher negative checks passed"),
    (error: unknown) => {
      console.error(
        `skillset: ${error instanceof Error ? error.message : String(error)}`
      );
      process.exit(1);
    }
  );
}
