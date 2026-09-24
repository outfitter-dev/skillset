import { lstat, readFile, readdir, realpath, rm } from "node:fs/promises";
import { basename, isAbsolute, join, relative } from "node:path";

import { gitSafeEnv } from "../apps/skillset/src/git-env";
import { parseDescriptor } from "../apps/skillset/src/verification-sandbox";

const RETAIN_AGE_MS = 7 * 24 * 60 * 60 * 1000;
export const TEST_SANDBOX_LEASE = "lease.json";

export interface RetentionResult {
  readonly collected: number;
  readonly retained: number;
  readonly skipped: number;
  readonly failures: readonly string[];
}

interface RetentionOptions {
  readonly now?: number;
  readonly remove?: typeof removeOwnedSandbox;
  readonly isAlive?: (pid: number) => boolean;
}

interface Lease {
  readonly gitCommonDir: string;
  readonly invocationId: string;
  readonly pid: number;
}

export async function resolveTestRepoIdentity(repoRoot: string): Promise<string> {
  const child = Bun.spawn({
    cmd: ["git", "-C", repoRoot, "rev-parse", "--path-format=absolute", "--git-common-dir"],
    env: gitSafeEnv(),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [status, output, error] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  if (status !== 0) throw new Error(`could not resolve test repository identity: ${error.trim()}`);
  return realpath(output.trim());
}

export async function collectStaleTestSandboxes(
  tempRoot: string,
  repoRoot: string,
  options: RetentionOptions = {}
): Promise<RetentionResult> {
  const cutoff = (options.now ?? Date.now()) - RETAIN_AGE_MS;
  const remove = options.remove ?? removeOwnedSandbox;
  const isAlive = options.isAlive ?? isProcessAlive;
  const gitCommonDir = await resolveTestRepoIdentity(repoRoot);
  const result = { collected: 0, retained: 0, skipped: 0, failures: [] as string[] };
  const names = await readdir(tempRoot);
  for (const name of names) {
    if (!name.startsWith("skillset-test-")) continue;
    const path = join(tempRoot, name);
    try {
      const entry = await lstat(path);
      if (!entry.isDirectory() || entry.isSymbolicLink() || await realpath(path) !== path) {
        result.skipped++;
        continue;
      }
      const descriptor = await readOwnedJson(join(path, "descriptor.json"), parseDescriptor);
      const lease = await readOwnedJson(join(path, TEST_SANDBOX_LEASE), parseLease);
      if (
        !descriptor ||
        descriptor.sandboxPath !== path ||
        !lease ||
        lease.invocationId !== descriptor.invocationId ||
        lease.gitCommonDir !== gitCommonDir
      ) {
        result.skipped++;
        continue;
      }
      // A missing lease cannot prove the original runner has exited. Old
      // descriptor-only sandboxes therefore remain outside automatic cleanup.
      if (
        entry.mtimeMs >= cutoff ||
        Date.parse(descriptor.createdAt) >= cutoff ||
        isAlive(lease.pid)
      ) {
        result.retained++;
        continue;
      }
      await remove(path, tempRoot);
      result.collected++;
    } catch (error) {
      result.failures.push(`${name}: ${message(error)}`);
    }
  }
  return result;
}

async function readOwnedJson<T>(path: string, parse: (value: unknown) => T): Promise<T | undefined> {
  const entry = await lstat(path).catch((error: unknown) => {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
    throw error;
  });
  if (!entry || !entry.isFile() || entry.isSymbolicLink()) return undefined;
  const raw = await readFile(path, "utf8");
  try {
    return parse(JSON.parse(raw) as unknown);
  } catch {
    return undefined;
  }
}

function parseLease(value: unknown): Lease {
  if (typeof value !== "object" || value === null) throw new Error("invalid test sandbox lease");
  const lease = value as Record<string, unknown>;
  if (
    JSON.stringify(Object.keys(lease).sort()) !== JSON.stringify(["gitCommonDir", "invocationId", "pid"]) ||
    typeof lease.gitCommonDir !== "string" ||
    !isAbsolute(lease.gitCommonDir) ||
    typeof lease.invocationId !== "string" ||
    !Number.isSafeInteger(lease.pid) ||
    Number(lease.pid) <= 0
  ) throw new Error("invalid test sandbox lease");
  return lease as unknown as Lease;
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM and unknown failures are conservative: retain rather than guess.
    return !(error instanceof Error && "code" in error && error.code === "ESRCH");
  }
}

export async function removeOwnedSandbox(sandboxPath: string, tempRoot: string): Promise<void> {
  const canonical = await realpath(sandboxPath).catch(() => undefined);
  const relativePath = canonical === undefined ? undefined : relative(tempRoot, canonical);
  if (
    canonical !== sandboxPath ||
    !relativePath ||
    relativePath.startsWith("..") ||
    isAbsolute(relativePath) ||
    !basename(canonical).startsWith("skillset-test-")
  ) {
    throw new Error(`refusing to clean unowned test sandbox: ${sandboxPath}`);
  }
  await rm(canonical, { recursive: true });
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
