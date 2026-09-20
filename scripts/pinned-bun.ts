/**
 * Resolve the Bun interpreter the test sandbox must run.
 *
 * `scripts/test-sandbox.ts` isolates XDG directories, git configuration, and
 * the transpiler cache, but it spawns whatever `bun` the ambient PATH resolves.
 * Several checks compare recorded evidence against the *running* interpreter —
 * `scripts/native-artifacts.ts` rejects a size baseline whose `bunVersion` is
 * not `Bun.version` — so the suite only passed for a contributor whose global
 * Bun happened to equal `.bun-version`.
 *
 * This module makes that axis deterministic without touching the contributor's
 * global install: the pinned version is cached under the user cache directory,
 * version-scoped, and resolved per run.
 */
import { randomUUID } from "node:crypto";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  stat,
} from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";

/** How the pinned interpreter was obtained for this run. */
export type PinnedBunSource = "ambient" | "cached" | "installed";

export interface PinnedBun {
  /** Absolute path to the interpreter to execute. */
  readonly binPath: string;
  /** Directory holding that interpreter, for PATH precedence. */
  readonly binDir: string;
  /** The version read from `.bun-version`. */
  readonly version: string;
  readonly source: PinnedBunSource;
}

/** Read and validate the repository's pinned Bun version. */
export async function readPin(repoRoot: string): Promise<string> {
  const raw = await readFile(join(repoRoot, ".bun-version"), "utf8");
  const pin = raw.trim();
  if (!/^\d+\.\d+\.\d+$/u.test(pin)) {
    throw new Error(
      `.bun-version must hold a three-part version; found ${JSON.stringify(pin)}`
    );
  }
  return pin;
}

/** Root of the host- and version-scoped interpreter cache. Never the global install. */
export function pinnedBunRoot(version: string): string {
  // test-sandbox replaces inherited XDG roots after resolving the interpreter.
  // Using that ambient value here would write the persistent runtime into a
  // caller-controlled directory that the child must otherwise leave untouched.
  return join(
    homedir(),
    ".cache",
    "skillset",
    "bun",
    `${process.platform}-${process.arch}`,
    version
  );
}

/** Native executable name produced by Bun's platform installer. */
export function pinnedBunExecutableName(
  platform: NodeJS.Platform = process.platform
): string {
  return platform === "win32" ? "bun.exe" : "bun";
}

/** Official version-pinned installer invocation for the current host. */
export function pinnedBunInstallCommand(
  version: string,
  platform: NodeJS.Platform = process.platform
): string[] {
  if (platform === "win32") {
    return [
      "powershell.exe",
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `iex "& {$(irm https://bun.com/install.ps1)} -Version ${version}"`,
    ];
  }
  return [
    "bash",
    "-c",
    `curl -fsSL https://bun.com/install | bash -s -- "bun-v${version}"`,
  ];
}

/** Put the pinned interpreter first without assuming a POSIX PATH separator. */
export function prependExecutablePath(
  binDir: string,
  currentPath: string | undefined,
  separator = delimiter
): string {
  return [binDir, currentPath].filter(Boolean).join(separator);
}

async function isExecutable(path: string): Promise<boolean> {
  try {
    const info = await stat(path);
    return (
      info.isFile() &&
      (process.platform === "win32" || (info.mode & 0o111) !== 0)
    );
  } catch {
    return false;
  }
}

async function reportedVersion(binPath: string): Promise<string | null> {
  try {
    const child = Bun.spawn({
      cmd: [binPath, "--version"],
      stderr: "ignore",
      stdout: "pipe",
    });
    const text = (await new Response(child.stdout).text()).trim();
    const code = await child.exited;
    return code === 0 && text.length > 0 ? text : null;
  } catch {
    return null;
  }
}

async function pathExists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false
  );
}

async function isPinnedBunRoot(
  root: string,
  version: string,
  executableName: string
): Promise<boolean> {
  const binPath = join(root, "bin", executableName);
  return (
    (await isExecutable(binPath)) &&
    (await reportedVersion(binPath)) === version
  );
}

/**
 * Atomically publish a validated staged runtime, replacing stale cache state.
 *
 * Each contender first accepts a valid winner. Invalid targets are renamed out
 * of the way rather than removed in place, so another process never observes a
 * half-rewritten cache root. A contender that loses after quarantine accepts
 * only a winner that reports the requested version.
 */
export async function publishPinnedBunCache(
  version: string,
  staging: string,
  targetRoot: string,
  executableName = pinnedBunExecutableName()
): Promise<void> {
  if (!(await isPinnedBunRoot(staging, version, executableName))) {
    throw new Error(`staged runtime does not report bun-v${version}`);
  }

  for (let attempt = 0; attempt < 5; attempt += 1) {
    if (await isPinnedBunRoot(targetRoot, version, executableName)) return;

    try {
      await rename(staging, targetRoot);
      return;
    } catch {
      if (await isPinnedBunRoot(targetRoot, version, executableName)) return;
      if (!(await pathExists(targetRoot))) continue;

      const quarantine = `${targetRoot}.invalid-${randomUUID()}`;
      try {
        await rename(targetRoot, quarantine);
      } catch {
        if (await isPinnedBunRoot(targetRoot, version, executableName)) return;
        continue;
      }

      try {
        await rename(staging, targetRoot);
        return;
      } catch (replaceError) {
        if (await isPinnedBunRoot(targetRoot, version, executableName)) return;
        if (!(await pathExists(targetRoot))) {
          await rename(quarantine, targetRoot).catch(() => {});
        }
        throw replaceError;
      } finally {
        await rm(quarantine, { force: true, recursive: true }).catch(() => {});
      }
    }
  }

  if (await isPinnedBunRoot(targetRoot, version, executableName)) return;
  throw new Error(`could not publish bun-v${version} cache at ${targetRoot}`);
}

/**
 * Download the pinned interpreter into a version-scoped directory.
 *
 * The official installer writes to `$BUN_INSTALL`, so pointing that at a
 * disposable staging directory keeps the contributor's global Bun untouched.
 * Staging lives next to the versioned cache root so the publish rename stays
 * on one filesystem; POSIX rename cannot move a directory across mounts.
 * The staged tree is renamed into place so a concurrent run never observes a
 * half-written interpreter.
 */
async function installPinnedBun(
  version: string,
  targetRoot: string
): Promise<void> {
  const parent = join(targetRoot, "..");
  await mkdir(parent, { recursive: true });
  const staging = await mkdtemp(join(parent, `skillset-bun-${version}-`));
  try {
    const install = Bun.spawn({
      cmd: pinnedBunInstallCommand(version),
      env: { ...process.env, BUN_INSTALL: staging },
      stderr: "inherit",
      stdout: "ignore",
    });
    if ((await install.exited) !== 0) {
      throw new Error(`installer exited non-zero for bun-v${version}`);
    }
    const executableName = pinnedBunExecutableName();
    const staged = join(staging, "bin", executableName);
    if (!(await isExecutable(staged))) {
      throw new Error(`installer produced no interpreter at ${staged}`);
    }
    if (process.platform !== "win32") await chmod(staged, 0o755);
    await publishPinnedBunCache(version, staging, targetRoot, executableName);
  } finally {
    await rm(staging, { force: true, recursive: true }).catch(() => {});
  }
}

/**
 * Resolve the interpreter for this run.
 *
 * Returns the ambient interpreter when it already equals the pin, so CI — where
 * `oven-sh/setup-bun` installs `.bun-version` — pays no install and no copy.
 */
export async function resolvePinnedBun(repoRoot: string): Promise<PinnedBun> {
  const version = await readPin(repoRoot);
  if (Bun.version === version) {
    const binPath = process.execPath;
    return {
      binDir: join(binPath, ".."),
      binPath,
      source: "ambient",
      version,
    };
  }

  const root = pinnedBunRoot(version);
  const binDir = join(root, "bin");
  const binPath = join(binDir, pinnedBunExecutableName());

  if (await isPinnedBunRoot(root, version, pinnedBunExecutableName())) {
    return { binDir, binPath, source: "cached", version };
  }

  await installPinnedBun(version, root);
  const observed = await reportedVersion(binPath);
  if (observed !== version) {
    throw new Error(
      `pinned Bun ${version} could not be provisioned at ${binPath}; ` +
        `the interpreter there reports ${observed ?? "nothing"}. ` +
        `Ambient Bun is ${Bun.version}.`
    );
  }
  return { binDir, binPath, source: "installed", version };
}
