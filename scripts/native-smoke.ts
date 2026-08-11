import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

import packageManifest from "../apps/skillset/package.json";
import { getNativeTarget } from "./native-targets";

interface ProcessResult {
  readonly exitCode: number;
  readonly stderr: string;
  readonly stdout: string;
}

async function run(
  executable: string,
  args: readonly string[],
  path: string
): Promise<ProcessResult> {
  const child = Bun.spawn([executable, ...args], {
    env: { ...process.env, PATH: path },
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

function assertSuccess(result: ProcessResult, label: string): void {
  if (result.exitCode !== 0) {
    throw new Error(
      `Native ${label} smoke exited ${result.exitCode}:\n${result.stdout}${result.stderr}`
    );
  }
}

export async function smokeNativeExecutable(
  executable: string,
  suffix: string
): Promise<void> {
  const target = getNativeTarget(suffix);
  const smokeRoot = await mkdtemp(join(tmpdir(), "skillset-native-smoke-"));
  const marker = join(smokeRoot, "system-bun-was-invoked");
  const unixSentinel = join(smokeRoot, "bun");
  const windowsSentinel = join(smokeRoot, "bun.cmd");
  await writeFile(
    unixSentinel,
    `#!/bin/sh\nprintf invoked > '${marker}'\nexit 86\n`
  );
  await chmod(unixSentinel, 0o755);
  await writeFile(
    windowsSentinel,
    `@echo off\r\n>"${marker}" echo invoked\r\nexit /b 86\r\n`
  );
  if (target.executable !== "skillset.exe") await chmod(executable, 0o755);

  try {
    const isolatedPath = [smokeRoot].join(delimiter);
    const version = await run(executable, ["--version"], isolatedPath);
    assertSuccess(version, "version");
    if (
      version.stdout !== `${packageManifest.version}\n` ||
      version.stderr !== ""
    ) {
      throw new Error(
        `Native version output mismatch: stdout=${JSON.stringify(version.stdout)} stderr=${JSON.stringify(version.stderr)}`
      );
    }

    const help = await run(executable, ["--help"], isolatedPath);
    assertSuccess(help, "help");
    if (
      !help.stdout.includes("Usage\n  skillset <command>") ||
      help.stderr !== ""
    ) {
      throw new Error(
        "Native help output does not contain the canonical usage header"
      );
    }

    const lookup = await run(
      executable,
      ["lookup", "workspace", "--json"],
      isolatedPath
    );
    assertSuccess(lookup, "read-only lookup");
    const lookupResult = JSON.parse(lookup.stdout) as {
      readonly command?: string;
      readonly exitCode?: number;
      readonly ok?: boolean;
    };
    if (
      lookupResult.command !== "lookup" ||
      lookupResult.exitCode !== 0 ||
      lookupResult.ok !== true ||
      lookup.stderr !== ""
    ) {
      throw new Error(
        "Native read-only lookup did not preserve the CLI result contract"
      );
    }

    const invalid = await run(executable, ["__native-invalid__"], isolatedPath);
    if (
      invalid.exitCode !== 1 ||
      !invalid.stderr.includes("skillset: expected command") ||
      !invalid.stderr.includes("usage: skillset")
    ) {
      throw new Error(
        "Native invalid-command behavior does not preserve exit and usage parity"
      );
    }

    try {
      await readFile(marker);
      throw new Error("Native smoke invoked a system Bun executable");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  } finally {
    await rm(smokeRoot, { force: true, recursive: true });
  }
}
