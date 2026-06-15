import { readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";

import {
  changeStatus,
  snapshotGitIndex,
  type ChangeStatusOptions,
  type ChangeStatusReport,
  type SourceUnit,
  type SourceUnitChange,
} from "./change-status";
import { readString } from "./config";
import { compareStrings, resolveInside } from "./path";
import { pluginScopeFromSourceUnit, sourceUnitDisplay, sourceUnitSelector } from "./source-unit-selector";
import type { JsonRecord, JsonValue } from "./types";
import { isJsonRecord, parseMarkdown, parseYamlRecord } from "./yaml";

export type ChangeBump = "major" | "minor" | "none" | "patch";
export type ChangeCheckSeverity = "error" | "warning";

export interface PendingChangeEntry {
  readonly bump: ChangeBump | undefined;
  readonly group?: ChangeGroup;
  readonly hasExternal: boolean;
  readonly hasInvalidGroup: boolean;
  readonly id: string | undefined;
  readonly ignored: boolean;
  readonly path: string;
  readonly reason: string;
  readonly scopes: readonly string[];
  readonly sourceHashes: ReadonlyMap<string, readonly string[]>;
}

export interface ChangeGroup {
  readonly id: string;
  readonly provider?: string;
}

export interface ChangeCheckIssue {
  readonly code: string;
  readonly message: string;
  readonly path?: string;
  readonly severity: ChangeCheckSeverity;
}

export interface ChangeCheckOptions extends ChangeStatusOptions {
  readonly ref?: string;
}

export interface ChangeCheckReport {
  readonly entries: readonly PendingChangeEntry[];
  readonly issues: readonly ChangeCheckIssue[];
  readonly ok: boolean;
  readonly stackedEvidence: readonly ChangeCheckStackedEvidence[];
  readonly status: ChangeStatusReport;
}

export interface ChangeCheckStackedEvidence {
  readonly paths: readonly string[];
  readonly scope: string;
  readonly sourceHash: string;
}

interface ChangeValidationContext {
  readonly currentById: ReadonlyMap<string, SourceUnit>;
  readonly changedById: ReadonlyMap<string, SourceUnitChange>;
  readonly duplicateIds: ReadonlySet<string>;
  readonly minReasonLength: number;
  readonly validScopeIds: ReadonlySet<string>;
}

const PENDING_DIR = "changes/pending";
const DEFAULT_REASON_MIN_LENGTH = 40;
const CHANGE_ID_PATTERN = /^[0-9a-f]{12}$/;
const CHANGE_REF_MIN_LENGTH = 6;
const PLACEHOLDER_REASON_PATTERN = /^(todo|tbd|placeholder|none|n\/a|fill me in|write reason)$/i;
const BUMPS = new Set<ChangeBump>(["major", "minor", "none", "patch"]);

export async function changeCheck(
  rootPath: string,
  options: ChangeCheckOptions = {}
): Promise<ChangeCheckReport> {
  const stagedSnapshot = options.staged === true ? await snapshotGitIndex(rootPath) : undefined;
  try {
    const status = await changeStatus(rootPath, options);
    const entries = await readPendingChangeEntries(stagedSnapshot ?? rootPath, options);
    return await validateChangeCheck(stagedSnapshot ?? rootPath, status, entries, options);
  } finally {
    if (stagedSnapshot !== undefined) await rm(stagedSnapshot, { force: true, recursive: true });
  }
}

async function validateChangeCheck(
  rootPath: string,
  status: ChangeStatusReport,
  entries: readonly PendingChangeEntry[],
  options: ChangeCheckOptions
): Promise<ChangeCheckReport> {
  const currentById = new Map(status.sourceUnits.map((unit) => [unit.id, unit]));
  const changedById = new Map(status.sourceChanges.map((change) => [change.id, change]));
  const validScopeIds = new Set([...currentById.keys(), ...changedById.keys()]);
  const context: ChangeValidationContext = {
    currentById,
    changedById,
    duplicateIds: findDuplicateIds(entries),
    minReasonLength: await readReasonMinLength(rootPath, options),
    validScopeIds,
  };
  const issues: ChangeCheckIssue[] = [];
  const validEntries = new Set<PendingChangeEntry>();

  const refEntries = options.ref === undefined ? entries : [resolvePendingChangeRef(entries, options.ref)];
  for (const entry of refEntries) {
    const entryIssues = validatePendingEntry(entry, context);
    issues.push(...entryIssues);
    if (!entryIssues.some((issue) => issue.severity === "error")) {
      validEntries.add(entry);
    }
  }

  if (options.ref === undefined) {
    const covered = new Set<string>();
    for (const entry of validEntries) {
      for (const scope of entry.scopes) {
        covered.add(scope);
        for (const impliedScope of impliedCoveredScopes(scope)) covered.add(impliedScope);
      }
    }
    for (const change of status.sourceChanges) {
      if (covered.has(change.id)) continue;
      issues.push({
        code: "change-uncovered",
        message: `source change ${sourceUnitDisplay(change.id)} is missing a pending change entry`,
        severity: "error",
      });
    }
  }

  for (const entry of validEntries) {
    issues.push(...suggestBumpWarnings(entry, context));
  }

  return {
    entries,
    issues: issues.sort(compareIssues),
    ok: !issues.some((issue) => issue.severity === "error"),
    stackedEvidence: stackedEvidenceGroups(validEntries, context),
    status,
  };
}

function impliedCoveredScopes(scope: string): readonly string[] {
  const pluginScope = pluginScopeFromSourceUnit(scope);
  return pluginScope === undefined || pluginScope === sourceUnitSelector(scope) ? [] : [pluginScope];
}

export async function readPendingChangeEntries(
  rootPath: string,
  options: ChangeStatusOptions = {}
): Promise<readonly PendingChangeEntry[]> {
  const sourceDir = options.sourceDir ?? ".skillset";
  const pendingPath = resolveInside(rootPath, join(sourceDir, PENDING_DIR));
  if (!(await exists(pendingPath))) return [];

  const files = await Array.fromAsync(new Bun.Glob("*.md").scan({ cwd: pendingPath, onlyFiles: true }));
  const entries: PendingChangeEntry[] = [];
  for (const file of files.sort(compareStrings)) {
    const path = join(sourceDir, PENDING_DIR, file).replaceAll("\\", "/");
    const absolutePath = resolveInside(rootPath, path);
    const parts = parseMarkdown(await readFile(absolutePath, "utf8"), absolutePath);
    const id = readString(parts.frontmatter, "id");
    const bump = readBump(parts.frontmatter.bump);
    const ignored = parts.frontmatter.ignored === true;
    const scopes = readScopes(parts.frontmatter);
    const group = readGroup(parts.frontmatter.group);
    const sourceHashes = readSourceHashEvidence(parts.frontmatter.evidence, scopes);
    entries.push({
      bump,
      ...(group === undefined ? {} : { group }),
      hasExternal: parts.frontmatter.external !== undefined,
      hasInvalidGroup: parts.frontmatter.group !== undefined && group === undefined,
      id,
      ignored,
      path,
      reason: parts.body.trim(),
      scopes,
      sourceHashes,
    });
  }
  return entries.sort((left, right) => compareStrings(left.path, right.path));
}

export function resolvePendingChangeRef(
  entries: readonly PendingChangeEntry[],
  rawRef: string
): PendingChangeEntry {
  const prefix = rawRef.startsWith("@") ? rawRef.slice(1) : rawRef;
  if (!/^[0-9a-f]+$/.test(prefix)) {
    throw new Error(`skillset: expected change ref to look like @<hex-prefix>, received ${JSON.stringify(rawRef)}`);
  }
  if (prefix.length < CHANGE_REF_MIN_LENGTH) {
    throw new Error(`skillset: expected change ref @${prefix} to use at least ${CHANGE_REF_MIN_LENGTH} hex characters`);
  }
  const candidates = entries.filter((entry) => entry.id?.startsWith(prefix));
  if (candidates.length === 0) {
    throw new Error(`skillset: no pending change entry matches @${prefix}`);
  }
  if (candidates.length > 1) {
    throw new Error(
      `skillset: ambiguous change ref @${prefix}; candidates: ${candidates.map((entry) => `@${entry.id}`).join(", ")}`
    );
  }
  const [entry] = candidates;
  if (entry === undefined) {
    throw new Error(`skillset: no pending change entry matches @${prefix}`);
  }
  return entry;
}

function validatePendingEntry(
  entry: PendingChangeEntry,
  context: ChangeValidationContext
): readonly ChangeCheckIssue[] {
  const issues: ChangeCheckIssue[] = [];

  if (entry.id === undefined) {
    issues.push(entryError(entry, "change-id-missing", "pending change entry requires id"));
  } else if (!CHANGE_ID_PATTERN.test(entry.id)) {
    issues.push(entryError(entry, "change-id-invalid", "pending change id must be 12 lower-case hex characters"));
  } else if (context.duplicateIds.has(entry.id)) {
    issues.push(entryError(entry, "change-id-duplicate", `pending change id ${entry.id} is used by multiple entries`));
  }

  if (entry.bump === undefined) {
    issues.push(entryError(entry, "change-bump-missing", "pending change entry requires bump: major, minor, patch, or none"));
  }

  if (entry.scopes.length === 0) {
    issues.push(entryError(entry, "change-scope-missing", "pending change entry requires scope"));
  } else {
    const scopeClasses = new Set(entry.scopes.map(scopeClass));
    if (scopeClasses.size > 1) {
      issues.push(entryError(entry, "change-scope-mixed", "pending change entry must not mix repo/project scopes with user/global scopes"));
    }
    for (const scope of entry.scopes) {
      if (!context.validScopeIds.has(scope)) {
        issues.push(entryError(entry, "change-scope-invalid", `scope ${sourceUnitDisplay(scope)} does not match a known source unit`));
      }
    }
  }

  if (entry.reason.length < context.minReasonLength) {
    issues.push(entryError(entry, "change-reason-too-short", `reason must be at least ${context.minReasonLength} characters`));
  }
  if (PLACEHOLDER_REASON_PATTERN.test(entry.reason.trim())) {
    issues.push(entryError(entry, "change-reason-placeholder", "reason looks like a placeholder"));
  }

  if (entry.group !== undefined && entry.group.id.trim().length === 0) {
    issues.push(entryError(entry, "change-group-invalid", "group id must be non-empty"));
  }
  if (entry.hasInvalidGroup) {
    issues.push(entryError(entry, "change-group-invalid", "group must be a string or an object with id"));
  }
  if (entry.hasExternal) {
    issues.push(entryError(entry, "change-external-unsupported", "external issue ids belong in group"));
  }

  for (const scope of entry.scopes) {
    const expectedHash = expectedHashForScope(scope, context);
    if (expectedHash === undefined) continue;
    const hashes = entry.sourceHashes.get(scope) ?? [];
    if (hashes.length === 0) {
      issues.push(entryError(entry, "change-evidence-missing", `scope ${sourceUnitDisplay(scope)} requires source hash evidence`));
      continue;
    }
    if (!hashes.includes(expectedHash)) {
      issues.push(entryError(entry, "change-evidence-stale", `scope ${sourceUnitDisplay(scope)} source hash evidence is stale`));
    }
  }

  return issues;
}

function suggestBumpWarnings(
  entry: PendingChangeEntry,
  context: ChangeValidationContext
): readonly ChangeCheckIssue[] {
  if (entry.bump !== "none") return [];
  const warnings: ChangeCheckIssue[] = [];
  for (const scope of entry.scopes) {
    const change = context.changedById.get(scope);
    const unit = context.currentById.get(scope);
    const severityBearing =
      change?.status === "added" ||
      change?.status === "removed" ||
      hasSeverityBearingRegion(change?.baselineRegions) ||
      hasSeverityBearingRegion(change?.currentRegions) ||
      unit?.regions.some((region) => region.severityBearing) === true;
    if (!severityBearing) continue;
    warnings.push({
      code: "change-bump-lower-than-suggested",
      message: `scope ${sourceUnitDisplay(scope)} may need a release bump above none`,
      path: entry.path,
      severity: "warning",
    });
  }
  return warnings;
}

function findDuplicateIds(entries: readonly PendingChangeEntry[]): ReadonlySet<string> {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    if (entry.id === undefined) continue;
    counts.set(entry.id, (counts.get(entry.id) ?? 0) + 1);
  }
  return new Set([...counts].filter(([, count]) => count > 1).map(([id]) => id));
}

function stackedEvidenceGroups(
  entries: ReadonlySet<PendingChangeEntry>,
  context: ChangeValidationContext
): readonly ChangeCheckStackedEvidence[] {
  const groups = new Map<string, { readonly paths: Set<string>; readonly scope: string; readonly sourceHash: string }>();
  for (const entry of entries) {
    for (const scope of entry.scopes) {
      const sourceHash = expectedHashForScope(scope, context);
      if (sourceHash === undefined || !(entry.sourceHashes.get(scope) ?? []).includes(sourceHash)) continue;
      const key = `${scope}\0${sourceHash}`;
      const existing = groups.get(key);
      if (existing === undefined) {
        groups.set(key, { paths: new Set([entry.path]), scope, sourceHash });
        continue;
      }
      existing.paths.add(entry.path);
    }
  }
  return [...groups.values()]
    .filter((group) => group.paths.size > 1)
    .map((group) => ({
      paths: [...group.paths].sort(compareStrings),
      scope: group.scope,
      sourceHash: group.sourceHash,
    }))
    .sort((left, right) => compareStrings(`${left.scope}\0${left.sourceHash}`, `${right.scope}\0${right.sourceHash}`));
}

function hasSeverityBearingRegion(regions: readonly { readonly severityBearing: boolean }[] | undefined): boolean {
  return regions?.some((region) => region.severityBearing) === true;
}

function expectedHashForScope(
  scope: string,
  context: ChangeValidationContext
): string | undefined {
  const change = context.changedById.get(scope);
  if (change?.currentHash !== undefined) return change.currentHash;
  if (change?.baselineHash !== undefined) return change.baselineHash;
  return context.currentById.get(scope)?.hash;
}

function entryError(entry: PendingChangeEntry, code: string, message: string): ChangeCheckIssue {
  return { code, message, path: entry.path, severity: "error" };
}

function readScopes(frontmatter: JsonRecord): readonly string[] {
  const scope = frontmatter.scope;
  const scopes = frontmatter.scopes;
  const values: string[] = [];
  if (scope !== undefined) values.push(...readScopeValue(scope));
  if (scopes !== undefined) values.push(...readScopeValue(scopes));
  return [...new Set(values.map((value) => sourceUnitSelector(value.trim())).filter((value) => value.length > 0))].sort(compareStrings);
}

function readScopeValue(value: JsonValue): readonly string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value) && value.every((item) => typeof item === "string")) return value.map((item) => String(item));
  return [];
}

function readBump(value: JsonValue | undefined): ChangeBump | undefined {
  if (typeof value !== "string") return undefined;
  return BUMPS.has(value as ChangeBump) ? value as ChangeBump : undefined;
}

function readGroup(value: JsonValue | undefined): ChangeGroup | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "string") return { id: value };
  if (!isJsonRecord(value)) return undefined;
  const id = readString(value, "id");
  if (id === undefined) return undefined;
  const provider = readString(value, "provider");
  return { id, ...(provider === undefined ? {} : { provider }) };
}

function readSourceHashEvidence(
  raw: JsonValue | undefined,
  scopes: readonly string[]
): ReadonlyMap<string, readonly string[]> {
  const evidence = new Map<string, string[]>();
  const add = (scope: string | undefined, hash: string | undefined): void => {
    if (scope === undefined || hash === undefined) return;
    const normalizedScope = sourceUnitSelector(scope);
    const current = evidence.get(normalizedScope) ?? [];
    current.push(hash);
    evidence.set(normalizedScope, current);
  };

  const singleScope = scopes.length === 1 ? scopes[0] : undefined;
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (!isJsonRecord(item)) continue;
      add(readString(item, "scope") ?? singleScope, readEvidenceHash(item));
    }
    return evidence;
  }
  if (!isJsonRecord(raw)) return evidence;

  const directHash = readEvidenceHash(raw);
  if (directHash !== undefined) add(singleScope, directHash);

  for (const [key, value] of Object.entries(raw)) {
    if (value === undefined || key === "hash" || key === "sourceHash" || key === "currentHash") continue;
    if (typeof value === "string") {
      add(key, value);
    } else if (isJsonRecord(value)) {
      add(key, readEvidenceHash(value));
    }
  }
  return evidence;
}

function readEvidenceHash(record: JsonRecord): string | undefined {
  return readString(record, "hash") ?? readString(record, "sourceHash") ?? readString(record, "currentHash");
}

async function readReasonMinLength(rootPath: string, options: ChangeStatusOptions): Promise<number> {
  const sourceDir = options.sourceDir ?? ".skillset";
  const configPath = resolveInside(rootPath, join(sourceDir, "config.yaml"));
  const config = parseYamlRecord(await readFile(configPath, "utf8"), configPath);
  const changes = config.changes;
  if (!isJsonRecord(changes)) return DEFAULT_REASON_MIN_LENGTH;
  const reason = changes.reason;
  if (!isJsonRecord(reason)) return DEFAULT_REASON_MIN_LENGTH;
  const minLength = reason.minLength;
  return typeof minLength === "number" && Number.isInteger(minLength) && minLength > 0
    ? minLength
    : DEFAULT_REASON_MIN_LENGTH;
}

function scopeClass(scope: string): "repo" | "user" {
  const normalizedScope = sourceUnitSelector(scope);
  return normalizedScope.startsWith("user:") || normalizedScope.startsWith("global:") ? "user" : "repo";
}

function compareIssues(left: ChangeCheckIssue, right: ChangeCheckIssue): number {
  return compareStrings(`${left.path ?? ""}:${left.code}:${left.message}`, `${right.path ?? ""}:${right.code}:${right.message}`);
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
