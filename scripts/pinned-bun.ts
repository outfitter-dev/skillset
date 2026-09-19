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
import { chmod, mkdir, mkdtemp, readFile, rename, rm, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

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

/** Root of the version-scoped interpreter cache. Never the global install. */
export function pinnedBunRoot(version: string): string {
  const cacheHome =
    process.env.XDG_CACHE_HOME?.trim() || join(homedir(), ".cache");
  return join(cacheHome, "skillset", "bun", version);
}

async function isExecutable(path: string): Promise<boolean> {
  try {
    const info = await stat(path);
    return info.isFile();
  } catch {
    return false;
  }
}

async function reportedVersion(binPath: string): Promise<string | null> {
  const child = Bun.spawn({
    cmd: [binPath, "--version"],
    stderr: "ignore",
    stdout: "pipe",
  });
  const text = (await new Response(child.stdout).text()).trim();
  const code = await child.exited;
  return code === 0 && text.length > 0 ? text : null;
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
      cmd: ["bash", "-c", `curl -fsSL https://bun.sh/install | bash -s -- "bun-v${version}"`],
      env: { ...process.env, BUN_INSTALL: staging },
      stderr: "inherit",
      stdout: "ignore",
    });
    if ((await install.exited) !== 0) {
      throw new Error(`installer exited non-zero for bun-v${version}`);
    }
    const staged = join(staging, "bin", "bun");
    if (!(await isExecutable(staged))) {
      throw new Error(`installer produced no interpreter at ${staged}`);
    }
    await chmod(staged, 0o755);
    await rename(staging, targetRoot).catch(async (error: unknown) => {
      // A concurrent run may have won the race; accept its result.
      if (await isExecutable(join(targetRoot, "bin", "bun"))) return;
      throw error;
    });
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
  const binPath = join(binDir, "bun");

  if ((await isExecutable(binPath)) && (await reportedVersion(binPath)) === version) {
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
