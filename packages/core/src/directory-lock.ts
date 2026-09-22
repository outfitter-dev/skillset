import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

const MAX_PROCESS_ID = 2_147_483_647;
const OWNER_TOKEN_PATTERN = /^[0-9a-f]{32}$/;

export interface DirectoryLockOwner {
  readonly createdAt: number;
  readonly pid: number;
  readonly token: string;
}

export type DirectoryLockHeartbeatScheduler = (
  heartbeat: () => Promise<void>,
  heartbeatMs: number
) => () => void;

/**
 * Domain-specific stale-owner policy. Callers must choose one; the helper
 * does not default this.
 *
 * - `lease-only`: reclaim when the last heartbeat, owner timestamp, or lock
 *   mtime is older than the lease, even if the recorded PID is still alive
 *   (known Skillsets index and remote cache).
 * - `lease-and-dead-process`: reclaim only when the lease has expired and
 *   the recorded owner process is gone (change ledger).
 */
export type DirectoryLockStaleOwnerPolicy =
  | { readonly kind: "lease-and-dead-process"; readonly isProcessAlive: (pid: number) => boolean }
  | { readonly kind: "lease-only" };

export interface DirectoryLockTiming {
  readonly heartbeatMs: number;
  readonly leaseMs: number;
  readonly now: () => number;
  readonly pollMs: number;
  readonly timeoutMs: number;
}

export interface WithOwnedDirectoryLockOptions {
  readonly afterAcquired?: (() => Promise<void> | void) | undefined;
  readonly lockPath: string;
  readonly lostOwnershipError: () => Error;
  readonly onContention?: (() => Promise<void> | void) | undefined;
  readonly ownerPid: number;
  readonly staleOwner: DirectoryLockStaleOwnerPolicy;
  readonly startHeartbeat: DirectoryLockHeartbeatScheduler;
  readonly timeoutError: () => Error;
  readonly timing: DirectoryLockTiming;
}

export interface OwnedDirectoryLock {
  readonly assertOwned: () => Promise<void>;
  readonly token: string;
}

export async function withOwnedDirectoryLock<T>(
  options: WithOwnedDirectoryLockOptions,
  operation: (lock: OwnedDirectoryLock) => Promise<T>
): Promise<T> {
  const token = randomBytes(16).toString("hex");
  const owner: DirectoryLockOwner = {
    createdAt: options.timing.now(),
    pid: options.ownerPid,
    token,
  };
  const startedAt = Date.now();

  while (true) {
    let created = false;
    try {
      await mkdir(options.lockPath);
      created = true;
      await writeFile(ownerPath(options.lockPath), `${JSON.stringify(owner)}\n`, "utf8");
      await writeHeartbeat(options.lockPath, token, options.timing.now());
      break;
    } catch (error) {
      if (created) {
        await cleanupFailedCreate(options.lockPath, token, options);
        throw error;
      }
      if (!isAlreadyExistsError(error)) throw error;
      await options.onContention?.();
      if (await reclaimDeadLock(options.lockPath, options)) continue;
      if (Date.now() - startedAt > options.timing.timeoutMs) {
        throw options.timeoutError();
      }
      await Bun.sleep(options.timing.pollMs);
    }
  }

  const stopHeartbeat = startOwnedHeartbeat(options.lockPath, token, options);
  try {
    await options.afterAcquired?.();
    return await operation({
      assertOwned: async () => {
        if ((await readOwner(options.lockPath, options.timing))?.token !== token) {
          throw options.lostOwnershipError();
        }
      },
      token,
    });
  } finally {
    await stopHeartbeat();
    await removeOwnedLock(options.lockPath, token, options.timing);
  }
}

export function startDefaultDirectoryLockHeartbeat(
  heartbeat: () => Promise<void>,
  heartbeatMs: number
): () => void {
  const timer = setInterval(() => {
    void heartbeat();
  }, heartbeatMs);
  timer.unref();
  return () => clearInterval(timer);
}

function startOwnedHeartbeat(
  lockPath: string,
  token: string,
  options: WithOwnedDirectoryLockOptions
): () => Promise<void> {
  let inFlight: Promise<void> | undefined;
  const heartbeat = (): Promise<void> => {
    if (inFlight !== undefined) return inFlight;
    inFlight = (async () => {
      if ((await readOwner(lockPath, options.timing))?.token !== token) return;
      try {
        await writeHeartbeat(lockPath, token, options.timing.now());
      } catch {
        // Ownership verification before the domain mutation remains
        // authoritative when a heartbeat write races fencing or a transient
        // filesystem failure.
      }
    })().finally(() => {
      inFlight = undefined;
    });
    return inFlight;
  };
  const stop = options.startHeartbeat(heartbeat, options.timing.heartbeatMs);
  return async () => {
    stop();
    await inFlight;
  };
}

async function reclaimDeadLock(
  lockPath: string,
  options: WithOwnedDirectoryLockOptions
): Promise<boolean> {
  const owner = await readOwner(lockPath, options.timing);
  const heartbeat = owner === undefined ? undefined : await readHeartbeat(lockPath, owner.token, options.timing);
  const lock = await stat(lockPath).catch(() => undefined);
  const lastActiveAt = heartbeat ?? owner?.createdAt ?? lock?.mtimeMs;
  if (lastActiveAt === undefined || options.timing.now() - lastActiveAt <= options.timing.leaseMs) {
    return false;
  }
  if (
    options.staleOwner.kind === "lease-and-dead-process" &&
    owner !== undefined &&
    options.staleOwner.isProcessAlive(owner.pid)
  ) {
    return false;
  }
  return fenceAndRemoveLock(lockPath, owner?.token, options.timing);
}

async function cleanupFailedCreate(
  lockPath: string,
  token: string,
  options: WithOwnedDirectoryLockOptions
): Promise<void> {
  await rm(heartbeatPath(lockPath, token), { force: true });
  const currentOwner = await readOwner(lockPath, options.timing);
  if (currentOwner === undefined) {
    await fenceAndRemoveLock(lockPath, undefined, options.timing);
    return;
  }
  if (currentOwner.token === token) {
    await removeOwnedLock(lockPath, token, options.timing);
  }
}

async function removeOwnedLock(
  lockPath: string,
  token: string,
  timing: DirectoryLockTiming
): Promise<void> {
  if ((await readOwner(lockPath, timing))?.token !== token) return;
  await fenceAndRemoveLock(lockPath, token, timing);
}

async function fenceAndRemoveLock(
  lockPath: string,
  expectedToken: string | undefined,
  timing: DirectoryLockTiming
): Promise<boolean> {
  const tombstonePath = `${lockPath}.tombstone-${randomBytes(12).toString("hex")}`;
  try {
    await rename(lockPath, tombstonePath);
  } catch (error) {
    if (isMissingError(error)) return true;
    throw error;
  }
  const movedToken = (await readOwner(tombstonePath, timing))?.token;
  if (movedToken !== expectedToken) {
    try {
      await rename(tombstonePath, lockPath);
    } catch (error) {
      if (!isAlreadyExistsError(error)) throw error;
    }
    return false;
  }
  await rm(tombstonePath, { force: true, recursive: true });
  return true;
}

async function readOwner(
  lockPath: string,
  timing: DirectoryLockTiming
): Promise<DirectoryLockOwner | undefined> {
  try {
    const value = JSON.parse(await readFile(ownerPath(lockPath), "utf8")) as Partial<DirectoryLockOwner>;
    if (
      typeof value.createdAt !== "number" ||
      !isValidTimestamp(value.createdAt, timing) ||
      typeof value.pid !== "number" ||
      !Number.isSafeInteger(value.pid) ||
      value.pid <= 0 ||
      value.pid > MAX_PROCESS_ID ||
      typeof value.token !== "string" ||
      !OWNER_TOKEN_PATTERN.test(value.token)
    ) return undefined;
    return { createdAt: value.createdAt, pid: value.pid, token: value.token };
  } catch {
    return undefined;
  }
}

async function writeHeartbeat(lockPath: string, token: string, heartbeatAt: number): Promise<void> {
  await writeFile(heartbeatPath(lockPath, token), `${JSON.stringify({ heartbeatAt, token })}\n`, "utf8");
}

async function readHeartbeat(
  lockPath: string,
  token: string,
  timing: DirectoryLockTiming
): Promise<number | undefined> {
  try {
    const value = JSON.parse(await readFile(heartbeatPath(lockPath, token), "utf8")) as {
      readonly heartbeatAt?: unknown;
      readonly token?: unknown;
    };
    return value.token === token && isValidTimestamp(value.heartbeatAt, timing)
      ? value.heartbeatAt
      : undefined;
  } catch {
    return undefined;
  }
}

function isValidTimestamp(value: unknown, timing: DirectoryLockTiming): value is number {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= timing.now() + timing.leaseMs;
}

function ownerPath(lockPath: string): string {
  return join(lockPath, "owner.json");
}

function heartbeatPath(lockPath: string, token: string): string {
  return join(lockPath, `heartbeat-${token}.json`);
}

function isAlreadyExistsError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error &&
    (error.code === "EEXIST" || error.code === "ENOTEMPTY");
}

function isMissingError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
