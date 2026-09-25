import {
  startDefaultDirectoryLockHeartbeat,
  withOwnedDirectoryLock,
  type DirectoryLockHeartbeatScheduler,
} from "@skillset/core/internal/directory-lock";
import { resolveInside } from "@skillset/core/internal/path";
import { prepareRepositoryMutationPath } from "@skillset/core/internal/repository-mutation";
import { workspaceChangeFile } from "@skillset/core";

export interface ChangeLedgerLockOptions {
  /** @internal Test seam after this owner creates the lock directory. */
  readonly afterLockAcquired?: () => Promise<void>;
  readonly heartbeatMs?: number;
  readonly isProcessAlive?: (pid: number) => boolean;
  readonly leaseMs?: number;
  readonly now?: () => number;
  /** @internal Test seam when another owner already holds the lock. */
  readonly onLockContention?: () => Promise<void>;
  readonly pid?: number;
  readonly pollMs?: number;
  /** @internal Test seam for deterministically advancing an owned heartbeat. */
  readonly startHeartbeat?: DirectoryLockHeartbeatScheduler;
  readonly timeoutMs?: number;
}

const CHANGE_LEDGER_LOCK_HEARTBEAT_MS = 10_000;
const CHANGE_LEDGER_LOCK_LEASE_MS = 60_000;
const CHANGE_LEDGER_LOCK_TIMEOUT_MS = 10_000;

/**
 * Hold the owner-fenced change-ledger lock around `operation`. Every writer of
 * `.skillset/changes/*.jsonl` serializes here (ADR-0038).
 */
export async function withChangeLedgerLock<T>(
  rootPath: string,
  sourceDir: string | undefined,
  input: ChangeLedgerLockOptions | undefined,
  operation: (lock: { readonly assertOwned: () => Promise<void> }) => Promise<T>
): Promise<T> {
  const ledgerPath = workspaceChangeFile(sourceDir, "ledger.jsonl");
  const lockPath = resolveInside(rootPath, `${ledgerPath}.lock`);
  await prepareRepositoryMutationPath(rootPath, lockPath);
  const settings = changeLedgerLockSettings(input);
  return withOwnedDirectoryLock({
    afterAcquired: input?.afterLockAcquired,
    lockPath,
    lostOwnershipError: () =>
      new Error(`skillset: lost ownership of change ledger lock ${ledgerPath}.lock before append`),
    onContention: input?.onLockContention,
    ownerPid: settings.pid,
    staleOwner: {
      isProcessAlive: settings.isProcessAlive,
      kind: "lease-and-dead-process",
    },
    startHeartbeat: settings.startHeartbeat,
    timeoutError: () =>
      new Error(`skillset: timed out waiting for change ledger lock ${ledgerPath}.lock`),
    timing: {
      heartbeatMs: settings.heartbeatMs,
      leaseMs: settings.leaseMs,
      now: settings.now,
      pollMs: settings.pollMs,
      timeoutMs: settings.timeoutMs,
    },
  }, async (lock) => operation({ assertOwned: lock.assertOwned }));
}

interface ChangeLedgerLockSettings {
  readonly heartbeatMs: number;
  readonly isProcessAlive: (pid: number) => boolean;
  readonly leaseMs: number;
  readonly now: () => number;
  readonly pid: number;
  readonly pollMs: number;
  readonly startHeartbeat: DirectoryLockHeartbeatScheduler;
  readonly timeoutMs: number;
}

function changeLedgerLockSettings(input: ChangeLedgerLockOptions | undefined): ChangeLedgerLockSettings {
  return {
    heartbeatMs: input?.heartbeatMs ?? CHANGE_LEDGER_LOCK_HEARTBEAT_MS,
    isProcessAlive: input?.isProcessAlive ?? isProcessAlive,
    leaseMs: input?.leaseMs ?? CHANGE_LEDGER_LOCK_LEASE_MS,
    now: input?.now ?? Date.now,
    pid: input?.pid ?? process.pid,
    pollMs: input?.pollMs ?? 20,
    startHeartbeat: input?.startHeartbeat ?? startDefaultDirectoryLockHeartbeat,
    timeoutMs: input?.timeoutMs ?? CHANGE_LEDGER_LOCK_TIMEOUT_MS,
  };
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !(typeof error === "object" && error !== null && "code" in error && error.code === "ESRCH");
  }
}
