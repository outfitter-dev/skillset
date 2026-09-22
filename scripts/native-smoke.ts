import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, delimiter, dirname, join } from "node:path";

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
  path: string,
  extraEnv: Record<string, string> = {}
): Promise<ProcessResult> {
  const child = Bun.spawn([executable, ...args], {
    env: { ...process.env, ...extraEnv, PATH: path },
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

  await smokeNativeRuntimeHooks(executable);
}

async function smokeNativeRuntimeHooks(executable: string): Promise<void> {
  const smokeRoot = await mkdtemp(join(tmpdir(), "skillset-native-hook-smoke-"));
  const repo = join(smokeRoot, "repo");
  const tools = join(smokeRoot, "tools");
  const gitBin = join(smokeRoot, "git-bin");
  const discoveredMarker = join(smokeRoot, "discovered-skillset-was-invoked");
  const overrideMarker = join(smokeRoot, "override-skillset-was-invoked");
  const shellMarker = join(smokeRoot, "shell-override-was-invoked");
  await mkdir(repo, { recursive: true });
  await mkdir(tools, { recursive: true });
  await mkdir(gitBin, { recursive: true });
  await isolateGit(gitBin);
  await writeFile(join(repo, "skillset.yaml"), "skillset:\n  schema: 1\n");
  await runGit(repo, ["init"]);

  try {
    const discoveredRunner = await writeFakeSkillset(tools, discoveredMarker);
    const discovered = await run(
      executable,
      ["hooks", "run", "post-tool-use", "--root", repo],
      [tools, gitBin].join(delimiter)
    );
    assertSuccess(discovered, "runtime-hook discovery");
    if (!(await readMarker(discoveredMarker)).includes("change")) {
      throw new Error(
        `Native runtime-hook discovery did not execute the PATH runner ${discoveredRunner}`
      );
    }

    const missing = await run(
      executable,
      ["hooks", "run", "post-tool-use", "--root", repo],
      gitBin
    );
    if (
      missing.exitCode === 0 ||
      !missing.stderr.includes(
        "skillset: could not find a Skillset CLI runner; install skillset or set SKILLSET_HOOK_COMMAND"
      )
    ) {
      throw new Error(
        `Native runtime-hook missing runner diagnostic failed: exit=${missing.exitCode} stderr=${JSON.stringify(missing.stderr)}`
      );
    }

    const overrideRunner = await writeFakeSkillset(tools, overrideMarker);
    const override = await run(
      executable,
      ["hooks", "run", "post-tool-use", "--root", repo],
      gitBin,
      { SKILLSET_HOOK_COMMAND: overrideRunner }
    );
    assertSuccess(override, "runtime-hook argv override");
    if (!(await readMarker(overrideMarker)).includes("change")) {
      throw new Error("Native runtime-hook argv override did not execute the override executable");
    }

    const shellOverride = process.platform === "win32"
      ? `echo invoked>${shellMarker}&rem`
      : `:; printf invoked > '${shellMarker}'`;
    const shell = await run(
      executable,
      ["hooks", "run", "post-tool-use", "--root", repo],
      gitBin,
      { SKILLSET_HOOK_COMMAND: shellOverride }
    );
    assertSuccess(shell, "runtime-hook shell override");
    await readMarker(shellMarker);
  } finally {
    await rm(smokeRoot, { force: true, recursive: true });
  }
}

async function isolateGit(binDir: string): Promise<void> {
  const git = Bun.which("git");
  if (!git) throw new Error("Native runtime-hook smoke requires git");
  const isolated = join(
    binDir,
    process.platform === "win32" ? "git.exe" : "git"
  );
  try {
    await symlink(git, isolated);
  } catch {
    await copyFile(git, isolated);
  }
  if (process.platform === "win32" && basename(git).toLowerCase() === "git.exe") {
    const cmdShim = join(dirname(git), "git.cmd");
    try {
      await copyFile(cmdShim, join(binDir, "git.cmd"));
    } catch {
      // git.exe is enough when the cmd shim is absent
    }
  }
}

async function writeFakeSkillset(binDir: string, marker: string): Promise<string> {
  const path = join(
    binDir,
    process.platform === "win32" ? "skillset.cmd" : "skillset"
  );
  if (process.platform === "win32") {
    await writeFile(path, `@echo off\r\n>"${marker}" echo %*\r\nexit /b 0\r\n`);
  } else {
    await writeFile(
      path,
      `#!/bin/sh\nprintf '%s\\n' "$@" > '${marker}'\nexit 0\n`
    );
    await chmod(path, 0o755);
  }
  return path;
}

async function runGit(cwd: string, args: readonly string[]): Promise<void> {
  const child = Bun.spawn(["git", ...args], {
    cwd,
    env: process.env,
    stderr: "pipe",
    stdout: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  if (exitCode !== 0) {
    throw new Error(`Native runtime-hook git ${args.join(" ")} failed:\n${stdout}${stderr}`);
  }
}

async function readMarker(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`Native runtime-hook smoke missing marker ${path}`);
    }
    throw error;
  }
}
