import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";

import { readChangeLedger, type ChangeLedgerEventType } from "@skillset/core/internal/change-ledger";
import {
  startDefaultDirectoryLockHeartbeat,
  withOwnedDirectoryLock,
  type DirectoryLockHeartbeatScheduler,
} from "@skillset/core/internal/directory-lock";
import { compareStrings, resolveInside } from "@skillset/core/internal/path";
import {
  sourceUnitDisplay,
  sourceUnitSelector,
} from "@skillset/core/internal/source-unit-selector";
import type { JsonRecord } from "@skillset/core/internal/types";
import { workspaceChangeFile } from "@skillset/core";

import { changeCheck, resolvePendingChangeRef, uncoveredSourceChanges } from "./change-entries";
import { detectWorkspaceOptions, SOURCE_HASH_SCHEMA, type ChangeStatusOptions } from "./change-status";

export interface ChangeRefreshOptions extends ChangeStatusOptions {
  /** @internal Test seam for a source edit between the initial and final plans. */
  readonly beforeFinalComparison?: () => Promise<void>;
  /** @internal Test seam for fencing immediately before the append ownership check. */
  readonly beforeOwnershipVerification?: () => Promise<void>;
  /** @internal Deterministic timing and liveness controls for lock regressions. */
  readonly lock?: ChangeLedgerLockOptions;
  readonly ref?: string;
  readonly write: boolean;
}

export interface ChangeLedgerLockOptions {
  readonly heartbeatMs?: number;
  readonly isProcessAlive?: (pid: number) => boolean;
  readonly leaseMs?: number;
  readonly now?: () => number;
  readonly pid?: number;
  readonly pollMs?: number;
  /** @internal Test seam for deterministically advancing an owned heartbeat. */
  readonly startHeartbeat?: DirectoryLockHeartbeatScheduler;
  readonly timeoutMs?: number;
}

export interface ChangeRefreshScope {
  readonly currentHash: string;
  readonly priorHashes: readonly string[];
  readonly scope: string;
}

export interface ChangeRefreshEntry {
  readonly path: string;
  readonly ref: string;
  readonly scopes: readonly ChangeRefreshScope[];
}

export interface ChangeRefreshReport {
  readonly entries: readonly ChangeRefreshEntry[];
  readonly ledgerPath: string;
  readonly written: boolean;
}

type LedgerEvent = {
  readonly payload: JsonRecord;
  readonly type: ChangeLedgerEventType;
};

type AppendLedgerEvents = (
  rootPath: string,
  sourceDir: string | undefined,
  events: readonly LedgerEvent[]
) => Promise<void>;

const REFRESHABLE_EVIDENCE_CODES = new Set(["change-evidence-missing", "change-evidence-stale"]);
const CHANGE_LEDGER_LOCK_HEARTBEAT_MS = 10_000;
const CHANGE_LEDGER_LOCK_LEASE_MS = 60_000;
const CHANGE_LEDGER_LOCK_TIMEOUT_MS = 10_000;

export async function refreshChangeEvidenceWithAppend(
  rootPath: string,
  options: ChangeRefreshOptions,
  appendLedgerEvents: AppendLedgerEvents
): Promise<ChangeRefreshReport> {
  const storageOptions = await detectWorkspaceOptions(rootPath, options);
  if (!options.write) return planChangeEvidenceRefresh(rootPath, storageOptions, options.ref);

  return withChangeLedgerLock(rootPath, storageOptions.sourceDir, options.lock, async (lock) => {
    let beforeFinalComparison = options.beforeFinalComparison;
    let beforeOwnershipVerification = options.beforeOwnershipVerification;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const planned = await planChangeEvidenceRefresh(rootPath, storageOptions, options.ref);
      if (planned.entries.length === 0) return planned;
      await beforeFinalComparison?.();
      beforeFinalComparison = undefined;
      const confirmed = await planChangeEvidenceRefresh(rootPath, storageOptions, options.ref);
      if (refreshPlanKey(planned) !== refreshPlanKey(confirmed)) continue;
      await lock.assertOwned();
      await beforeOwnershipVerification?.();
      beforeOwnershipVerification = undefined;
      const fresh = await planChangeEvidenceRefresh(rootPath, storageOptions, options.ref);
      if (refreshPlanKey(confirmed) !== refreshPlanKey(fresh)) continue;
      await lock.assertOwned();
      await appendLedgerEvents(rootPath, storageOptions.sourceDir, refreshLedgerEvents(fresh.entries));
      return { ...fresh, written: true };
    }
    throw new Error("skillset: source or pending change evidence kept changing while change refresh was applying; retry the command");
  });
}

async function planChangeEvidenceRefresh(
  rootPath: string,
  storageOptions: ChangeStatusOptions,
  ref: string | undefined
): Promise<ChangeRefreshReport> {
  const report = await changeCheck(rootPath, ref === undefined ? storageOptions : { ...storageOptions, ref });
  const selected = ref === undefined ? report.entries : [resolvePendingChangeRef(report.entries, ref)];
  const selectedPaths = new Set(selected.map((entry) => entry.path));
  const blocking = report.issues.filter((issue) => {
    if (issue.severity !== "error" || issue.code === "change-uncovered") return false;
    return issue.path === undefined || (selectedPaths.has(issue.path) && !REFRESHABLE_EVIDENCE_CODES.has(issue.code));
  });
  for (const entry of selected) {
    if (entry.format !== "frontmatter") continue;
    blocking.push({
      code: "change-frontmatter-compatibility",
      message: "frontmatter pending entries must be migrated before evidence can be refreshed",
      path: entry.path,
      severity: "error",
    });
  }
  if (ref === undefined) {
    const scopes = selected
      .filter((entry) => !blocking.some((issue) => issue.path === entry.path))
      .flatMap((entry) => entry.scopes);
    const events = await readChangeLedger(rootPath, storageOptions);
    for (const change of uncoveredSourceChanges(report.status.sourceChanges, scopes, events)) {
      blocking.push({
        code: "change-uncovered",
        message: `source change ${sourceUnitDisplay(change.id)} is missing an otherwise-valid pending change entry`,
        severity: "error",
      });
    }
  }
  if (blocking.length > 0) {
    const details = blocking
      .toSorted((left, right) => compareStrings(`${left.path ?? ""}\0${left.code}`, `${right.path ?? ""}\0${right.code}`))
      .map((issue) => `${issue.path ?? "workspace"}: [${issue.code}] ${issue.message}`);
    throw new Error(`skillset: cannot refresh non-validating pending change evidence\n${details.join("\n")}`);
  }

  const currentById = new Map(report.status.sourceUnits.map((unit) => [unit.id, unit.hash]));
  const changedById = new Map(report.status.sourceChanges.map((change) => [change.id, change]));
  const entries: ChangeRefreshEntry[] = [];
  for (const entry of selected.toSorted((left, right) => compareStrings(left.path, right.path))) {
    if (entry.id === undefined) continue;
    const scopes: ChangeRefreshScope[] = [];
    for (const scope of entry.scopes.map(sourceUnitSelector).toSorted(compareStrings)) {
      const change = changedById.get(scope);
      const currentHash = change?.currentHash ?? change?.baselineHash ?? currentById.get(scope);
      if (currentHash === undefined || (entry.sourceHashes.get(scope) ?? []).includes(currentHash)) continue;
      scopes.push({ currentHash, priorHashes: [...(entry.sourceHashes.get(scope) ?? [])].toSorted(compareStrings), scope });
    }
    if (scopes.length === 0) continue;
    entries.push({ path: entry.path, ref: `@${entry.id}`, scopes });
  }
  return {
    entries,
    ledgerPath: workspaceChangeFile(storageOptions.sourceDir, "ledger.jsonl"),
    written: false,
  };
}

function refreshLedgerEvents(entries: readonly ChangeRefreshEntry[]): readonly LedgerEvent[] {
  return entries.map((entry) => ({
    payload: {
      reasonId: entry.ref.slice(1),
      sourceUnits: entry.scopes.map((scope) => ({
        hashSchema: SOURCE_HASH_SCHEMA,
        selector: scope.scope,
        sourceHash: scope.currentHash,
      })),
    },
    type: "change.covered",
  }));
}

function refreshPlanKey(report: ChangeRefreshReport): string {
  return JSON.stringify(report.entries);
}

export async function withChangeLedgerLock<T>(
  rootPath: string,
  sourceDir: string | undefined,
  input: ChangeLedgerLockOptions | undefined,
  operation: (lock: { readonly assertOwned: () => Promise<void> }) => Promise<T>
): Promise<T> {
  const ledgerPath = workspaceChangeFile(sourceDir, "ledger.jsonl");
  const lockPath = resolveInside(rootPath, `${ledgerPath}.lock`);
  await mkdir(dirname(lockPath), { recursive: true });
  const settings = changeLedgerLockSettings(input);
  return withOwnedDirectoryLock({
    lockPath,
    lostOwnershipError: () =>
      new Error(`skillset: lost ownership of change ledger lock ${ledgerPath}.lock before append`),
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
