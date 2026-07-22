import { randomBytes } from "node:crypto";
import { mkdir, open, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

const LOCK_HEARTBEAT_MS = 5_000;
const LOCK_LEASE_MS = 30_000;
const LOCK_POLL_MS = 20;
const LOCK_TIMEOUT_MS = 30_000;
const MAX_PROCESS_ID = 2_147_483_647;
const OWNER_TOKEN_PATTERN = /^[a-f0-9]{32}$/;

interface KnownSkillsetsLockOwner {
  readonly createdAt: number;
  readonly pid: number;
  readonly token: string;
}

interface KnownSkillsetsLockSettings {
  readonly heartbeatMs: number;
  readonly isProcessAlive: (pid: number) => boolean;
  readonly leaseMs: number;
  readonly now: () => number;
  readonly pid: number;
  readonly pollMs: number;
  readonly startHeartbeat: KnownSkillsetsHeartbeatScheduler;
  readonly timeoutMs: number;
}

type KnownSkillsetsHeartbeatScheduler = (
  heartbeat: () => Promise<void>,
  heartbeatMs: number
) => () => void;

export interface KnownSkillsetsTransactionTestOptions {
  readonly afterLockAcquired?: () => Promise<void> | void;
  readonly beforePublish?: () => Promise<void> | void;
  readonly beforeTemporarySync?: () => Promise<void> | void;
  readonly beforeTemporaryWrite?: () => Promise<void> | void;
  readonly heartbeatMs?: number;
  readonly isProcessAlive?: (pid: number) => boolean;
  readonly leaseMs?: number;
  readonly now?: () => number;
  readonly onLockContention?: () => Promise<void> | void;
  readonly pid?: number;
  readonly pollMs?: number;
  readonly startHeartbeat?: KnownSkillsetsHeartbeatScheduler;
  readonly timeoutMs?: number;
}

export interface KnownSkillsetsTransaction {
  readonly assertOwned: () => Promise<void>;
  readonly indexPath: string;
  readonly publish: (content: string) => Promise<void>;
  readonly quarantine: () => Promise<string>;
}

export async function withKnownSkillsetsTransaction<T>(
  indexPath: string,
  operation: (transaction: KnownSkillsetsTransaction) => Promise<T>,
  testOptions: KnownSkillsetsTransactionTestOptions = {}
): Promise<T> {
  const lockPath = `${indexPath}.lock`;
  await mkdir(dirname(indexPath), { recursive: true });
  const settings = lockSettings(testOptions);
  const token = randomBytes(16).toString("hex");
  const owner: KnownSkillsetsLockOwner = { createdAt: settings.now(), pid: settings.pid, token };
  const startedAt = Date.now();

  while (true) {
    let created = false;
    try {
      await mkdir(lockPath);
      created = true;
      await writeFile(ownerPath(lockPath), `${JSON.stringify(owner)}\n`, "utf8");
      await writeHeartbeat(lockPath, token, settings.now());
      break;
    } catch (error) {
      if (created) {
        const currentOwner = await readOwner(lockPath, settings);
        await fenceAndRemoveLock(lockPath, currentOwner?.token, settings);
        throw error;
      }
      if (!isAlreadyExistsError(error)) throw error;
      await testOptions.onLockContention?.();
      if (await reclaimDeadLock(lockPath, settings)) continue;
      if (Date.now() - startedAt > settings.timeoutMs) {
        throw new Error("skillset: timed out waiting for known Skillsets index lock");
      }
      await Bun.sleep(settings.pollMs);
    }
  }

  const stopHeartbeat = startHeartbeat(lockPath, token, settings);
  const assertOwned = async (): Promise<void> => {
    if ((await readOwner(lockPath, settings))?.token !== token) {
      throw new Error("skillset: lost ownership of known Skillsets index lock");
    }
  };
  try {
    await testOptions.afterLockAcquired?.();
    return await operation({
      assertOwned,
      indexPath,
      publish: async (content) => {
        await publishAtomically(indexPath, content, assertOwned, testOptions);
      },
      quarantine: async () => quarantineIndex(indexPath, assertOwned),
    });
  } finally {
    await stopHeartbeat();
    await removeOwnedLock(lockPath, token, settings);
  }
}

async function publishAtomically(
  indexPath: string,
  content: string,
  assertOwned: () => Promise<void>,
  testOptions: KnownSkillsetsTransactionTestOptions
): Promise<void> {
  const temporaryPath = join(dirname(indexPath), `.${basename(indexPath)}.tmp-${randomBytes(16).toString("hex")}`);
  try {
    const file = await open(temporaryPath, "wx", 0o600);
    try {
      await testOptions.beforeTemporaryWrite?.();
      await file.writeFile(content, "utf8");
      await testOptions.beforeTemporarySync?.();
      await file.sync();
    } finally {
      await file.close();
    }
    await testOptions.beforePublish?.();
    await assertOwned();
    await rename(temporaryPath, indexPath);
    await syncDirectory(dirname(indexPath));
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

async function quarantineIndex(indexPath: string, assertOwned: () => Promise<void>): Promise<string> {
  await assertOwned();
  const timestamp = new Date().toISOString().replaceAll(/[-:.]/g, "");
  const backupPath = join(
    dirname(indexPath),
    `skillsets.corrupt-${timestamp}-${randomBytes(8).toString("hex")}.json`
  );
  await rename(indexPath, backupPath);
  await syncDirectory(dirname(indexPath));
  return backupPath;
}

async function syncDirectory(path: string): Promise<void> {
  let directory;
  try {
    directory = await open(path, "r");
    await directory.sync();
  } catch (error) {
    if (!isUnsupportedDirectorySyncError(error)) throw error;
  } finally {
    await directory?.close();
  }
}

function lockSettings(input: KnownSkillsetsTransactionTestOptions): KnownSkillsetsLockSettings {
  return {
    heartbeatMs: input.heartbeatMs ?? LOCK_HEARTBEAT_MS,
    isProcessAlive: input.isProcessAlive ?? isProcessAlive,
    leaseMs: input.leaseMs ?? LOCK_LEASE_MS,
    now: input.now ?? Date.now,
    pid: input.pid ?? process.pid,
    pollMs: input.pollMs ?? LOCK_POLL_MS,
    startHeartbeat: input.startHeartbeat ?? startDefaultHeartbeat,
    timeoutMs: input.timeoutMs ?? LOCK_TIMEOUT_MS,
  };
}

function startHeartbeat(
  lockPath: string,
  token: string,
  settings: KnownSkillsetsLockSettings
): () => Promise<void> {
  let inFlight: Promise<void> | undefined;
  const heartbeat = (): Promise<void> => {
    if (inFlight !== undefined) return inFlight;
    inFlight = (async () => {
      if ((await readOwner(lockPath, settings))?.token !== token) return;
      await writeHeartbeat(lockPath, token, settings.now()).catch(() => undefined);
    })().finally(() => {
      inFlight = undefined;
    });
    return inFlight;
  };
  const stop = settings.startHeartbeat(heartbeat, settings.heartbeatMs);
  return async () => {
    stop();
    await inFlight;
  };
}

function startDefaultHeartbeat(heartbeat: () => Promise<void>, heartbeatMs: number): () => void {
  const timer = setInterval(() => {
    void heartbeat();
  }, heartbeatMs);
  timer.unref();
  return () => clearInterval(timer);
}

async function reclaimDeadLock(lockPath: string, settings: KnownSkillsetsLockSettings): Promise<boolean> {
  const owner = await readOwner(lockPath, settings);
  const heartbeat = owner === undefined ? undefined : await readHeartbeat(lockPath, owner.token, settings);
  const lock = await stat(lockPath).catch(() => undefined);
  const lastActiveAt = heartbeat ?? owner?.createdAt ?? lock?.mtimeMs;
  if (lastActiveAt === undefined || settings.now() - lastActiveAt <= settings.leaseMs) return false;
  if (owner !== undefined && settings.isProcessAlive(owner.pid)) return false;
  return fenceAndRemoveLock(lockPath, owner?.token, settings);
}

async function removeOwnedLock(
  lockPath: string,
  token: string,
  settings: KnownSkillsetsLockSettings
): Promise<void> {
  if ((await readOwner(lockPath, settings))?.token !== token) return;
  await fenceAndRemoveLock(lockPath, token, settings);
}

async function fenceAndRemoveLock(
  lockPath: string,
  expectedToken: string | undefined,
  settings: KnownSkillsetsLockSettings
): Promise<boolean> {
  const tombstonePath = `${lockPath}.tombstone-${randomBytes(12).toString("hex")}`;
  try {
    await rename(lockPath, tombstonePath);
  } catch (error) {
    if (isMissingError(error)) return true;
    throw error;
  }
  const movedToken = (await readOwner(tombstonePath, settings))?.token;
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
  settings: KnownSkillsetsLockSettings
): Promise<KnownSkillsetsLockOwner | undefined> {
  try {
    const value = JSON.parse(await readFile(ownerPath(lockPath), "utf8")) as Partial<KnownSkillsetsLockOwner>;
    if (
      typeof value.createdAt !== "number" ||
      !isValidTimestamp(value.createdAt, settings) ||
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
  settings: KnownSkillsetsLockSettings
): Promise<number | undefined> {
  try {
    const value = JSON.parse(await readFile(heartbeatPath(lockPath, token), "utf8")) as {
      readonly heartbeatAt?: unknown;
      readonly token?: unknown;
    };
    return value.token === token && isValidTimestamp(value.heartbeatAt, settings)
      ? value.heartbeatAt
      : undefined;
  } catch {
    return undefined;
  }
}

function isValidTimestamp(value: unknown, settings: KnownSkillsetsLockSettings): value is number {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= settings.now() + settings.leaseMs;
}

function ownerPath(lockPath: string): string {
  return join(lockPath, "owner.json");
}

function heartbeatPath(lockPath: string, token: string): string {
  return join(lockPath, `heartbeat-${token}.json`);
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !(typeof error === "object" && error !== null && "code" in error && error.code === "ESRCH");
  }
}

function isAlreadyExistsError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error &&
    (error.code === "EEXIST" || error.code === "ENOTEMPTY");
}

function isMissingError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function isUnsupportedDirectorySyncError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error &&
    (error.code === "EISDIR" || error.code === "EINVAL" || error.code === "EPERM");
}
