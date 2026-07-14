import { createHash, randomBytes } from "node:crypto";
import { appendFile, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";

import {
  readPendingChangeEntries,
  resolvePendingChangeRef,
  type ChangeBump,
  type ChangeCheckOptions,
  type ChangeGroup,
  type PendingChangeEntry,
} from "./change-entries";
import type { ChangeLedgerEventType } from "@skillset/core/internal/change-ledger";
import { changeStatus, detectWorkspaceOptions, type ChangeStatusOptions, type SourceUnit, type SourceUnitChange } from "./change-status";
import { readString } from "@skillset/core/internal/config";
import { compareStrings, resolveInside } from "@skillset/core/internal/path";
import {
  selectorForPluginCompanion,
  selectorForPluginConfig,
  selectorForPluginFeature,
  selectorForPluginSkill,
  selectorForProjectAgent,
  selectorForRootConfig,
  selectorForStandaloneSkill,
  selectorForTargetNativeIsland,
  sourceUnitDisplay,
  sourceUnitSelector,
} from "@skillset/core/internal/source-unit-selector";
import type { JsonRecord, JsonValue, SkillsetOptions } from "@skillset/core/internal/types";
import { workspaceChangeFile, workspaceChangesDir } from "@skillset/core";
import { isJsonRecord, parseMarkdown, stringifyMarkdown } from "@skillset/core/internal/yaml";

export type ChangeSubcommand = "add" | "amend" | "check" | "history" | "list" | "migrate" | "reason" | "show" | "status";

export type ChangeReasonInput =
  | { readonly kind: "auto" }
  | { readonly kind: "file"; readonly path: string }
  | { readonly kind: "inline"; readonly value: string }
  | { readonly kind: "stdin" };

export interface ChangeAddOptions extends Omit<ChangeCheckOptions, "scopes"> {
  readonly bump?: ChangeBump;
  readonly group?: string;
  readonly reason: ChangeReasonInput;
  readonly scopes: readonly string[];
}

export interface ChangeReasonOptions extends ChangeStatusOptions {
  readonly append: boolean;
  readonly reason: ChangeReasonInput;
  readonly ref: string;
}

export interface ChangeAmendOptions extends ChangeStatusOptions {
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
  readonly write: boolean;
}

export interface ChangeEntryView {
  readonly bump?: ChangeBump;
  readonly group?: ChangeGroup;
  readonly id: string;
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

export interface AppliedChangeRecord {
  readonly bump?: ChangeBump;
  readonly group?: ChangeGroup;
  readonly id: string;
  readonly ignored: boolean;
  readonly path: string;
  readonly reason: string;
  readonly scopes: readonly string[];
  readonly sourceHashes: ReadonlyMap<string, readonly string[]>;
}

const HISTORY_FILE = "history.jsonl";
const AMENDMENTS_FILE = "amendments.jsonl";
const MIN_REF_LENGTH = 6;

export async function addChangeEntry(rootPath: string, options: ChangeAddOptions): Promise<ChangeAddReport> {
  if (options.scopes.length === 0) throw new Error("skillset: change add requires at least one --scope");
  if (options.bump === undefined) throw new Error("skillset: change add requires --bump major, minor, patch, or none");
  const scopes = [...new Set(options.scopes.map(sourceUnitSelector))].sort(compareStrings);
  const reason = await resolveChangeReason(rootPath, options.reason);
  const statusOptions = await detectWorkspaceOptions(rootPath, sourceStatusOptions(options));
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
  await mkdir(resolveInside(rootPath, workspaceChangesDir(statusOptions.sourceDir)), { recursive: true });
  await writeFile(absolutePath, reasonOnlyMarkdown(reason, { bump: options.bump, ...(group === undefined ? {} : { group }), scopes }), "utf8");
  await appendLedgerEvents(rootPath, statusOptions.sourceDir, [
    {
      payload: {
        bump: options.bump,
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
    ledgerPath: workspaceChangeFile(statusOptions.sourceDir, "ledger.jsonl"),
  };
}

export async function updateChangeReason(rootPath: string, options: ChangeReasonOptions): Promise<ChangeReasonReport> {
  const storageOptions = await detectWorkspaceOptions(rootPath, options);
  const pendingEntries = await readPendingChangeEntries(rootPath, storageOptions);
  const entry = resolvePendingChangeRef(pendingEntries, options.ref);
  const newReason = await resolveChangeReason(rootPath, options.reason);
  const absolutePath = resolveInside(rootPath, entry.path);
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
    await appendLedgerEvents(rootPath, storageOptions.sourceDir, [
      {
        payload: {
          append: options.append,
          reason: newReason,
          reasonId: entry.id ?? options.ref.replace(/^@/, ""),
        },
        type: "reason.updated",
      },
    ]);
  } else {
    const parts = parseMarkdown(await readFile(absolutePath, "utf8"), absolutePath);
    const body = options.append ? `${parts.body.trimEnd()}\n\n${newReason}` : newReason;
    await writeFile(absolutePath, stringifyMarkdown(parts.frontmatter, body), "utf8");
  }
  const updated = resolvePendingChangeRef(await readPendingChangeEntries(rootPath, storageOptions), entry.id ?? options.ref);
  const refs = refIndex([updated], await readHistoryEntries(rootPath, storageOptions));
  return {
    entry: pendingView(updated, refs),
    ...(entry.format === "reason"
      ? { ledgerPath: workspaceChangeFile(storageOptions.sourceDir, "ledger.jsonl") }
      : {}),
  };
}

export async function amendAppliedChange(rootPath: string, options: ChangeAmendOptions): Promise<ChangeAmendReport> {
  const storageOptions = await detectWorkspaceOptions(rootPath, options);
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
  const reason = await resolveChangeReason(rootPath, options.reason);
  const now = new Date().toISOString();
  const relativePath = workspaceChangeFile(storageOptions.sourceDir, AMENDMENTS_FILE);
  const absolutePath = resolveInside(rootPath, relativePath);
  await mkdir(dirname(absolutePath), { recursive: true });
  await appendFile(absolutePath, `${JSON.stringify({
    amendedAt: now,
    id: entry.id,
    previousReason: entry.reason,
    reason,
    source: entry.path,
  })}\n`, "utf8");

  const updatedHistory = await readHistoryEntries(rootPath, storageOptions);
  const updatedRefs = refIndex(pendingEntries, updatedHistory);
  return { entry: historyView(resolveHistoryRef(updatedHistory, entry.id), updatedRefs), path: relativePath };
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
  const entries = await readPendingChangeEntries(rootPath, storageOptions);
  const frontmatterEntries = entries.filter((entry) => entry.format === "frontmatter");
  const migrations = await planFrontmatterMigrations(rootPath, storageOptions.sourceDir, frontmatterEntries);

  if (options.write && migrations.length > 0) {
    const snapshots = await snapshotMigrationFiles(rootPath, storageOptions.sourceDir, migrations);
    try {
      for (const migration of migrations) {
        const absoluteToPath = resolveInside(rootPath, migration.toPath);
        await mkdir(dirname(absoluteToPath), { recursive: true });
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
        if (migration.fromPath !== migration.toPath) await rm(resolveInside(rootPath, migration.fromPath), { force: true });
      }
      await appendLedgerEvents(rootPath, storageOptions.sourceDir, migrations.flatMap((migration) => migrationLedgerEvents(migration)));
    } catch (error) {
      try {
        await restoreMigrationFiles(rootPath, snapshots);
      } catch (restoreError) {
        throw new Error(
          `skillset: change migration failed and rollback failed: ${errorMessage(restoreError)}; original error: ${errorMessage(error)}`
        );
      }
      throw error;
    }
  }

  return {
    entries: migrations,
    ledgerPath: workspaceChangeFile(storageOptions.sourceDir, "ledger.jsonl"),
    written: options.write,
  };
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
  sourceDir: string | undefined,
  migrations: readonly ChangeMigrationEntry[]
): Promise<readonly MigrationFileSnapshot[]> {
  const paths = new Set<string>([workspaceChangeFile(sourceDir, "ledger.jsonl")]);
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
      await rm(absolutePath, { force: true });
      continue;
    }
    await mkdir(dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, snapshot.content, "utf8");
  }
}

function ledgerSourceUnits(sourceHashes: ReadonlyMap<string, readonly string[]>): JsonRecord[] {
  return [...sourceHashes]
    .flatMap(([selector, hashes]) => hashes.map((sourceHash) => ({ hashSchema: "skillset-source-unit-v2", selector, sourceHash })))
    .sort((left, right) => compareStrings(`${left.selector}\0${left.sourceHash}`, `${right.selector}\0${right.sourceHash}`));
}

async function appendLedgerEvents(
  rootPath: string,
  sourceDir: string | undefined,
  events: readonly {
    readonly payload: JsonRecord;
    readonly type: ChangeLedgerEventType;
  }[]
): Promise<void> {
  const path = workspaceChangeFile(sourceDir, "ledger.jsonl");
  const absolutePath = resolveInside(rootPath, path);
  await mkdir(dirname(absolutePath), { recursive: true });
  const now = new Date().toISOString();
  await appendFile(
    absolutePath,
    events
      .map((event) =>
        JSON.stringify({
          createdAt: now,
          id: ledgerEventId(event.type),
          payload: event.payload,
          schemaVersion: 1,
          type: event.type,
        })
      )
      .join("\n") + "\n",
    "utf8"
  );
}

function ledgerEventId(type: ChangeLedgerEventType): string {
  const hash = createHash("sha256");
  hash.update(type);
  hash.update("\0");
  hash.update(String(Date.now()));
  hash.update("\0");
  hash.update(randomBytes(16));
  return `evt-${hash.digest("hex").slice(0, 16)}`;
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
    path: entry.path,
    reason: entry.reason,
    ref: refs.get(entry.id ?? "") ?? `@${entry.id ?? ""}`,
    scopes: entry.scopes.map(sourceUnitSelector),
    sourceHashes: entry.sourceHashes,
    status: "pending",
  };
}

interface HistoryEntry extends AppliedChangeRecord {
  readonly bump?: ChangeBump;
  readonly group?: ChangeGroup;
  readonly id: string;
  readonly path: string;
  readonly reason: string;
  readonly scopes: readonly string[];
  readonly sourceHashes: ReadonlyMap<string, readonly string[]>;
}

function historyView(entry: HistoryEntry, refs: ReadonlyMap<string, string>): ChangeEntryView {
  return {
    ...(entry.bump === undefined ? {} : { bump: entry.bump }),
    ...(entry.group === undefined ? {} : { group: entry.group }),
    id: entry.id,
    path: entry.path,
    reason: entry.reason,
    ref: refs.get(entry.id) ?? `@${entry.id}`,
    scopes: entry.scopes.map(sourceUnitSelector),
    sourceHashes: entry.sourceHashes,
    status: "history",
  };
}

async function readHistoryEntries(rootPath: string, options: ChangeStatusOptions = {}): Promise<readonly HistoryEntry[]> {
  const path = workspaceChangeFile(options.sourceDir, HISTORY_FILE);
  const absolutePath = resolveInside(rootPath, path);
  if (!(await exists(absolutePath))) return [];
  const entries: HistoryEntry[] = [];
  const lines = (await readFile(absolutePath, "utf8")).split("\n");
  for (const [index, line] of lines.entries()) {
    if (line.trim().length === 0) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line) as unknown;
    } catch {
      throw new Error(`skillset: invalid JSON in ${path}:${index + 1}`);
    }
    if (!isJsonRecord(parsed)) throw new Error(`skillset: expected ${path}:${index + 1} to contain a JSON object`);
    const id = readString(parsed, "id");
    if (id === undefined) continue;
    const scopes = readHistoryScopes(parsed);
    const bump = readHistoryBump(parsed.bump);
    const group = readHistoryGroup(parsed.group);
    entries.push({
      ...(bump === undefined ? {} : { bump }),
      ...(group === undefined ? {} : { group }),
      id,
      ignored: parsed.ignored === true,
      path: `${path}:${index + 1}`,
      reason: readString(parsed, "reason") ?? readString(parsed, "body") ?? "",
      scopes,
      sourceHashes: readHistoryEvidence(parsed.evidence, scopes),
    });
  }
  const amended = await applyHistoryAmendments(rootPath, options.sourceDir, entries);
  return [...amended].sort((left, right) => compareStrings(left.id, right.id));
}

async function applyHistoryAmendments(
  rootPath: string,
  sourceDir: string | undefined,
  entries: readonly HistoryEntry[]
): Promise<readonly HistoryEntry[]> {
  const amendments = await readHistoryAmendments(rootPath, sourceDir);
  if (amendments.size === 0) return entries;
  return entries.map((entry) => {
    const amendment = amendments.get(entry.id);
    return amendment === undefined ? entry : { ...entry, reason: amendment.reason };
  });
}

async function readHistoryAmendments(rootPath: string, sourceDir: string | undefined): Promise<ReadonlyMap<string, { readonly reason: string }>> {
  const path = workspaceChangeFile(sourceDir, AMENDMENTS_FILE);
  const absolutePath = resolveInside(rootPath, path);
  if (!(await exists(absolutePath))) return new Map();
  const amendments = new Map<string, { readonly reason: string }>();
  const lines = (await readFile(absolutePath, "utf8")).split("\n");
  for (const [index, line] of lines.entries()) {
    if (line.trim().length === 0) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line) as unknown;
    } catch {
      throw new Error(`skillset: invalid JSON in ${path}:${index + 1}`);
    }
    if (!isJsonRecord(parsed)) throw new Error(`skillset: expected ${path}:${index + 1} to contain a JSON object`);
    const id = readString(parsed, "id");
    const reason = readString(parsed, "reason");
    if (id === undefined || reason === undefined) continue;
    amendments.set(id, { reason });
  }
  return amendments;
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
    throw new Error(`skillset: expected change ref to look like @<hex-prefix>, received ${JSON.stringify(rawRef)}`);
  }
  if (prefix.length < MIN_REF_LENGTH) {
    throw new Error(`skillset: expected change ref @${prefix} to use at least ${MIN_REF_LENGTH} hex characters`);
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
    throw new Error(`skillset: expected change ref to look like @<hex-prefix>, received ${JSON.stringify(rawRef)}`);
  }
  if (prefix.length < MIN_REF_LENGTH) {
    throw new Error(`skillset: expected change ref @${prefix} to use at least ${MIN_REF_LENGTH} hex characters`);
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

function readHistoryScopes(record: JsonRecord): readonly string[] {
  const values: string[] = [];
  const scope = record.scope;
  const scopes = record.scopes;
  if (typeof scope === "string") values.push(scope);
  if (Array.isArray(scopes)) {
    for (const item of scopes) {
      if (typeof item === "string") values.push(item);
    }
  }
  return [...new Set(values.map(historicalSourceUnitSelector))].sort(compareStrings);
}

function readHistoryBump(value: JsonValue | undefined): ChangeBump | undefined {
  return value === "major" || value === "minor" || value === "none" || value === "patch" ? value : undefined;
}

function readHistoryGroup(value: JsonValue | undefined): ChangeGroup | undefined {
  if (typeof value === "string") return { id: value };
  if (!isJsonRecord(value)) return undefined;
  const id = readString(value, "id");
  const provider = readString(value, "provider");
  return id === undefined ? undefined : { id, ...(provider === undefined ? {} : { provider }) };
}

function readHistoryEvidence(raw: JsonValue | undefined, scopes: readonly string[]): ReadonlyMap<string, readonly string[]> {
  const evidence = new Map<string, string[]>();
  const add = (scope: string | undefined, hash: string | undefined): void => {
    if (scope === undefined || hash === undefined) return;
    const normalizedScope = historicalSourceUnitSelector(scope);
    const current = evidence.get(normalizedScope) ?? [];
    current.push(hash);
    evidence.set(normalizedScope, current);
  };
  const singleScope = scopes.length === 1 ? scopes[0] : undefined;
  if (!Array.isArray(raw)) return evidence;
  for (const item of raw) {
    if (!isJsonRecord(item)) continue;
    add(readString(item, "scope") ?? singleScope, readString(item, "sourceHash") ?? readString(item, "hash") ?? readString(item, "currentHash"));
  }
  return evidence;
}

// Applied history is append-only, so records written before the SET-53 selector
// cutover keep their original scope strings. Normalize only while reading
// history; pending/current change scopes remain strict via sourceUnitSelector.
function historicalSourceUnitSelector(raw: string): string {
  if (raw === "root-config") return selectorForRootConfig();
  if (raw.startsWith("standalone-skill:")) return selectorForStandaloneSkill(raw.slice("standalone-skill:".length));
  if (raw.startsWith("project-agent:")) return selectorForProjectAgent(raw.slice("project-agent:".length));
  if (raw.startsWith("instruction:")) return raw;
  if (raw.startsWith("plugin-config:")) return selectorForPluginConfig(raw.slice("plugin-config:".length));
  if (raw.startsWith("plugin-skill:")) {
    const [pluginId, skillId] = raw.slice("plugin-skill:".length).split("/");
    if (pluginId !== undefined && skillId !== undefined) return selectorForPluginSkill(pluginId, skillId);
  }
  if (raw.startsWith("plugin-feature:")) {
    const [pluginId, featureKey] = raw.slice("plugin-feature:".length).split("/");
    if (pluginId !== undefined && featureKey !== undefined) return selectorForPluginFeature(pluginId, featureKey);
  }
  if (raw.startsWith("plugin-companion:")) {
    const [pluginId, ...pathParts] = raw.slice("plugin-companion:".length).split("/");
    const companionPath = pathParts.join("/");
    if (pluginId !== undefined && companionPath.length > 0) return selectorForPluginCompanion(pluginId, companionPath);
  }
  if (raw.startsWith("target-native-island:")) {
    const [target, ownerKind, ownerIdOrPath, ...pathParts] = raw.slice("target-native-island:".length).split(":");
    if (target === undefined || ownerKind === undefined || ownerIdOrPath === undefined) return raw;
    if (ownerKind === "project") return selectorForTargetNativeIsland(target, "project", [ownerIdOrPath, ...pathParts].join(":"));
    if (ownerKind === "plugin") {
      const relativePath = pathParts.join(":");
      if (relativePath.length > 0) return selectorForTargetNativeIsland(target, `plugin:${ownerIdOrPath}`, relativePath);
    }
  }
  return sourceUnitSelector(raw);
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
