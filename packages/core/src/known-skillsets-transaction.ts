import { randomBytes } from "node:crypto";
import { constants } from "node:fs";
import { copyFile, mkdir, open } from "node:fs/promises";
import { dirname, join } from "node:path";

import {
  type AtomicFilePublicationTestHooks,
  publishAtomicFile,
} from "./atomic-file-publication";
import {
  type DirectoryLockHeartbeatScheduler,
  startDefaultDirectoryLockHeartbeat,
  withOwnedDirectoryLock,
} from "./directory-lock";

const LOCK_HEARTBEAT_MS = 5_000;
const LOCK_LEASE_MS = 30_000;
const LOCK_POLL_MS = 20;
const LOCK_TIMEOUT_MS = 30_000;

interface KnownSkillsetsLockSettings {
  readonly heartbeatMs: number;
  readonly leaseMs: number;
  readonly now: () => number;
  readonly pid: number;
  readonly pollMs: number;
  readonly startHeartbeat: KnownSkillsetsHeartbeatScheduler;
  readonly timeoutMs: number;
}

type KnownSkillsetsHeartbeatScheduler = DirectoryLockHeartbeatScheduler;

export interface KnownSkillsetsTransactionTestOptions extends AtomicFilePublicationTestHooks {
  readonly afterLockAcquired?: () => Promise<void> | void;
  readonly heartbeatMs?: number;
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
  return withOwnedDirectoryLock(
    {
      afterAcquired: testOptions.afterLockAcquired,
      lockPath,
      lostOwnershipError: () =>
        new Error("skillset: lost ownership of known Skillsets index lock"),
      onContention: testOptions.onLockContention,
      ownerPid: settings.pid,
      staleOwner: { kind: "lease-only" },
      startHeartbeat: settings.startHeartbeat,
      timeoutError: () =>
        new Error("skillset: timed out waiting for known Skillsets index lock"),
      timing: {
        heartbeatMs: settings.heartbeatMs,
        leaseMs: settings.leaseMs,
        now: settings.now,
        pollMs: settings.pollMs,
        timeoutMs: settings.timeoutMs,
      },
    },
    async (lock) =>
      operation({
        assertOwned: lock.assertOwned,
        indexPath,
        publish: async (content) => {
          await publishAtomicFile(indexPath, content, {
            beforeRename: lock.assertOwned,
            mode: 0o600,
            testHooks: testOptions,
          });
        },
        quarantine: async () => quarantineIndex(indexPath, lock.assertOwned),
      })
  );
}

async function quarantineIndex(indexPath: string, assertOwned: () => Promise<void>): Promise<string> {
  await assertOwned();
  const timestamp = new Date().toISOString().replaceAll(/[-:.]/g, "");
  const backupPath = join(
    dirname(indexPath),
    `skillsets.corrupt-${timestamp}-${randomBytes(8).toString("hex")}.json`
  );
  await copyFile(indexPath, backupPath, constants.COPYFILE_EXCL);
  const backup = await open(backupPath, "r");
  try {
    await backup.sync();
  } finally {
    await backup.close();
  }
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
    leaseMs: input.leaseMs ?? LOCK_LEASE_MS,
    now: input.now ?? Date.now,
    pid: input.pid ?? process.pid,
    pollMs: input.pollMs ?? LOCK_POLL_MS,
    startHeartbeat: input.startHeartbeat ?? startDefaultDirectoryLockHeartbeat,
    timeoutMs: input.timeoutMs ?? LOCK_TIMEOUT_MS,
  };
}

function isUnsupportedDirectorySyncError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error &&
    (error.code === "EISDIR" || error.code === "EINVAL" || error.code === "EPERM");
}
