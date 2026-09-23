import { randomBytes } from "node:crypto";
import {
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  rmdir,
  stat,
  utimes,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";

const CLAIM_PREFIX = "claim-";
const MAX_PROCESS_ID = 2_147_483_647;
const OWNER_TOKEN_PATTERN = /^[0-9a-f]{32}$/;

export interface DirectoryLockOwner {
  readonly createdAt: number;
  readonly pid: number;
  readonly ticket: number;
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
 * - `lease-only`: reclaim when the last heartbeat, owner timestamp, or claim
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
  readonly afterStaleClaimFenced?: ((claimPath: string) => Promise<void> | void) | undefined;
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

interface DirectoryLockClaim {
  readonly path: string;
  readonly owner: DirectoryLockOwner | undefined;
  readonly mtimeMs: number | undefined;
}

interface ClaimDisposition {
  readonly contended: boolean;
  readonly entered: boolean;
}

interface LegacyDirectoryLockOwner {
  readonly createdAt: number;
  readonly pid: number;
  readonly token: string;
}

/**
 * Acquire an owner-fenced directory lock.
 *
 * Every contender owns a unique claim directory and removes only that claim.
 * Bakery tickets serialize contenders that publish concurrently. This avoids
 * renaming or deleting the shared lock root, so delayed cleanup by a former
 * owner cannot displace a successor or expose a gap for a third process.
 */
export async function withOwnedDirectoryLock<T>(
  options: WithOwnedDirectoryLockOptions,
  operation: (lock: OwnedDirectoryLock) => Promise<T>
): Promise<T> {
  const token = randomBytes(16).toString("hex");
  const claimPath = join(options.lockPath, `${CLAIM_PREFIX}${token}`);
  const startedAt = Date.now();

  await createClaimDirectory(options.lockPath, claimPath, options, startedAt);

  let owner: DirectoryLockOwner;
  try {
    owner = {
      createdAt: options.timing.now(),
      pid: options.ownerPid,
      ticket: await nextTicket(options.lockPath, options.timing),
      token,
    };
    await writeJsonAtomically(ownerPath(claimPath), owner);
    await writeHeartbeat(claimPath, token, options.timing.now());
    await touchLockRoot(options.lockPath);
  } catch (error) {
    await removeClaim(claimPath, options.lockPath);
    throw error;
  }

  const stopHeartbeat = startClaimHeartbeat(claimPath, owner, options);
  try {
    while (true) {
      const disposition = await claimDisposition(
        options.lockPath,
        claimPath,
        owner,
        options
      );
      if (disposition.contended) await options.onContention?.();
      if (disposition.entered) break;
      if (Date.now() - startedAt > options.timing.timeoutMs) {
        throw options.timeoutError();
      }
      await Bun.sleep(options.timing.pollMs);
    }

    await options.afterAcquired?.();
    return await operation({
      assertOwned: async () => {
        if (
          !(await isCurrentOwner(
            options.lockPath,
            claimPath,
            owner,
            options.timing
          ))
        ) {
          throw options.lostOwnershipError();
        }
      },
      token,
    });
  } finally {
    await stopHeartbeat();
    await removeClaim(claimPath, options.lockPath);
  }
}

async function createClaimDirectory(
  lockPath: string,
  claimPath: string,
  options: WithOwnedDirectoryLockOptions,
  startedAt: number
): Promise<void> {
  while (true) {
    let createdRoot = false;
    try {
      await mkdir(lockPath);
      createdRoot = true;
    } catch (error) {
      if (isMissingError(error)) continue;
      if (!isAlreadyExistsError(error)) throw error;
    }

    if (createdRoot || await hasClaimProtocolState(lockPath)) {
      try {
        await mkdir(claimPath);
        return;
      } catch (error) {
        // The final claimant may remove the empty root before this claim is
        // created. Re-read the layout instead of adding a claim to a legacy
        // lock that won the intervening mkdir race.
        if (isMissingError(error)) continue;
        throw error;
      }
    }

    await options.onContention?.();
    if (await reclaimLegacyLock(lockPath, options)) continue;
    if (Date.now() - startedAt > options.timing.timeoutMs) {
      throw options.timeoutError();
    }
    await Bun.sleep(options.timing.pollMs);
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

async function nextTicket(
  lockPath: string,
  timing: DirectoryLockTiming
): Promise<number> {
  const claims = await readClaims(lockPath, timing);
  const maximum = claims.reduce(
    (value, claim) => Math.max(value, claim.owner?.ticket ?? 0),
    0
  );
  if (maximum >= Number.MAX_SAFE_INTEGER) {
    throw new Error(
      `skillset: directory lock ${lockPath} exhausted its ticket space`
    );
  }
  return maximum + 1;
}

async function hasClaimProtocolState(lockPath: string): Promise<boolean> {
  try {
    return (await readdir(lockPath)).some((name) => name.startsWith(CLAIM_PREFIX));
  } catch (error) {
    if (isMissingError(error)) return false;
    throw error;
  }
}

async function reclaimLegacyLock(
  lockPath: string,
  options: WithOwnedDirectoryLockOptions
): Promise<boolean> {
  const owner = await readLegacyOwner(lockPath, options.timing);
  if (!(await isStaleLegacyLock(lockPath, owner, options))) return false;

  const fencedPath = `${lockPath}.legacy-reclaim-${randomBytes(12).toString("hex")}`;
  try {
    await rename(lockPath, fencedPath);
  } catch (error) {
    if (isMissingError(error)) return true;
    throw error;
  }

  const fencedOwner = await readLegacyOwner(fencedPath, options.timing);
  if (!(await isStaleLegacyLock(fencedPath, fencedOwner, options))) {
    try {
      await rename(fencedPath, lockPath);
    } catch (error) {
      // A successor that acquired the legacy path during fencing remains the
      // current lock. Keep the revalidated former owner fenced beside it.
      if (!isAlreadyExistsError(error)) throw error;
    }
    return false;
  }
  await rm(fencedPath, { force: true, recursive: true });
  return true;
}

async function isStaleLegacyLock(
  lockPath: string,
  owner: LegacyDirectoryLockOwner | undefined,
  options: WithOwnedDirectoryLockOptions
): Promise<boolean> {
  const heartbeat = owner === undefined
    ? undefined
    : await readHeartbeat(lockPath, owner.token, options.timing);
  const metadata = await stat(lockPath).catch(() => undefined);
  const lastActiveAt = heartbeat ?? owner?.createdAt ?? metadata?.mtimeMs;
  return isStaleOwner(lastActiveAt, owner, options);
}

async function claimDisposition(
  lockPath: string,
  claimPath: string,
  owner: DirectoryLockOwner,
  options: WithOwnedDirectoryLockOptions
): Promise<ClaimDisposition> {
  const claims = await readClaims(lockPath, options.timing);
  const ownClaim = claims.find((claim) => claim.path === claimPath);
  if (ownClaim?.owner?.token !== owner.token) {
    return { contended: true, entered: false };
  }

  let contended = false;
  for (const claim of claims) {
    if (claim.path === claimPath) continue;
    contended = true;
    if (await reclaimStaleClaim(lockPath, claim, options)) {
      continue;
    }
    // A claim without owner metadata is still choosing its ticket. Waiting for
    // it is the bakery-algorithm guard that prevents two simultaneous first
    // contenders from both observing an empty queue and entering.
    if (claim.owner === undefined || compareOwners(claim.owner, owner) < 0) {
      return { contended, entered: false };
    }
  }
  return { contended, entered: true };
}

async function isCurrentOwner(
  lockPath: string,
  claimPath: string,
  owner: DirectoryLockOwner,
  timing: DirectoryLockTiming
): Promise<boolean> {
  const claims = await readClaims(lockPath, timing);
  const ownClaim = claims.find((claim) => claim.path === claimPath);
  if (ownClaim?.owner?.token !== owner.token) return false;
  return !claims.some(
    (claim) =>
      claim.path !== claimPath &&
      claim.owner !== undefined &&
      compareOwners(claim.owner, owner) < 0
  );
}

function compareOwners(
  left: DirectoryLockOwner,
  right: DirectoryLockOwner
): number {
  if (left.ticket !== right.ticket) return left.ticket - right.ticket;
  if (left.token === right.token) return 0;
  return left.token < right.token ? -1 : 1;
}

async function isStaleClaim(
  claim: DirectoryLockClaim,
  options: WithOwnedDirectoryLockOptions
): Promise<boolean> {
  const heartbeat =
    claim.owner === undefined
      ? undefined
      : await readHeartbeat(claim.path, claim.owner.token, options.timing);
  const lastActiveAt = heartbeat ?? claim.owner?.createdAt ?? claim.mtimeMs;
  return isStaleOwner(lastActiveAt, claim.owner, options);
}

function isStaleOwner(
  lastActiveAt: number | undefined,
  owner: { readonly pid: number } | undefined,
  options: WithOwnedDirectoryLockOptions
): boolean {
  if (lastActiveAt === undefined || options.timing.now() - lastActiveAt <= options.timing.leaseMs) {
    return false;
  }
  return options.staleOwner.kind !== "lease-and-dead-process" ||
    owner === undefined ||
    !options.staleOwner.isProcessAlive(owner.pid);
}

async function reclaimStaleClaim(
  lockPath: string,
  claim: DirectoryLockClaim,
  options: WithOwnedDirectoryLockOptions
): Promise<boolean> {
  if (!(await isStaleClaim(claim, options))) return false;
  const fencedPath = join(
    lockPath,
    `.claim-reclaim-${randomBytes(12).toString("hex")}`
  );
  try {
    await rename(claim.path, fencedPath);
  } catch (error) {
    if (isMissingError(error)) return true;
    throw error;
  }

  await options.afterStaleClaimFenced?.(fencedPath);
  const fencedClaim = await readClaim(
    fencedPath,
    options.timing,
    claim.owner?.token ?? claimTokenFromPath(claim.path)
  );
  if (!(await isStaleClaim(fencedClaim, options))) {
    await rename(fencedPath, claim.path);
    return false;
  }
  await rm(fencedPath, { force: true, recursive: true });
  return true;
}

function startClaimHeartbeat(
  claimPath: string,
  owner: DirectoryLockOwner,
  options: WithOwnedDirectoryLockOptions
): () => Promise<void> {
  let inFlight: Promise<void> | undefined;
  const heartbeat = (): Promise<void> => {
    if (inFlight !== undefined) return inFlight;
    inFlight = (async () => {
      if ((await readOwner(claimPath, options.timing))?.token !== owner.token) {
        return;
      }
      try {
        await writeHeartbeat(claimPath, owner.token, options.timing.now());
        await touchLockRoot(options.lockPath);
      } catch {
        // Ownership verification before the domain mutation remains
        // authoritative when a heartbeat write races stale-claim removal or a
        // transient filesystem failure.
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

async function readClaims(
  lockPath: string,
  timing: DirectoryLockTiming
): Promise<readonly DirectoryLockClaim[]> {
  let names: readonly string[];
  try {
    names = await readdir(lockPath);
  } catch (error) {
    if (isMissingError(error)) return [];
    throw error;
  }
  const claims = names
    .filter((name) => name.startsWith(CLAIM_PREFIX))
    .map((name) => readClaim(join(lockPath, name), timing));
  return Promise.all(claims);
}

async function readClaim(
  claimPath: string,
  timing: DirectoryLockTiming,
  expectedToken?: string
): Promise<DirectoryLockClaim> {
  const [owner, metadata] = await Promise.all([
    readOwner(claimPath, timing, expectedToken),
    stat(claimPath).catch(() => undefined),
  ]);
  return { mtimeMs: metadata?.mtimeMs, owner, path: claimPath };
}

async function removeClaim(claimPath: string, lockPath: string): Promise<void> {
  await rm(claimPath, { force: true, recursive: true });
  // Removing an empty root is safe: a concurrently created claim makes rmdir
  // fail with ENOTEMPTY, and no operation ever removes a claim it does not own.
  await rmdir(lockPath).catch(() => {});
}

async function readOwner(
  claimPath: string,
  timing: DirectoryLockTiming,
  expectedToken?: string
): Promise<DirectoryLockOwner | undefined> {
  try {
    const value = JSON.parse(
      await readFile(ownerPath(claimPath), "utf8")
    ) as Partial<DirectoryLockOwner>;
    if (
      typeof value.createdAt !== "number" ||
      !isValidTimestamp(value.createdAt, timing) ||
      typeof value.pid !== "number" ||
      !Number.isSafeInteger(value.pid) ||
      value.pid <= 0 ||
      value.pid > MAX_PROCESS_ID ||
      typeof value.ticket !== "number" ||
      !Number.isSafeInteger(value.ticket) ||
      value.ticket <= 0 ||
      typeof value.token !== "string" ||
      !OWNER_TOKEN_PATTERN.test(value.token) ||
      (expectedToken === undefined
        ? claimPath.split(/[/\\]/u).at(-1) !== `${CLAIM_PREFIX}${value.token}`
        : value.token !== expectedToken)
    ) {
      return undefined;
    }
    return {
      createdAt: value.createdAt,
      pid: value.pid,
      ticket: value.ticket,
      token: value.token,
    };
  } catch {
    return undefined;
  }
}

async function readLegacyOwner(
  lockPath: string,
  timing: DirectoryLockTiming
): Promise<LegacyDirectoryLockOwner | undefined> {
  try {
    const value = JSON.parse(
      await readFile(ownerPath(lockPath), "utf8")
    ) as Partial<LegacyDirectoryLockOwner>;
    if (
      typeof value.createdAt !== "number" ||
      !isValidTimestamp(value.createdAt, timing) ||
      typeof value.pid !== "number" ||
      !Number.isSafeInteger(value.pid) ||
      value.pid <= 0 ||
      value.pid > MAX_PROCESS_ID ||
      typeof value.token !== "string" ||
      !OWNER_TOKEN_PATTERN.test(value.token)
    ) {
      return undefined;
    }
    return { createdAt: value.createdAt, pid: value.pid, token: value.token };
  } catch {
    return undefined;
  }
}

async function writeHeartbeat(
  claimPath: string,
  token: string,
  heartbeatAt: number
): Promise<void> {
  await writeJsonAtomically(heartbeatPath(claimPath, token), { heartbeatAt, token });
}

async function writeJsonAtomically(path: string, value: unknown): Promise<void> {
  const temporaryPath = `${path}.tmp-${randomBytes(12).toString("hex")}`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(value)}\n`, "utf8");
    await rename(temporaryPath, path);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

async function touchLockRoot(lockPath: string): Promise<void> {
  const now = new Date();
  await utimes(lockPath, now, now);
}

async function readHeartbeat(
  claimPath: string,
  token: string,
  timing: DirectoryLockTiming
): Promise<number | undefined> {
  try {
    const value = JSON.parse(
      await readFile(heartbeatPath(claimPath, token), "utf8")
    ) as {
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

function ownerPath(claimPath: string): string {
  return join(claimPath, "owner.json");
}

function heartbeatPath(claimPath: string, token: string): string {
  return join(claimPath, `heartbeat-${token}.json`);
}

function claimTokenFromPath(claimPath: string): string | undefined {
  const name = claimPath.split(/[/\\]/u).at(-1);
  const token = name?.startsWith(CLAIM_PREFIX)
    ? name.slice(CLAIM_PREFIX.length)
    : undefined;
  return token !== undefined && OWNER_TOKEN_PATTERN.test(token) ? token : undefined;
}

function isMissingError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function isAlreadyExistsError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error &&
    (error.code === "EEXIST" || error.code === "ENOTEMPTY");
}
