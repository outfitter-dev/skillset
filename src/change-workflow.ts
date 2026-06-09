import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";

import {
  readPendingChangeEntries,
  resolvePendingChangeRef,
  type ChangeBump,
  type ChangeCheckOptions,
  type ChangeGroup,
  type PendingChangeEntry,
} from "./change-entries";
import { changeStatus, type ChangeStatusOptions, type SourceUnit, type SourceUnitChange } from "./change-status";
import { readString } from "./config";
import { compareStrings, resolveInside } from "./path";
import { sourceUnitSelector } from "./source-unit-selector";
import type { JsonRecord, JsonValue, SkillsetOptions } from "./types";
import { isJsonRecord, parseMarkdown, stringifyMarkdown } from "./yaml";

export type ChangeSubcommand = "add" | "check" | "history" | "list" | "reason" | "show" | "status";

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

export interface ChangeListOptions extends ChangeStatusOptions {
  readonly group?: string;
}

export interface ChangeShowOptions extends ChangeStatusOptions {
  readonly ref: string;
}

export interface ChangeHistoryOptions extends ChangeStatusOptions {
  readonly ref?: string;
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
}

export interface ChangeReasonReport {
  readonly entry: ChangeEntryView;
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

const PENDING_DIR = "changes/pending";
const HISTORY_FILE = "changes/history.jsonl";
const MIN_REF_LENGTH = 6;

export async function addChangeEntry(rootPath: string, options: ChangeAddOptions): Promise<ChangeAddReport> {
  if (options.scopes.length === 0) throw new Error("skillset: change add requires at least one --scope");
  if (options.bump === undefined) throw new Error("skillset: change add requires --bump major, minor, patch, or none");
  const scopes = [...new Set(options.scopes.map(sourceUnitSelector))].sort(compareStrings);
  const reason = await resolveReason(rootPath, options.reason);
  const statusOptions = sourceStatusOptions(options);
  const status = await changeStatus(rootPath, statusOptions);
  const existing = await readAllChangeEntries(rootPath, statusOptions);
  const id = await generateChangeId(rootPath, { ...options, scopes }, existing.map((entry) => entry.id));
  const sourceHashes = new Map<string, readonly string[]>();
  for (const scope of scopes) {
    const hash = sourceHashForScope(scope, status.sourceUnits, status.sourceChanges);
    if (hash === undefined) throw new Error(`skillset: unknown change scope ${scope}`);
    sourceHashes.set(scope, [hash]);
  }

  const sourceDir = options.sourceDir ?? ".skillset";
  const relativePath = join(sourceDir, PENDING_DIR, `${id}.md`).replaceAll("\\", "/");
  const absolutePath = resolveInside(rootPath, relativePath);
  const group = options.group === undefined ? undefined : parseGroupArgument(options.group);
  const entryFrontmatter = pendingFrontmatter({
    bump: options.bump,
    ...(group === undefined ? {} : { group }),
    id,
    scopes,
    sourceHashes,
  });
  await mkdir(resolveInside(rootPath, join(sourceDir, PENDING_DIR)), { recursive: true });
  await writeFile(absolutePath, stringifyMarkdown(entryFrontmatter, reason), "utf8");

  const [entry] = await readPendingChangeEntries(rootPath, statusOptions).then((entries) => entries.filter((item) => item.id === id));
  if (entry === undefined) throw new Error(`skillset: failed to read created change entry ${id}`);
  const refs = refIndex([entry], await readHistoryEntries(rootPath, statusOptions));
  return { entry: pendingView(entry, refs) };
}

export async function updateChangeReason(rootPath: string, options: ChangeReasonOptions): Promise<ChangeReasonReport> {
  const pendingEntries = await readPendingChangeEntries(rootPath, options);
  const entry = resolvePendingChangeRef(pendingEntries, options.ref);
  const newReason = await resolveReason(rootPath, options.reason);
  const absolutePath = resolveInside(rootPath, entry.path);
  const parts = parseMarkdown(await readFile(absolutePath, "utf8"), absolutePath);
  const body = options.append ? `${parts.body.trimEnd()}\n\n${newReason}` : newReason;
  await writeFile(absolutePath, stringifyMarkdown(parts.frontmatter, body), "utf8");
  const updated = resolvePendingChangeRef(await readPendingChangeEntries(rootPath, options), entry.id ?? options.ref);
  const refs = refIndex([updated], await readHistoryEntries(rootPath, options));
  return { entry: pendingView(updated, refs) };
}

export async function listChangeEntries(rootPath: string, options: ChangeListOptions = {}): Promise<ChangeListReport> {
  const pendingEntries = await readPendingChangeEntries(rootPath, options);
  const historyEntries = await readHistoryEntries(rootPath, options);
  const refs = refIndex(pendingEntries, historyEntries);
  const entries = pendingEntries
    .filter((entry) => options.group === undefined || groupMatches(entry.group, options.group))
    .map((entry) => pendingView(entry, refs));
  return { entries };
}

export async function showChangeEntry(rootPath: string, options: ChangeShowOptions): Promise<ChangeShowReport> {
  const resolved = await resolveAnyChangeRef(rootPath, options.ref, options);
  return { entry: resolved };
}

export async function readChangeHistory(rootPath: string, options: ChangeHistoryOptions = {}): Promise<ChangeHistoryReport> {
  const pendingEntries = await readPendingChangeEntries(rootPath, options);
  const historyEntries = await readHistoryEntries(rootPath, options);
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

export async function readAppliedChangeRecords(
  rootPath: string,
  options: ChangeStatusOptions = {}
): Promise<readonly AppliedChangeRecord[]> {
  return readHistoryEntries(rootPath, options);
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

function pendingFrontmatter(input: {
  readonly bump: ChangeBump;
  readonly group?: ChangeGroup;
  readonly id: string;
  readonly scopes: readonly string[];
  readonly sourceHashes: ReadonlyMap<string, readonly string[]>;
}): JsonRecord {
  const evidence = input.scopes.map((scope): JsonRecord => {
    const [sourceHash] = input.sourceHashes.get(scope) ?? [];
    return { scope, sourceHash };
  });
  return {
    bump: input.bump,
    ...(input.group === undefined ? {} : { group: groupJson(input.group) }),
    id: input.id,
    ...(input.scopes.length === 1 ? { scope: input.scopes[0] } : { scopes: [...input.scopes] }),
    evidence,
  };
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
  const sourceDir = options.sourceDir ?? ".skillset";
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
    if (await exists(resolveInside(rootPath, join(sourceDir, PENDING_DIR, `${id}.md`)))) continue;
    return id;
  }
  throw new Error("skillset: failed to generate a unique change id");
}

async function resolveReason(rootPath: string, input: ChangeReasonInput): Promise<string> {
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
  const sourceDir = options.sourceDir ?? ".skillset";
  const path = join(sourceDir, HISTORY_FILE).replaceAll("\\", "/");
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
  return entries.sort((left, right) => compareStrings(left.id, right.id));
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
  return [...new Set(values.map(sourceUnitSelector))].sort(compareStrings);
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
    const normalizedScope = sourceUnitSelector(scope);
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
