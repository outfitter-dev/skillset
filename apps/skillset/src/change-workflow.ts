import { createHash, randomBytes } from "node:crypto";
import { readFile, rm, stat, writeFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";

import {
  readPendingChangeEntries,
  resolvePendingChangeRef,
  type ChangeBump,
  type ChangeCheckOptions,
  type ChangeGroup,
  type PendingChangeEntry,
} from "./change-entries";
import { readAppliedChangeRecords as readCoreAppliedChangeRecords, type AppliedChangeRecord } from "@skillset/core/internal/change-history";
import type { ChangeLedgerEventType } from "@skillset/core/internal/change-ledger";
import { nextJsonlTimestampForPaths } from "@skillset/core/internal/change-ledger-write";
import { changeStatus, detectWorkspaceOptions, SOURCE_HASH_SCHEMA, type ChangeStatusOptions, type SourceUnit, type SourceUnitChange } from "./change-status";
import { CliUsageError } from "./cli-output";
import { compareStrings, resolveInside } from "@skillset/core/internal/path";
import { prepareRepositoryMutationPath } from "@skillset/core/internal/repository-mutation";
import {
  retiredRuleSelectorMessage,
  sourceUnitDisplay,
  sourceUnitSelector,
} from "@skillset/core/internal/source-unit-selector";
import type { JsonRecord, JsonValue, SkillsetOptions } from "@skillset/core/internal/types";
import { workspaceChangeFile, workspaceChangesDir } from "@skillset/core";
import { updateMarkdownSourceDocument } from "@skillset/core/internal/source-document";
import { parseMarkdown } from "@skillset/core/internal/yaml";
import { pendingLedgerEventsDir } from "@skillset/core/internal/pending-ledger-events";
import {
  withChangeLedgerMutation,
  type ChangeLedgerLockOptions,
} from "./change-ledger-mutation";
import {
  refreshChangeEvidenceWithAppend,
  type ChangeRefreshOptions,
  type ChangeRefreshReport,
} from "./change-refresh";
import {
  ignorePendingChangeWithAppend,
  type ChangeIgnoreOptions,
  type ChangeIgnoreReport,
} from "./change-ignore";

export type { ChangeLedgerLockOptions } from "./change-ledger-lock";
export type {
  ChangeRefreshEntry,
  ChangeRefreshOptions,
  ChangeRefreshReport,
  ChangeRefreshScope,
} from "./change-refresh";

export type ChangeSubcommand = "add" | "amend" | "check" | "history" | "ignore" | "list" | "migrate" | "reason" | "refresh" | "show" | "status";

export type ChangeReasonInput =
  | { readonly kind: "auto" }
  | { readonly kind: "file"; readonly path: string }
  | { readonly kind: "inline"; readonly value: string }
  | { readonly kind: "stdin" };

export interface ChangeAddOptions extends Omit<ChangeCheckOptions, "scopes"> {
  readonly bump?: ChangeBump;
  readonly group?: string;
  readonly lock?: ChangeLedgerLockOptions;
  readonly reason: ChangeReasonInput;
  readonly scopes: readonly string[];
}

export interface ChangeReasonOptions extends ChangeStatusOptions {
  readonly append: boolean;
  readonly lock?: ChangeLedgerLockOptions;
  readonly reason: ChangeReasonInput;
  readonly ref: string;
}

export interface ChangeAmendOptions extends ChangeStatusOptions {
  readonly lock?: ChangeLedgerLockOptions;
  readonly reason: ChangeReasonInput;
  readonly ref: string;
}

export interface ChangeListOptions extends ChangeStatusOptions {
  readonly group?: string;
}

export interface ChangeShowOptions extends ChangeStatusOptions {
  readonly ref: string;
}

export interface ChangeHistoryOptions extends ChangeStatusOptions {
  readonly ref?: string;
}

export interface ChangeMigrateOptions extends ChangeStatusOptions {
  readonly lock?: ChangeLedgerLockOptions;
  readonly write: boolean;
}

export interface ChangeEntryView {
  readonly bump?: ChangeBump;
  readonly group?: ChangeGroup;
  readonly id: string;
  readonly ignored: boolean;
  readonly path: string;
  readonly reason: string;
  readonly ref: string;
  readonly scopes: readonly string[];
  readonly sourceHashes: ReadonlyMap<string, readonly string[]>;
  readonly status: "history" | "pending";
}

export interface ChangeAddReport {
  readonly entry: ChangeEntryView;
  readonly ledgerPath: string;
}

export interface ChangeReasonReport {
  readonly entry: ChangeEntryView;
  readonly ledgerPath?: string;
}

export interface ChangeAmendReport {
  readonly entry: ChangeEntryView;
  readonly path: string;
}

export interface ChangeListReport {
  readonly entries: readonly ChangeEntryView[];
}

export interface ChangeShowReport {
  readonly entry: ChangeEntryView;
}

export interface ChangeHistoryReport {
  readonly entries: readonly ChangeEntryView[];
}

export interface ChangeMigrationEntry {
  readonly bump: ChangeBump;
  readonly fromPath: string;
  readonly group?: ChangeGroup;
  readonly id: string;
  readonly ignored: boolean;
  readonly reason: string;
  readonly scopes: readonly string[];
  readonly sourceHashes: ReadonlyMap<string, readonly string[]>;
  readonly toPath: string;
}

export interface ChangeMigrationReport {
  readonly entries: readonly ChangeMigrationEntry[];
  readonly ledgerPath: string;
  readonly written: boolean;
}

export type { ChangeIgnoreOptions, ChangeIgnoreReport } from "./change-ignore";

const AMENDMENTS_FILE = "amendments.jsonl";
const MIN_REF_LENGTH = 6;

export async function addChangeEntry(rootPath: string, options: ChangeAddOptions): Promise<ChangeAddReport> {
  if (options.scopes.length === 0) throw new Error("skillset: change add requires at least one --scope");
  const bump = options.bump;
  if (bump === undefined) throw new Error("skillset: change add requires --bump major, minor, patch, or none");
  for (const scope of options.scopes) {
    const retired = retiredRuleSelectorMessage(scope);
    if (retired !== undefined) throw new CliUsageError(`skillset: change scope ${retired}`);
  }
  const scopes = [...new Set(options.scopes.map(sourceUnitSelector))].sort(compareStrings);
  const reason = await resolveChangeReason(rootPath, options.reason);
  const statusOptions = await detectWorkspaceOptions(rootPath, sourceStatusOptions(options));

  return withChangeLedgerMutation(rootPath, statusOptions.sourceDir, options.lock, async (mutation) => {
    const status = await changeStatus(rootPath, statusOptions);
    const existing = await readAllChangeEntries(rootPath, statusOptions);
    const id = await generateChangeId(
      rootPath,
      { ...options, scopes, ...(statusOptions.sourceDir === undefined ? {} : { sourceDir: statusOptions.sourceDir }) },
      existing.map((entry) => entry.id)
    );
    const sourceHashes = new Map<string, readonly string[]>();
    for (const scope of scopes) {
      const hash = sourceHashForScope(scope, status.sourceUnits, status.sourceChanges);
      if (hash === undefined) throw new Error(`skillset: unknown change scope ${scope}`);
      sourceHashes.set(scope, [hash]);
    }

    const relativePath = join(workspaceChangesDir(statusOptions.sourceDir), `${id}.md`).replaceAll("\\", "/");
    const absolutePath = resolveInside(rootPath, relativePath);
    const group = options.group === undefined ? undefined : parseGroupArgument(options.group);
    const sourceUnits = ledgerSourceUnits(sourceHashes);
    const groupReference = group === undefined ? undefined : groupRef(group);
    await prepareRepositoryMutationPath(rootPath, absolutePath);
    await writeFile(absolutePath, reasonOnlyMarkdown(reason, { bump, ...(group === undefined ? {} : { group }), scopes }), "utf8");
    try {
      const written = await mutation.appendLedger([
        {
          payload: {
            bump,
            ...(groupReference === undefined ? {} : { group: groupReference, refs: [groupReference] }),
            path: relativePath,
            reason,
            reasonId: id,
            sourceUnits,
          },
          type: "reason.created",
        },
        {
          payload: {
            reasonId: id,
            sourceUnits,
          },
          type: "change.covered",
        },
      ]);

      const [entry] = await readPendingChangeEntries(rootPath, statusOptions).then((entries) => entries.filter((item) => item.id === id));
      if (entry === undefined) throw new Error(`skillset: failed to read created change entry ${id}`);
      const refs = refIndex([entry], await readHistoryEntries(rootPath, statusOptions));
      return {
        entry: pendingView(entry, refs),
        ledgerPath: written.path,
      };
    } catch (error) {
      try {
        await rm(absolutePath, { force: true });
      } catch (rollbackError) {
        throw new Error(
          `skillset: change add failed and rollback failed: ${errorMessage(rollbackError)}; original error: ${errorMessage(error)}`,
          { cause: error }
        );
      }
      throw error;
    }
  });
}

export async function updateChangeReason(rootPath: string, options: ChangeReasonOptions): Promise<ChangeReasonReport> {
  const storageOptions = await detectWorkspaceOptions(rootPath, options);
  const newReason = await resolveChangeReason(rootPath, options.reason);

  return withChangeLedgerMutation(rootPath, storageOptions.sourceDir, options.lock, async (mutation) => {
    const pendingEntries = await readPendingChangeEntries(rootPath, storageOptions);
    const entry = resolvePendingChangeRef(pendingEntries, options.ref);
    const absolutePath = resolveInside(rootPath, entry.path);
    // The entry was read through the filesystem; refuse a symlinked parent or
    // leaf before either rewrite (or the rollback restore) writes through it.
    await prepareRepositoryMutationPath(rootPath, absolutePath, { createParents: false });
    const previous = await readFile(absolutePath, "utf8");
    let writtenLedgerPath: string | undefined;
    try {
      if (entry.format === "reason") {
        const body = options.append ? `${entry.reason.trimEnd()}\n\n${newReason}` : newReason;
        await writeFile(
          absolutePath,
          reasonOnlyMarkdown(body, {
            ...(entry.bump === undefined ? {} : { bump: entry.bump }),
            ...(entry.group === undefined ? {} : { group: entry.group }),
            ignored: entry.ignored,
            scopes: entry.scopes,
          }),
          "utf8"
        );
        writtenLedgerPath = (await mutation.appendLedger([
          {
            payload: {
              append: options.append,
              reason: newReason,
              reasonId: entry.id ?? options.ref.replace(/^@/, ""),
            },
            type: "reason.updated",
          },
        ])).path;
      } else {
        const parts = parseMarkdown(previous, absolutePath);
        const body = options.append ? `${parts.body.trimEnd()}\n\n${newReason}` : newReason;
        await writeFile(
          absolutePath,
          updateMarkdownSourceDocument(previous, absolutePath, (current) => ({ ...current, body })),
          "utf8"
        );
      }
      const updated = resolvePendingChangeRef(await readPendingChangeEntries(rootPath, storageOptions), entry.id ?? options.ref);
      const refs = refIndex([updated], await readHistoryEntries(rootPath, storageOptions));
      return {
        entry: pendingView(updated, refs),
        ...(writtenLedgerPath === undefined ? {} : { ledgerPath: writtenLedgerPath }),
      };
    } catch (error) {
      try {
        await writeFile(absolutePath, previous, "utf8");
      } catch (rollbackError) {
        throw new Error(
          `skillset: change reason failed and rollback failed: ${errorMessage(rollbackError)}; original error: ${errorMessage(error)}`,
          { cause: error }
        );
      }
      throw error;
    }
  });
}

export async function amendAppliedChange(rootPath: string, options: ChangeAmendOptions): Promise<ChangeAmendReport> {
  const storageOptions = await detectWorkspaceOptions(rootPath, options);
  const reason = await resolveChangeReason(rootPath, options.reason);
  const relativePath = workspaceChangeFile(storageOptions.sourceDir, AMENDMENTS_FILE);

  return withChangeLedgerMutation(rootPath, storageOptions.sourceDir, options.lock, async (mutation) => {
    const pendingEntries = await readPendingChangeEntries(rootPath, storageOptions);
    const historyEntries = await readHistoryEntries(rootPath, storageOptions);
    const refs = refIndex(pendingEntries, historyEntries);
    assertCombinedRefUnambiguous(options.ref, pendingEntries, historyEntries, refs);
    const pending = tryResolvePending(pendingEntries, options.ref);
    if (pending !== undefined) {
      const pendingRef = pending.id === undefined ? options.ref : refs.get(pending.id) ?? `@${pending.id}`;
      throw new Error(`skillset: ${pendingRef} is pending; use skillset change reason before release`);
    }

    const entry = resolveHistoryRef(historyEntries, options.ref);
    const now = await nextJsonlTimestampForPaths([resolveInside(rootPath, relativePath)]);
    await mutation.appendJsonl(relativePath, [{
      amendedAt: now,
      id: entry.id,
      previousReason: entry.reason,
      reason,
      source: entry.path,
    }]);

    const updatedHistory = await readHistoryEntries(rootPath, storageOptions);
    const updatedRefs = refIndex(pendingEntries, updatedHistory);
    return { entry: historyView(resolveHistoryRef(updatedHistory, entry.id), updatedRefs), path: relativePath };
  });
}

export async function listChangeEntries(rootPath: string, options: ChangeListOptions = {}): Promise<ChangeListReport> {
  const storageOptions = await detectWorkspaceOptions(rootPath, options);
  const pendingEntries = await readPendingChangeEntries(rootPath, storageOptions);
  const historyEntries = await readHistoryEntries(rootPath, storageOptions);
  const refs = refIndex(pendingEntries, historyEntries);
  const entries = pendingEntries
    .filter((entry) => options.group === undefined || groupMatches(entry.group, options.group))
    .map((entry) => pendingView(entry, refs));
  return { entries };
}

export async function showChangeEntry(rootPath: string, options: ChangeShowOptions): Promise<ChangeShowReport> {
  const storageOptions = await detectWorkspaceOptions(rootPath, options);
  const resolved = await resolveAnyChangeRef(rootPath, options.ref, storageOptions);
  return { entry: resolved };
}

export async function readChangeHistory(rootPath: string, options: ChangeHistoryOptions = {}): Promise<ChangeHistoryReport> {
  const storageOptions = await detectWorkspaceOptions(rootPath, options);
  const pendingEntries = await readPendingChangeEntries(rootPath, storageOptions);
  const historyEntries = await readHistoryEntries(rootPath, storageOptions);
  const refs = refIndex(pendingEntries, historyEntries);
  if (options.ref === undefined) return { entries: historyEntries.map((entry) => historyView(entry, refs)) };
  assertCombinedRefUnambiguous(options.ref, pendingEntries, historyEntries, refs);
  const pending = tryResolvePending(pendingEntries, options.ref);
  if (pending !== undefined) {
    const pendingRef = pending.id === undefined ? options.ref : refs.get(pending.id) ?? `@${pending.id}`;
    throw new Error(`skillset: ${pendingRef} is pending; no applied history entry`);
  }
  const history = resolveHistoryRef(historyEntries, options.ref);
  return { entries: [historyView(history, refs)] };
}

export async function migratePendingChangeEntries(
  rootPath: string,
  options: ChangeMigrateOptions
): Promise<ChangeMigrationReport> {
  const storageOptions = await detectWorkspaceOptions(rootPath, options);
  const planMigrations = async () => planFrontmatterMigrations(
    rootPath,
    storageOptions.sourceDir,
    (await readPendingChangeEntries(rootPath, storageOptions)).filter((entry) => entry.format === "frontmatter")
  );
  let migrations = await planMigrations();
  let writtenLedgerPath: string | undefined;

  if (options.write && migrations.length > 0) {
    // Re-plan under the lock: a concurrent reason edit before acquisition must
    // be migrated, not overwritten by the preview's stale body.
    migrations = await withChangeLedgerMutation(rootPath, storageOptions.sourceDir, options.lock, async (mutation) => {
      const locked = await planMigrations();
      const snapshots = await snapshotMigrationFiles(rootPath, locked);
      try {
        for (const migration of locked) {
          const absoluteToPath = resolveInside(rootPath, migration.toPath);
          await prepareRepositoryMutationPath(rootPath, absoluteToPath);
          await writeFile(
            absoluteToPath,
            reasonOnlyMarkdown(migration.reason, {
              bump: migration.bump,
              ...(migration.group === undefined ? {} : { group: migration.group }),
              ignored: migration.ignored,
              scopes: migration.scopes,
            }),
            "utf8"
          );
          if (migration.fromPath !== migration.toPath) {
            const absoluteFromPath = resolveInside(rootPath, migration.fromPath);
            await prepareRepositoryMutationPath(rootPath, absoluteFromPath, {
              createParents: false,
              replacesLeaf: true,
            });
            await rm(absoluteFromPath, { force: true });
          }
        }
        writtenLedgerPath = (await mutation.appendLedger(
          locked.flatMap((migration) => migrationLedgerEvents(migration))
        )).path;
      } catch (error) {
        try {
          await restoreMigrationFiles(rootPath, snapshots);
        } catch (restoreError) {
          throw new Error(
            `skillset: change migration failed and rollback failed: ${errorMessage(restoreError)}; original error: ${errorMessage(error)}`,
            { cause: error }
          );
        }
        throw error;
      }
      return locked;
    });
  }

  return {
    entries: migrations,
    ledgerPath: writtenLedgerPath ?? pendingLedgerEventsDir(storageOptions.sourceDir),
    written: options.write,
  };
}

export async function refreshChangeEvidence(
  rootPath: string,
  options: ChangeRefreshOptions
): Promise<ChangeRefreshReport> {
  return refreshChangeEvidenceWithAppend(rootPath, options);
}

export async function ignorePendingChange(
  rootPath: string,
  options: ChangeIgnoreOptions
): Promise<ChangeIgnoreReport> {
  return ignorePendingChangeWithAppend(rootPath, options);
}

export async function readAppliedChangeRecords(
  rootPath: string,
  options: ChangeStatusOptions = {}
): Promise<readonly AppliedChangeRecord[]> {
  const storageOptions = await detectWorkspaceOptions(rootPath, options);
  return readHistoryEntries(rootPath, storageOptions);
}

async function resolveAnyChangeRef(
  rootPath: string,
  ref: string,
  options: ChangeStatusOptions
): Promise<ChangeEntryView> {
  const pendingEntries = await readPendingChangeEntries(rootPath, options);
  const historyEntries = await readHistoryEntries(rootPath, options);
  const refs = refIndex(pendingEntries, historyEntries);
  assertCombinedRefUnambiguous(ref, pendingEntries, historyEntries, refs);
  const pending = tryResolvePending(pendingEntries, ref);
  if (pending !== undefined) return pendingView(pending, refs);
  return historyView(resolveHistoryRef(historyEntries, ref), refs);
}

function reasonOnlyMarkdown(
  reason: string,
  input: {
    readonly bump?: ChangeBump;
    readonly group?: ChangeGroup;
    readonly ignored?: boolean;
    readonly scopes: readonly string[];
  }
): string {
  const directives = [
    ...(input.bump === undefined ? [] : [`Bump: ${input.bump}`]),
    ...(input.group === undefined ? [] : [`Group: ${groupRef(input.group)}`]),
    ...(input.ignored === true ? ["Ignored: true"] : []),
    ...input.scopes.map((scope) => `Scope: ${sourceUnitSelector(scope)}`),
  ];
  const normalizedReason = reason.replaceAll(/\r\n?/g, "\n").trim();
  return `${normalizedReason}\n\n${directives.join("\n")}\n`;
}

async function planFrontmatterMigrations(
  rootPath: string,
  sourceDir: string | undefined,
  entries: readonly PendingChangeEntry[]
): Promise<readonly ChangeMigrationEntry[]> {
  const migrations: ChangeMigrationEntry[] = [];
  const errors: string[] = [];
  const changesDir = workspaceChangesDir(sourceDir);
  for (const entry of entries) {
    const entryErrors = frontmatterMigrationErrors(entry);
    const id = entry.id;
    const bump = entry.bump;
    const toPath = id === undefined ? undefined : join(changesDir, `${id}.md`).replaceAll("\\", "/");
    if (toPath !== undefined && toPath !== entry.path && await exists(resolveInside(rootPath, toPath))) {
      entryErrors.push(`target ${toPath} already exists`);
    }
    if (entryErrors.length > 0) {
      errors.push(`${entry.path}: ${entryErrors.join("; ")}`);
      continue;
    }
    if (id === undefined || bump === undefined || toPath === undefined) continue;
    migrations.push({
      bump,
      fromPath: entry.path,
      ...(entry.group === undefined ? {} : { group: entry.group }),
      id,
      ignored: entry.ignored,
      reason: entry.reason,
      scopes: entry.scopes.map(sourceUnitSelector),
      sourceHashes: entry.sourceHashes,
      toPath,
    });
  }
  if (errors.length > 0) {
    throw new Error(`skillset: cannot migrate invalid frontmatter pending entries\n${errors.join("\n")}`);
  }
  return migrations.sort((left, right) => compareStrings(left.fromPath, right.fromPath));
}

function frontmatterMigrationErrors(entry: PendingChangeEntry): string[] {
  const errors = entry.schemaDiagnostics.map((diagnostic) => diagnostic.message);
  if (entry.id === undefined) errors.push("missing id");
  if (entry.bump === undefined) errors.push("missing bump");
  if (entry.scopes.length === 0) errors.push("missing scope");
  for (const scope of entry.scopes) {
    if ((entry.sourceHashes.get(scope) ?? []).length === 0) errors.push(`missing source hash evidence for ${sourceUnitDisplay(scope)}`);
  }
  return errors;
}

function migrationLedgerEvents(migration: ChangeMigrationEntry): readonly {
  readonly payload: JsonRecord;
  readonly type: ChangeLedgerEventType;
}[] {
  const sourceUnits = ledgerSourceUnits(migration.sourceHashes);
  const group = groupRef(migration.group);
  return [
    {
      payload: {
        bump: migration.bump,
        ...(group === undefined ? {} : { group, refs: [group] }),
        ...(migration.ignored ? { ignored: true } : {}),
        path: migration.toPath,
        reason: migration.reason,
        reasonId: migration.id,
        sourceUnits,
      },
      type: "reason.created",
    },
    {
      payload: {
        reasonId: migration.id,
        sourceUnits,
      },
      type: migration.ignored ? "change.ignored" : "change.covered",
    },
  ];
}

interface MigrationFileSnapshot {
  readonly content?: string;
  readonly path: string;
}

async function snapshotMigrationFiles(
  rootPath: string,
  migrations: readonly ChangeMigrationEntry[]
): Promise<readonly MigrationFileSnapshot[]> {
  const paths = new Set<string>();
  for (const migration of migrations) {
    paths.add(migration.fromPath);
    paths.add(migration.toPath);
  }
  return Promise.all([...paths].sort(compareStrings).map((path) => snapshotMigrationFile(rootPath, path)));
}

async function snapshotMigrationFile(rootPath: string, path: string): Promise<MigrationFileSnapshot> {
  const absolutePath = resolveInside(rootPath, path);
  try {
    return { content: await readFile(absolutePath, "utf8"), path };
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") return { path };
    throw error;
  }
}

async function restoreMigrationFiles(rootPath: string, snapshots: readonly MigrationFileSnapshot[]): Promise<void> {
  for (const snapshot of snapshots) {
    const absolutePath = resolveInside(rootPath, snapshot.path);
    if (snapshot.content === undefined) {
      await prepareRepositoryMutationPath(rootPath, absolutePath, {
        createParents: false,
        replacesLeaf: true,
      });
      await rm(absolutePath, { force: true });
      continue;
    }
    await prepareRepositoryMutationPath(rootPath, absolutePath);
    await writeFile(absolutePath, snapshot.content, "utf8");
  }
}

function ledgerSourceUnits(sourceHashes: ReadonlyMap<string, readonly string[]>): JsonRecord[] {
  return [...sourceHashes]
    .flatMap(([selector, hashes]) => hashes.map((sourceHash) => ({ hashSchema: SOURCE_HASH_SCHEMA, selector, sourceHash })))
    .sort((left, right) => compareStrings(`${left.selector}\0${left.sourceHash}`, `${right.selector}\0${right.sourceHash}`));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sourceStatusOptions(options: Omit<ChangeAddOptions, "reason" | "scopes">): ChangeStatusOptions {
  const statusOptions: SkillsetOptions & { readonly since?: string } = {
    ...(options.buildMode === undefined ? {} : { buildMode: options.buildMode }),
    ...(options.distDir === undefined ? {} : { distDir: options.distDir }),
    ...(options.sourceDir === undefined ? {} : { sourceDir: options.sourceDir }),
    ...(options.since === undefined ? {} : { since: options.since }),
  };
  return statusOptions;
}

async function generateChangeId(
  rootPath: string,
  options: ChangeAddOptions,
  existingIds: readonly string[]
): Promise<string> {
  const changesDir = workspaceChangesDir(options.sourceDir);
  const existing = new Set(existingIds);
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const hash = createHash("sha256");
    hash.update(options.scopes.join("\0"));
    hash.update("\0");
    hash.update(String(Date.now()));
    hash.update("\0");
    hash.update(randomBytes(16));
    hash.update("\0");
    hash.update(String(attempt));
    const id = hash.digest("hex").slice(0, 12);
    if (existing.has(id)) continue;
    if (await exists(resolveInside(rootPath, join(changesDir, `${id}.md`)))) continue;
    return id;
  }
  throw new Error("skillset: failed to generate a unique change id");
}

export async function resolveChangeReason(rootPath: string, input: ChangeReasonInput): Promise<string> {
  let reason: string | undefined;
  if (input.kind === "inline") reason = input.value;
  if (input.kind === "file") {
    const reasonPath = isAbsolute(input.path) ? input.path : resolve(rootPath, input.path);
    reason = await readFile(reasonPath, "utf8");
  }
  if (input.kind === "stdin" || input.kind === "auto") {
    if (input.kind === "auto" && process.stdin.isTTY === true) {
      throw new Error("skillset: pass --reason, --reason-file, or pipe a reason on stdin");
    }
    reason = await Bun.stdin.text();
  }
  const trimmed = reason?.trim();
  if (trimmed === undefined || trimmed.length === 0) {
    throw new Error("skillset: change reason must not be empty");
  }
  return trimmed;
}

function sourceHashForScope(
  scope: string,
  currentUnits: readonly SourceUnit[],
  sourceChanges: readonly SourceUnitChange[]
): string | undefined {
  const change = sourceChanges.find((item) => item.id === scope);
  if (change?.currentHash !== undefined) return change.currentHash;
  if (change?.baselineHash !== undefined) return change.baselineHash;
  return currentUnits.find((unit) => unit.id === scope)?.hash;
}

function parseGroupArgument(value: string): ChangeGroup {
  const splitIndex = value.indexOf(":");
  if (splitIndex > 0 && splitIndex < value.length - 1) {
    return { provider: value.slice(0, splitIndex), id: value.slice(splitIndex + 1) };
  }
  return { id: value };
}

function groupJson(group: ChangeGroup): JsonValue {
  return group.provider === undefined ? group.id : { id: group.id, provider: group.provider };
}

function groupMatches(group: ChangeGroup | undefined, value: string): boolean {
  if (group === undefined) return false;
  return group.id === value || groupRef(group) === value;
}

export function groupRef(group: ChangeGroup | undefined): string | undefined {
  if (group === undefined) return undefined;
  return group.provider === undefined ? group.id : `${group.provider}:${group.id}`;
}

function pendingView(entry: PendingChangeEntry, refs: ReadonlyMap<string, string>): ChangeEntryView {
  return {
    ...(entry.bump === undefined ? {} : { bump: entry.bump }),
    ...(entry.group === undefined ? {} : { group: entry.group }),
    id: entry.id ?? "",
    ignored: entry.ignored,
    path: entry.path,
    reason: entry.reason,
    ref: refs.get(entry.id ?? "") ?? `@${entry.id ?? ""}`,
    scopes: entry.scopes.map(sourceUnitSelector),
    sourceHashes: entry.sourceHashes,
    status: "pending",
  };
}

type HistoryEntry = AppliedChangeRecord;

function historyView(entry: HistoryEntry, refs: ReadonlyMap<string, string>): ChangeEntryView {
  return {
    ...(entry.bump === undefined ? {} : { bump: entry.bump }),
    ...(entry.group === undefined ? {} : { group: entry.group }),
    id: entry.id,
    ignored: entry.ignored,
    path: entry.path,
    reason: entry.reason,
    ref: refs.get(entry.id) ?? `@${entry.id}`,
    scopes: entry.scopes.map(sourceUnitSelector),
    sourceHashes: entry.sourceHashes,
    status: "history",
  };
}

/** Applied history comes from Core's single reader; refs and views stay here. */
function readHistoryEntries(rootPath: string, options: ChangeStatusOptions = {}): Promise<readonly HistoryEntry[]> {
  return readCoreAppliedChangeRecords(rootPath, options.sourceDir === undefined ? {} : { sourceDir: options.sourceDir });
}

async function readAllChangeEntries(rootPath: string, options: ChangeStatusOptions): Promise<readonly { readonly id: string }[]> {
  const pending = await readPendingChangeEntries(rootPath, options);
  const history = await readHistoryEntries(rootPath, options);
  return [
    ...pending.flatMap((entry) => entry.id === undefined ? [] : [{ id: entry.id }]),
    ...history.map((entry) => ({ id: entry.id })),
  ];
}

function tryResolvePending(entries: readonly PendingChangeEntry[], ref: string): PendingChangeEntry | undefined {
  try {
    return resolvePendingChangeRef(entries, ref);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("no pending change entry matches")) return undefined;
    throw error;
  }
}

function resolveHistoryRef(entries: readonly HistoryEntry[], rawRef: string): HistoryEntry {
  const prefix = rawRef.startsWith("@") ? rawRef.slice(1) : rawRef;
  if (!/^[0-9a-f]+$/.test(prefix)) {
    throw new CliUsageError(`skillset: expected change ref to look like @<hex-prefix>, received ${JSON.stringify(rawRef)}`);
  }
  if (prefix.length < MIN_REF_LENGTH) {
    throw new CliUsageError(`skillset: expected change ref @${prefix} to use at least ${MIN_REF_LENGTH} hex characters`);
  }
  const candidates = entries.filter((entry) => entry.id.startsWith(prefix));
  if (candidates.length === 0) throw new Error(`skillset: no applied history entry matches @${prefix}`);
  if (candidates.length > 1) {
    throw new Error(`skillset: ambiguous change ref @${prefix}; candidates: ${candidates.map((entry) => `@${entry.id}`).join(", ")}`);
  }
  const [entry] = candidates;
  if (entry === undefined) throw new Error(`skillset: no applied history entry matches @${prefix}`);
  return entry;
}

function assertCombinedRefUnambiguous(
  rawRef: string,
  pendingEntries: readonly PendingChangeEntry[],
  historyEntries: readonly HistoryEntry[],
  refs: ReadonlyMap<string, string>
): void {
  const prefix = changeRefPrefix(rawRef);
  const matchingIds = new Set<string>();
  for (const entry of pendingEntries) {
    if (entry.id !== undefined && entry.id.startsWith(prefix)) matchingIds.add(entry.id);
  }
  for (const entry of historyEntries) {
    if (entry.id.startsWith(prefix)) matchingIds.add(entry.id);
  }
  if (matchingIds.size <= 1) return;
  const candidates = [...matchingIds]
    .sort(compareStrings)
    .map((id) => refs.get(id) ?? `@${id}`)
    .join(", ");
  throw new Error(`skillset: ambiguous change ref @${prefix}; candidates: ${candidates}`);
}

function changeRefPrefix(rawRef: string): string {
  const prefix = rawRef.startsWith("@") ? rawRef.slice(1) : rawRef;
  if (!/^[0-9a-f]+$/.test(prefix)) {
    throw new CliUsageError(`skillset: expected change ref to look like @<hex-prefix>, received ${JSON.stringify(rawRef)}`);
  }
  if (prefix.length < MIN_REF_LENGTH) {
    throw new CliUsageError(`skillset: expected change ref @${prefix} to use at least ${MIN_REF_LENGTH} hex characters`);
  }
  return prefix;
}

function refIndex(
  pendingEntries: readonly PendingChangeEntry[],
  historyEntries: readonly HistoryEntry[]
): ReadonlyMap<string, string> {
  const ids = [
    ...pendingEntries.flatMap((entry) => entry.id === undefined ? [] : [entry.id]),
    ...historyEntries.map((entry) => entry.id),
  ];
  const refs = new Map<string, string>();
  for (const id of ids) {
    let length = Math.min(id.length, MIN_REF_LENGTH);
    while (length < id.length && ids.some((candidate) => candidate !== id && candidate.startsWith(id.slice(0, length)))) {
      length += 1;
    }
    refs.set(id, `@${id.slice(0, length)}`);
  }
  return refs;
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}
