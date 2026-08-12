#!/usr/bin/env node

import { spawn, type ChildProcess } from "node:child_process";
import { readFile, realpath, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { constants } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  NATIVE_DISTRIBUTIONS,
  type NativeDistribution,
} from "./native-distribution";

export class SkillsetLauncherError extends Error {
  override readonly name = "SkillsetLauncherError";
}

export interface LauncherRuntime {
  readonly arch: string;
  readonly libc: "glibc" | "musl" | "unknown";
  readonly platform: string;
}

export interface LauncherRuntimeReport {
  readonly header: Record<string, unknown>;
  readonly sharedObjects?: readonly string[];
}

interface NativePackageManifest {
  readonly name?: string;
  readonly version?: string;
}

interface ResolvedNativeExecutable {
  readonly executable: string;
  readonly packageName: string;
}

export function detectLinuxLibc(
  report: LauncherRuntimeReport | undefined
): LauncherRuntime["libc"] {
  if (!report) return "unknown";
  const header = report.header as Record<string, unknown>;
  if (
    typeof header.glibcVersionRuntime === "string" &&
    header.glibcVersionRuntime.length > 0
  ) {
    return "glibc";
  }
  const sharedObjects: readonly string[] = Array.isArray(report.sharedObjects)
    ? report.sharedObjects
    : [];
  return sharedObjects.some((path) =>
    /(?:^|[/\\])libc\.musl-|ld-musl-/i.test(path)
  )
    ? "musl"
    : "unknown";
}

export function currentLauncherRuntime(): LauncherRuntime {
  const report = process.report?.getReport() as
    | LauncherRuntimeReport
    | undefined;
  return {
    arch: process.arch,
    libc: process.platform === "linux" ? detectLinuxLibc(report) : "unknown",
    platform: process.platform,
  };
}

export function selectNativeDistribution(
  runtime: LauncherRuntime
): NativeDistribution {
  const match = NATIVE_DISTRIBUTIONS.find(
    (distribution) =>
      distribution.required &&
      distribution.os === runtime.platform &&
      distribution.arch === runtime.arch &&
      (distribution.os !== "linux" || distribution.libc === runtime.libc)
  );
  if (match) return match;

  const supportedLinuxArch = NATIVE_DISTRIBUTIONS.some(
    (distribution) =>
      distribution.required &&
      distribution.os === "linux" &&
      distribution.arch === runtime.arch
  );
  if (
    runtime.platform === "linux" &&
    supportedLinuxArch &&
    runtime.libc === "musl"
  ) {
    throw new SkillsetLauncherError(
      `Linux ${runtime.arch} uses musl, whose Skillset package is reserved but not in the initial release. Use \`bunx @skillset/cli\` when Bun is available.`
    );
  }
  if (
    runtime.platform === "linux" &&
    supportedLinuxArch &&
    runtime.libc === "unknown"
  ) {
    throw new SkillsetLauncherError(
      `Could not determine the Linux libc for ${runtime.arch}. Reinstall on a supported glibc host or use \`bunx @skillset/cli\` when Bun is available.`
    );
  }
  throw new SkillsetLauncherError(
    `Unsupported platform ${runtime.platform}-${runtime.arch}. Supported native targets: ${NATIVE_DISTRIBUTIONS.filter(
      (distribution) => distribution.required
    )
      .map((distribution) => distribution.suffix)
      .join(", ")}.`
  );
}

export async function resolveNativeExecutable(options: {
  readonly distribution: NativeDistribution;
  readonly launcherVersion: string;
  readonly resolvePackage?: (specifier: string) => string;
}): Promise<ResolvedNativeExecutable> {
  const resolvePackage =
    options.resolvePackage ?? createRequire(import.meta.url).resolve;
  let packageJsonPath: string;
  try {
    packageJsonPath = resolvePackage(
      `${options.distribution.npmPackage}/package.json`
    );
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "MODULE_NOT_FOUND" && code !== "ERR_MODULE_NOT_FOUND") {
      throw error;
    }
    throw new SkillsetLauncherError(
      `The native package ${options.distribution.npmPackage} is missing. Reinstall with optional dependencies enabled: \`npm install --location=global skillset\`.`
    );
  }

  let manifest: NativePackageManifest;
  try {
    manifest = JSON.parse(
      await readFile(packageJsonPath, "utf8")
    ) as NativePackageManifest;
  } catch {
    throw new SkillsetLauncherError(
      `The native package ${options.distribution.npmPackage} has an unreadable package manifest. Reinstall \`skillset\`.`
    );
  }
  if (
    manifest.name !== options.distribution.npmPackage ||
    manifest.version !== options.launcherVersion
  ) {
    throw new SkillsetLauncherError(
      `Package version mismatch: skillset@${options.launcherVersion} requires ${options.distribution.npmPackage}@${options.launcherVersion}, found ${manifest.name ?? "unknown"}@${manifest.version ?? "unknown"}. Reinstall \`skillset\`.`
    );
  }

  const executable = join(
    dirname(packageJsonPath),
    "bin",
    options.distribution.executable
  );
  try {
    const details = await stat(executable);
    if (!details.isFile() || details.size <= 0) throw new Error("not a file");
    if (options.distribution.os !== "win32" && (details.mode & 0o111) === 0) {
      throw new Error("not executable");
    }
  } catch {
    throw new SkillsetLauncherError(
      `The native executable in ${options.distribution.npmPackage} is missing or corrupt. Reinstall \`skillset\`.`
    );
  }
  return { executable, packageName: options.distribution.npmPackage };
}

const forwardedSignals = ["SIGINT", "SIGTERM", "SIGHUP"] as const;

async function spawnNative(
  executable: string,
  args: readonly string[]
): Promise<{
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
}> {
  let child: ChildProcess;
  try {
    child = spawn(executable, args, { stdio: "inherit", windowsHide: false });
  } catch (error) {
    throw new SkillsetLauncherError(
      `Could not start the native Skillset executable: ${(error as Error).message}`
    );
  }

  const handlers = new Map<NodeJS.Signals, () => void>();
  for (const signal of forwardedSignals) {
    if (process.platform === "win32" && signal === "SIGHUP") continue;
    const handler = () => {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill(signal);
      }
    };
    handlers.set(signal, handler);
    process.on(signal, handler);
  }

  try {
    return await new Promise((resolveResult, reject) => {
      child.once("error", (error) => {
        reject(
          new SkillsetLauncherError(
            `Could not start the native Skillset executable: ${error.message}`
          )
        );
      });
      child.once("exit", (code, signal) => resolveResult({ code, signal }));
    });
  } finally {
    for (const [signal, handler] of handlers) {
      process.off(signal, handler);
    }
  }
}

export async function executeLauncher(
  args: readonly string[],
  options: {
    readonly packageJsonPath?: string;
    readonly resolvePackage?: (specifier: string) => string;
    readonly runtime?: LauncherRuntime;
  } = {}
): Promise<{
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
}> {
  const packageJsonPath =
    options.packageJsonPath ??
    resolve(dirname(fileURLToPath(import.meta.url)), "..", "package.json");
  let manifest: NativePackageManifest;
  try {
    manifest = JSON.parse(
      await readFile(packageJsonPath, "utf8")
    ) as NativePackageManifest;
  } catch {
    throw new SkillsetLauncherError(
      "The skillset launcher package manifest is invalid. Reinstall `skillset`."
    );
  }
  if (manifest.name !== "skillset" || typeof manifest.version !== "string") {
    throw new SkillsetLauncherError(
      "The skillset launcher package manifest is invalid. Reinstall `skillset`."
    );
  }
  const distribution = selectNativeDistribution(
    options.runtime ?? currentLauncherRuntime()
  );
  const resolved = await resolveNativeExecutable({
    distribution,
    launcherVersion: manifest.version,
    ...(options.resolvePackage
      ? { resolvePackage: options.resolvePackage }
      : {}),
  });
  return spawnNative(resolved.executable, args);
}

async function main(): Promise<void> {
  try {
    const result = await executeLauncher(process.argv.slice(2));
    if (result.signal && process.platform !== "win32") {
      process.kill(process.pid, result.signal);
      return;
    }
    if (result.signal) {
      const signalNumber = constants.signals[result.signal] ?? 1;
      process.exitCode = 128 + signalNumber;
      return;
    }
    process.exitCode = result.code ?? 1;
  } catch (error) {
    console.error(
      `skillset: ${error instanceof Error ? error.message : String(error)}`
    );
    process.exitCode = 1;
  }
}

async function isMainModule(): Promise<boolean> {
  if (!process.argv[1]) return false;
  try {
    return (
      (await realpath(process.argv[1])) ===
      (await realpath(fileURLToPath(import.meta.url)))
    );
  } catch {
    return false;
  }
}

if (await isMainModule()) await main();
