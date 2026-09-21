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
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  symlink,
} from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";

/**
 * How the pinned interpreter was obtained for this run.
 *
 * There is deliberately no ambient source. An ambient interpreter that matches
 * the pin is copied into the version-scoped cache and reported as `adopted`,
 * because the directory it came from is not one this repository controls.
 */
export type PinnedBunSource = "adopted" | "cached" | "installed";

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

/** Name of the `bunx` shim beside the interpreter. */
export function pinnedBunxExecutableName(
  platform: NodeJS.Platform = process.platform
): string {
  return platform === "win32" ? "bunx.exe" : "bunx";
}

/**
 * Put a `bunx` beside the pinned interpreter.
 *
 * `bunx` is how `scripts/package-smoke.ts` runs the packed CLI, and it runs
 * inside `bun run check`. A cache root holding only `bun` leaves `bunx` to be
 * resolved from the rest of `PATH`, where it is a symlink to the contested
 * `~/.bun/bin/bun` that every repository's bootstrap overwrites — so pinning
 * the interpreter while leaving `bunx` ambient pins half the runtime and lets
 * the packed-CLI smoke test run under whatever version happens to be installed.
 *
 * Bun dispatches on argv[0], so a link named `bunx` is the whole mechanism;
 * Windows gets a copy because symlinks there need privileges we should not
 * require. Idempotent: an existing shim is left alone.
 */
async function ensurePinnedBunx(
  binDir: string,
  executableName = pinnedBunExecutableName(),
  bunxName = pinnedBunxExecutableName()
): Promise<void> {
  const bunxPath = join(binDir, bunxName);
  if (await pathExists(bunxPath)) return;
  try {
    if (process.platform === "win32") {
      await copyFile(join(binDir, executableName), bunxPath);
    } else {
      // Relative, so the link survives the atomic rename that publishes a
      // staging directory into its final cache root. An absolute link would
      // point at the staging path and dangle the moment it is published.
      await symlink(executableName, bunxPath);
    }
  } catch (error) {
    // A concurrent publisher winning the race is the expected case.
    if (!(await pathExists(bunxPath))) throw error;
  }
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

/**
 * What probing an interpreter told us.
 *
 * `unusable` and `unavailable` are deliberately different answers. A file that
 * cannot be executed at all is corrupt cache state — an interrupted install
 * leaves exactly that — and must be replaced. A spawn that failed because the
 * machine was momentarily out of processes or descriptors says nothing about
 * the file, and destroying a healthy root on that basis would take another
 * process's interpreter with it.
 */
type InterpreterProbe =
  | { readonly kind: "reported"; readonly version: string }
  | { readonly kind: "unusable" }
  | { readonly kind: "unavailable" };

/**
 * Errors that describe a momentary condition, not the target file.
 *
 * ETXTBSY is the important one: it is what exec returns for a file another
 * process still holds open for writing, which is precisely the window this
 * cache's own concurrent publication opens. Treating it as evidence of a bad
 * interpreter would let one contender quarantine a root that is merely being
 * written by another.
 */
const TRANSIENT_SPAWN_CODES = new Set([
  "EAGAIN",
  "EBUSY",
  "EMFILE",
  "ENFILE",
  "ENOMEM",
  "ETXTBSY",
]);

export function isTransientSpawnFailure(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return false;
  }
  const { code } = error;
  return typeof code === "string" && TRANSIENT_SPAWN_CODES.has(code);
}

async function probeVersion(binPath: string): Promise<InterpreterProbe> {
  try {
    const child = Bun.spawn({
      cmd: [binPath, "--version"],
      stderr: "ignore",
      stdout: "pipe",
    });
    const text = (await new Response(child.stdout).text()).trim();
    const code = await child.exited;
    if (code === 0 && text.length > 0) {
      return { kind: "reported", version: text };
    }
    // It ran and answered badly. That is a real answer about this file.
    return { kind: "unusable" };
  } catch (error) {
    return isTransientSpawnFailure(error)
      ? { kind: "unavailable" }
      : { kind: "unusable" };
  }
}

async function reportedVersion(binPath: string): Promise<string | null> {
  const probe = await probeVersion(binPath);
  return probe.kind === "reported" ? probe.version : null;
}

async function pathExists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false
  );
}

/**
 * Whether a cache root holds the requested interpreter.
 *
 * `unknown` means the question could not be answered right now — the file is
 * there but could not be executed. Callers that destroy state must treat it as
 * "leave alone", never as "wrong".
 */
export type CacheRootState = "valid" | "invalid" | "unknown";

export async function pinnedBunRootState(
  root: string,
  version: string,
  executableName: string
): Promise<CacheRootState> {
  const binPath = join(root, "bin", executableName);
  if (!(await isExecutable(binPath))) return "invalid";
  const probe = await probeVersion(binPath);
  if (probe.kind === "unavailable") return "unknown";
  if (probe.kind === "unusable") return "invalid";
  return probe.version === version ? "valid" : "invalid";
}

async function isPinnedBunRoot(
  root: string,
  version: string,
  executableName: string
): Promise<boolean> {
  return (await pinnedBunRootState(root, version, executableName)) === "valid";
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
  const stagedState = await pinnedBunRootState(staging, version, executableName);
  if (stagedState === "unknown") {
    // Twin of the target-side case: a spawn that failed for a transient reason
    // says nothing about what was staged, so it must not be reported as a
    // wrong-version interpreter.
    throw new Error(
      `could not verify the staged bun-v${version} runtime: it could not be executed on this host`
    );
  }
  if (stagedState !== "valid") {
    throw new Error(`staged runtime does not report bun-v${version}`);
  }

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const state = await pinnedBunRootState(targetRoot, version, executableName);
    if (state === "valid") return;
    if (state === "unknown") {
      // Could not execute the existing interpreter. That is not evidence it is
      // wrong, so back off and re-probe rather than quarantining a root another
      // process may be using.
      await Bun.sleep(50 * (attempt + 1));
      continue;
    }

    try {
      await rename(staging, targetRoot);
      return;
    } catch {
      const after = await pinnedBunRootState(targetRoot, version, executableName);
      if (after === "valid") return;
      if (after === "unknown") {
        await Bun.sleep(50 * (attempt + 1));
        continue;
      }
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

  const finalState = await pinnedBunRootState(targetRoot, version, executableName);
  if (finalState === "valid") return;
  if (finalState === "unknown") {
    // Distinct from a bad cache: every probe failed for a transient reason, so
    // the root was deliberately left alone. Saying "could not publish" here
    // would send a reader looking for corruption that is not there.
    throw new Error(
      `could not verify bun-v${version} cache at ${targetRoot}: the interpreter there could not be executed on this host after repeated attempts, and the existing cache was left untouched`
    );
  }
  throw new Error(`could not publish bun-v${version} cache at ${targetRoot}`);
}

/**
 * Copy an interpreter that already matches the pin into a cache root.
 *
 * Mirrors `installPinnedBun`'s staging and publish steps so both sources land
 * through the same atomic rename, but takes the bytes from an interpreter that
 * is already on this machine instead of the network. The source is resolved
 * through `realpath` first: it is commonly a symlink into a version directory,
 * and copying the link target is what makes the cached copy independent of
 * later writes to the original name.
 *
 * `sourcePath` and `targetRoot` are explicit so the adoption step can be
 * exercised without depending on where the running interpreter happens to live
 * — inside the test sandbox that is already the cache, which would make the
 * property under test vacuously true.
 */
export async function adoptPinnedBun(
  version: string,
  targetRoot: string,
  sourcePath: string = process.execPath
): Promise<void> {
  const parent = join(targetRoot, "..");
  await mkdir(parent, { recursive: true });
  const staging = await mkdtemp(join(parent, `skillset-bun-${version}-`));
  try {
    const executableName = pinnedBunExecutableName();
    await mkdir(join(staging, "bin"), { recursive: true });
    const staged = join(staging, "bin", executableName);
    await copyFile(await realpath(sourcePath), staged);
    if (process.platform !== "win32") await chmod(staged, 0o755);
    await ensurePinnedBunx(join(staging, "bin"), executableName);
    await publishPinnedBunCache(version, staging, targetRoot, executableName);
  } finally {
    await rm(staging, { force: true, recursive: true }).catch(() => {});
  }
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
    await ensurePinnedBunx(join(staging, "bin"), executableName);
    await publishPinnedBunCache(version, staging, targetRoot, executableName);
  } finally {
    await rm(staging, { force: true, recursive: true }).catch(() => {});
  }
}

/**
 * Resolve the interpreter for this run.
 *
 * Always returns a path inside the version-scoped cache, never the directory
 * the ambient interpreter happens to live in. That directory is shared: every
 * repository whose agent bootstrap installs a pinned Bun writes the same
 * `~/.bun/bin/bun`, and `scripts/test-sandbox.ts` puts the resolved directory
 * on `PATH` for the whole run. Resolving through it means a bootstrap starting
 * in another repository can change which interpreter this run's subprocesses
 * get, halfway through a gate. That is observed behaviour, not a hypothetical:
 * a timing sample was invalidated when the path changed version mid-run.
 *
 * An ambient interpreter that already matches the pin is still the cheapest
 * correct source, so it is adopted by copy rather than downloaded. The cost is
 * one file copy per version, including in CI where `oven-sh/setup-bun` has
 * already installed `.bun-version` and the previous fast path paid nothing.
 * Measured on an Apple M2 Ultra, adoption of the 61 MB interpreter took a
 * median of 711 ms over five runs (704-736 ms): about 0.17% of a CI job that
 * runs for roughly 419 s, paid once per job on a cold cache and never again on
 * a warm one.
 */
export async function resolvePinnedBun(repoRoot: string): Promise<PinnedBun> {
  const version = await readPin(repoRoot);
  const root = pinnedBunRoot(version);
  const binDir = join(root, "bin");
  const binPath = join(binDir, pinnedBunExecutableName());

  if (await isPinnedBunRoot(root, version, pinnedBunExecutableName())) {
    // Roots published before the shim existed hold only the interpreter.
    await ensurePinnedBunx(binDir).catch(() => {});
    return { binDir, binPath, source: "cached", version };
  }

  if (Bun.version === version) {
    // A failed adoption is not fatal: another process may have published the
    // same version first, and otherwise the installer below still resolves it.
    await adoptPinnedBun(version, root).catch(() => {});
    if (await isPinnedBunRoot(root, version, pinnedBunExecutableName())) {
      return { binDir, binPath, source: "adopted", version };
    }
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
