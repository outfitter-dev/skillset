import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { ChangeLedgerEventType } from "@skillset/core/internal/change-ledger";
import { compareStrings, resolveInside } from "@skillset/core/internal/path";
import {
  pluginScopeFromSourceUnit,
  sourceUnitDisplay,
  sourceUnitSelector,
} from "@skillset/core/internal/source-unit-selector";
import type { JsonRecord } from "@skillset/core/internal/types";
import { workspaceChangeFile } from "@skillset/core";

import { changeCheck, resolvePendingChangeRef } from "./change-entries";
import { detectWorkspaceOptions, type ChangeStatusOptions } from "./change-status";

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
  readonly startHeartbeat?: ChangeLedgerHeartbeatScheduler;
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
const MAX_PROCESS_ID = 2_147_483_647;
const OWNER_TOKEN_PATTERN = /^[0-9a-f]{32}$/;

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
    const covered = new Set<string>();
    for (const entry of selected) {
      if (blocking.some((issue) => issue.path === entry.path)) continue;
      for (const scope of entry.scopes) {
        covered.add(scope);
        const pluginScope = pluginScopeFromSourceUnit(scope);
        if (pluginScope !== undefined) covered.add(pluginScope);
      }
    }
    for (const change of report.status.sourceChanges) {
      if (covered.has(change.id)) continue;
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
        hashSchema: "skillset-source-unit-v2",
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

async function withChangeLedgerLock<T>(
  rootPath: string,
  sourceDir: string | undefined,
  input: ChangeLedgerLockOptions | undefined,
  operation: (lock: { readonly assertOwned: () => Promise<void> }) => Promise<T>
): Promise<T> {
  const ledgerPath = workspaceChangeFile(sourceDir, "ledger.jsonl");
  const lockPath = resolveInside(rootPath, `${ledgerPath}.lock`);
  await mkdir(dirname(lockPath), { recursive: true });
  const settings = changeLedgerLockSettings(input);
  const token = randomBytes(16).toString("hex");
  const owner: ChangeLedgerLockOwner = { createdAt: settings.now(), pid: settings.pid, token };
  const startedAt = Date.now();
  while (true) {
    let created = false;
    try {
      await mkdir(lockPath);
      created = true;
      await writeFile(changeLedgerLockOwnerPath(lockPath), `${JSON.stringify(owner)}\n`, "utf8");
      await writeChangeLedgerHeartbeat(lockPath, token, settings.now());
      break;
    } catch (error) {
      if (created) {
        await rm(changeLedgerHeartbeatPath(lockPath, token), { force: true });
        const currentOwner = await readChangeLedgerLockOwner(lockPath, settings);
        if (currentOwner === undefined) await fenceAndRemoveChangeLedgerLock(lockPath, undefined, settings);
        else if (currentOwner.token === token) await removeOwnedChangeLedgerLock(lockPath, token, settings);
        throw error;
      }
      if (!isAlreadyExistsError(error)) throw error;
      if (await reclaimDeadChangeLedgerLock(lockPath, settings)) continue;
      if (Date.now() - startedAt > settings.timeoutMs) {
        throw new Error(`skillset: timed out waiting for change ledger lock ${ledgerPath}.lock`);
      }
      await Bun.sleep(settings.pollMs);
    }
  }
  const stopHeartbeat = startChangeLedgerHeartbeat(lockPath, token, settings);
  try {
    return await operation({
      assertOwned: async () => {
        if ((await readChangeLedgerLockOwner(lockPath, settings))?.token !== token) {
          throw new Error(`skillset: lost ownership of change ledger lock ${ledgerPath}.lock before append`);
        }
      },
    });
  } finally {
    await stopHeartbeat();
    await removeOwnedChangeLedgerLock(lockPath, token, settings);
  }
}

interface ChangeLedgerLockOwner {
  readonly createdAt: number;
  readonly pid: number;
  readonly token: string;
}

interface ChangeLedgerLockSettings {
  readonly heartbeatMs: number;
  readonly isProcessAlive: (pid: number) => boolean;
  readonly leaseMs: number;
  readonly now: () => number;
  readonly pid: number;
  readonly pollMs: number;
  readonly startHeartbeat: ChangeLedgerHeartbeatScheduler;
  readonly timeoutMs: number;
}

type ChangeLedgerHeartbeatScheduler = (
  heartbeat: () => Promise<void>,
  heartbeatMs: number
) => () => void;

function changeLedgerLockSettings(input: ChangeLedgerLockOptions | undefined): ChangeLedgerLockSettings {
  return {
    heartbeatMs: input?.heartbeatMs ?? CHANGE_LEDGER_LOCK_HEARTBEAT_MS,
    isProcessAlive: input?.isProcessAlive ?? isProcessAlive,
    leaseMs: input?.leaseMs ?? CHANGE_LEDGER_LOCK_LEASE_MS,
    now: input?.now ?? Date.now,
    pid: input?.pid ?? process.pid,
    pollMs: input?.pollMs ?? 20,
    startHeartbeat: input?.startHeartbeat ?? startDefaultChangeLedgerHeartbeat,
    timeoutMs: input?.timeoutMs ?? CHANGE_LEDGER_LOCK_TIMEOUT_MS,
  };
}

function startChangeLedgerHeartbeat(
  lockPath: string,
  token: string,
  settings: ChangeLedgerLockSettings
): () => Promise<void> {
  let inFlight: Promise<void> | undefined;
  const heartbeat = (): Promise<void> => {
    if (inFlight !== undefined) return inFlight;
    inFlight = (async () => {
      if ((await readChangeLedgerLockOwner(lockPath, settings))?.token !== token) return;
      try {
        await writeChangeLedgerHeartbeat(lockPath, token, settings.now());
      } catch {
        // Ownership verification before append remains authoritative when a
        // heartbeat write races fencing or a transient filesystem failure.
      }
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

function startDefaultChangeLedgerHeartbeat(
  heartbeat: () => Promise<void>,
  heartbeatMs: number
): () => void {
  const timer = setInterval(() => {
    void heartbeat();
  }, heartbeatMs);
  timer.unref();
  return () => clearInterval(timer);
}

async function reclaimDeadChangeLedgerLock(
  lockPath: string,
  settings: ChangeLedgerLockSettings
): Promise<boolean> {
  const owner = await readChangeLedgerLockOwner(lockPath, settings);
  const heartbeat = owner === undefined ? undefined : await readChangeLedgerHeartbeat(lockPath, owner.token, settings);
  const lock = await stat(lockPath).catch(() => undefined);
  const lastActiveAt = heartbeat ?? owner?.createdAt ?? lock?.mtimeMs;
  if (lastActiveAt === undefined || settings.now() - lastActiveAt <= settings.leaseMs) return false;
  if (owner !== undefined && settings.isProcessAlive(owner.pid)) return false;
  return fenceAndRemoveChangeLedgerLock(lockPath, owner?.token, settings);
}

async function removeOwnedChangeLedgerLock(
  lockPath: string,
  token: string,
  settings: ChangeLedgerLockSettings
): Promise<void> {
  if ((await readChangeLedgerLockOwner(lockPath, settings))?.token !== token) return;
  await fenceAndRemoveChangeLedgerLock(lockPath, token, settings);
}

async function fenceAndRemoveChangeLedgerLock(
  lockPath: string,
  expectedToken: string | undefined,
  settings: ChangeLedgerLockSettings
): Promise<boolean> {
  const tombstonePath = `${lockPath}.tombstone-${randomBytes(12).toString("hex")}`;
  try {
    await rename(lockPath, tombstonePath);
  } catch (error) {
    if (isMissingError(error)) return true;
    throw error;
  }
  const movedToken = (await readChangeLedgerLockOwner(tombstonePath, settings))?.token;
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

async function readChangeLedgerLockOwner(
  lockPath: string,
  settings: ChangeLedgerLockSettings
): Promise<ChangeLedgerLockOwner | undefined> {
  try {
    const value = JSON.parse(await readFile(changeLedgerLockOwnerPath(lockPath), "utf8")) as Partial<ChangeLedgerLockOwner>;
    if (
      typeof value.createdAt !== "number" ||
      !isValidChangeLedgerTimestamp(value.createdAt, settings) ||
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

async function writeChangeLedgerHeartbeat(lockPath: string, token: string, heartbeatAt: number): Promise<void> {
  await writeFile(changeLedgerHeartbeatPath(lockPath, token), `${JSON.stringify({ heartbeatAt, token })}\n`, "utf8");
}

async function readChangeLedgerHeartbeat(
  lockPath: string,
  token: string,
  settings: ChangeLedgerLockSettings
): Promise<number | undefined> {
  try {
    const value = JSON.parse(await readFile(changeLedgerHeartbeatPath(lockPath, token), "utf8")) as {
      readonly heartbeatAt?: unknown;
      readonly token?: unknown;
    };
    return value.token === token && isValidChangeLedgerTimestamp(value.heartbeatAt, settings)
      ? value.heartbeatAt
      : undefined;
  } catch {
    return undefined;
  }
}

function isValidChangeLedgerTimestamp(
  value: unknown,
  settings: ChangeLedgerLockSettings
): value is number {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= settings.now() + settings.leaseMs;
}

function changeLedgerLockOwnerPath(lockPath: string): string {
  return join(lockPath, "owner.json");
}

function changeLedgerHeartbeatPath(lockPath: string, token: string): string {
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
