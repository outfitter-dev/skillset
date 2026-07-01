import { readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";

import { validateChangeEntryFrontmatter, type SkillsetSchemaDiagnostic } from "@skillset/schema";

import { readChangeLedger, type ChangeLedgerEvent, type ChangeLedgerSourceUnit } from "./change-ledger";
import {
  changeStatus,
  detectWorkspaceOptions,
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
import { workspaceChangesDir } from "./workspace-state";
import { isJsonRecord, parseMarkdown, parseYamlRecord } from "./yaml";

export type ChangeBump = "major" | "minor" | "none" | "patch";
export type ChangeCheckSeverity = "error" | "warning";

export interface PendingChangeEntry {
  readonly bump: ChangeBump | undefined;
  readonly format: "frontmatter" | "reason";
  readonly group?: ChangeGroup;
  readonly id: string | undefined;
  readonly ignored: boolean;
  readonly path: string;
  readonly reason: string;
  readonly schemaDiagnostics: readonly SkillsetSchemaDiagnostic[];
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

interface PendingLedgerFacts {
  readonly bump?: ChangeBump;
  readonly group?: ChangeGroup;
  readonly ignored: boolean;
  readonly scopes: readonly string[];
  readonly sourceHashes: ReadonlyMap<string, readonly string[]>;
}

interface ReasonOnlyDirectives {
  readonly bump?: ChangeBump;
  readonly group?: ChangeGroup;
  readonly ignored: boolean;
  readonly reason: string;
  readonly scopes: readonly string[];
}

const DEFAULT_REASON_MIN_LENGTH = 40;
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
    const currentRoot = stagedSnapshot ?? rootPath;
    const storageOptions = await detectWorkspaceOptions(currentRoot, options);
    const entries = await readPendingChangeEntries(currentRoot, storageOptions);
    return await validateChangeCheck(currentRoot, status, entries, storageOptions);
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
  const changesDir = workspaceChangesDir(options.sourceDir);
  const pendingPath = resolveInside(rootPath, changesDir);
  if (!(await exists(pendingPath))) return [];

  const files = await Array.fromAsync(new Bun.Glob("*.md").scan({ cwd: pendingPath, onlyFiles: true }));
  const ledger = await readPendingLedgerFacts(rootPath, options);
  const entries: PendingChangeEntry[] = [];
  for (const file of files.sort(compareStrings)) {
    const path = join(changesDir, file).replaceAll("\\", "/");
    const absolutePath = resolveInside(rootPath, path);
    const parts = parseMarkdown(await readFile(absolutePath, "utf8"), absolutePath);
    const hasFrontmatter = Object.keys(parts.frontmatter).length > 0;
    if (!hasFrontmatter) {
      const id = idFromReasonFilename(file);
      const directives = readReasonOnlyDirectives(parts.body);
      const ledgerFacts = id === undefined ? undefined : ledger.get(id);
      const group = directives.group ?? ledgerFacts?.group;
      const scopes = directives.scopes.length > 0 ? directives.scopes : ledgerFacts?.scopes ?? [];
      entries.push({
        bump: directives.bump ?? ledgerFacts?.bump,
        format: "reason",
        ...(group === undefined ? {} : { group }),
        id,
        ignored: directives.ignored || ledgerFacts?.ignored === true,
        path,
        reason: directives.reason,
        schemaDiagnostics: [],
        scopes,
        sourceHashes: ledgerFacts?.sourceHashes ?? new Map(),
      });
      continue;
    }

    const schemaDiagnostics = validateChangeEntryFrontmatter(parts.frontmatter, path).diagnostics;
    const id = readString(parts.frontmatter, "id");
    const bump = readBump(parts.frontmatter.bump);
    const ignored = parts.frontmatter.ignored === true;
    const scopes = readScopes(parts.frontmatter);
    const group = readGroup(parts.frontmatter.group);
    const sourceHashes = readSourceHashEvidence(parts.frontmatter.evidence, scopes);
    entries.push({
      bump,
      format: "frontmatter",
      ...(group === undefined ? {} : { group }),
      id,
      ignored,
      path,
      reason: parts.body.trim(),
      schemaDiagnostics,
      scopes,
      sourceHashes,
    });
  }
  return entries.sort((left, right) => compareStrings(left.path, right.path));
}

async function readPendingLedgerFacts(
  rootPath: string,
  options: ChangeStatusOptions
): Promise<ReadonlyMap<string, PendingLedgerFacts>> {
  const mutable = new Map<
    string,
    {
      bump?: ChangeBump;
      group?: ChangeGroup;
      ignored: boolean;
      sourceHashes: Map<string, string[]>;
    }
  >();

  const mutableFacts = (reasonId: string): {
    bump?: ChangeBump;
    group?: ChangeGroup;
    ignored: boolean;
    sourceHashes: Map<string, string[]>;
  } => {
    const existing = mutable.get(reasonId);
    if (existing !== undefined) return existing;
    const created = { ignored: false, sourceHashes: new Map<string, string[]>() };
    mutable.set(reasonId, created);
    return created;
  };

  const addSourceUnits = (reasonId: string, units: readonly ChangeLedgerSourceUnit[]): void => {
    const facts = mutableFacts(reasonId);
    for (const unit of units) {
      if (unit.sourceHash === undefined) continue;
      const current = facts.sourceHashes.get(unit.selector) ?? [];
      current.push(unit.sourceHash);
      facts.sourceHashes.set(unit.selector, current);
    }
  };

  for (const event of await readChangeLedger(rootPath, options)) {
    const reasonId = ledgerReasonId(event);
    if (reasonId === undefined) continue;
    const facts = mutableFacts(reasonId);
    if (event.type === "reason.created") {
      if (event.payload.bump !== undefined) facts.bump = event.payload.bump;
      if (event.payload.group !== undefined) {
        const group = parseGroupDirective(event.payload.group);
        if (group !== undefined) facts.group = group;
      }
      if (event.payload.ignored === true) facts.ignored = true;
    }
    if (event.type === "change.ignored") facts.ignored = true;
    addSourceUnits(reasonId, event.sourceUnits);
  }

  const readonlyFacts = new Map<string, PendingLedgerFacts>();
  for (const [reasonId, facts] of mutable) {
    const sourceHashes = new Map(
      [...facts.sourceHashes]
        .map(([scope, hashes]) => [scope, [...new Set(hashes)].sort(compareStrings)] as const)
        .sort(([left], [right]) => compareStrings(left, right))
    );
    readonlyFacts.set(reasonId, {
      ...(facts.bump === undefined ? {} : { bump: facts.bump }),
      ...(facts.group === undefined ? {} : { group: facts.group }),
      ignored: facts.ignored,
      scopes: [...sourceHashes.keys()].sort(compareStrings),
      sourceHashes,
    });
  }
  return readonlyFacts;
}

function ledgerReasonId(event: ChangeLedgerEvent): string | undefined {
  if ("reasonId" in event.payload) return event.payload.reasonId;
  if (event.type === "change.amended") return event.payload.changeId;
  return undefined;
}

function idFromReasonFilename(file: string): string | undefined {
  const id = file.endsWith(".md") ? file.slice(0, -".md".length) : file;
  return /^[0-9a-f]{12}$/.test(id) ? id : undefined;
}

function readReasonOnlyDirectives(body: string): ReasonOnlyDirectives {
  const reasonLines: string[] = [];
  let bump: ChangeBump | undefined;
  let group: ChangeGroup | undefined;
  let ignored = false;
  const scopes: string[] = [];

  for (const line of body.replaceAll(/\r\n?/g, "\n").split("\n")) {
    const match = /^(Bump|Group|Ignored|Scope|Scopes):\s*(.*?)\s*$/i.exec(line);
    if (match === null) {
      reasonLines.push(line);
      continue;
    }
    const [, rawKey, rawValue = ""] = match;
    if (rawKey === undefined) continue;
    const key = rawKey.toLowerCase();
    if (key === "bump") {
      bump = readBump(rawValue);
      continue;
    }
    if (key === "group") {
      group = parseGroupDirective(rawValue);
      continue;
    }
    if (key === "ignored") {
      ignored = rawValue.toLowerCase() === "true" || rawValue.toLowerCase() === "yes";
      continue;
    }
    for (const value of rawValue.split(",")) {
      const trimmed = value.trim();
      if (trimmed.length > 0) scopes.push(sourceUnitSelector(trimmed));
    }
  }

  return {
    ...(bump === undefined ? {} : { bump }),
    ...(group === undefined ? {} : { group }),
    ignored,
    reason: reasonLines.join("\n").trim(),
    scopes: [...new Set(scopes)].sort(compareStrings),
  };
}

function parseGroupDirective(value: string): ChangeGroup | undefined {
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  const splitIndex = trimmed.indexOf(":");
  if (splitIndex > 0 && splitIndex < trimmed.length - 1) {
    return { provider: trimmed.slice(0, splitIndex), id: trimmed.slice(splitIndex + 1) };
  }
  return { id: trimmed };
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
  const issues: ChangeCheckIssue[] = [...changeEntrySchemaIssues(entry)];
  if (entry.format === "frontmatter") {
    issues.push({
      code: "change-frontmatter-compatibility",
      message: "frontmatter pending entries are compatibility-only; run `skillset change migrate --yes` to convert them to reason-only entries",
      path: entry.path,
      severity: "warning",
    });
  }
  const schemaCodes = new Set(entry.schemaDiagnostics.map((diagnostic) => diagnostic.code));

  if (entry.id === undefined && !schemaCodes.has("schema/change-entry/id")) {
    issues.push(entryError(entry, "change-id-missing", "pending change entry requires id"));
  } else if (entry.id !== undefined && !schemaCodes.has("schema/change-entry/id") && context.duplicateIds.has(entry.id)) {
    issues.push(entryError(entry, "change-id-duplicate", `pending change id ${entry.id} is used by multiple entries`));
  }

  if (entry.scopes.length === 0) {
    if (!hasSchemaPrefix(schemaCodes, "schema/change-entry/scope")) {
      issues.push(entryError(entry, "change-scope-missing", "pending change entry requires scope"));
    }
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

function changeEntrySchemaIssues(entry: PendingChangeEntry): readonly ChangeCheckIssue[] {
  return entry.schemaDiagnostics.map((diagnostic): ChangeCheckIssue => {
    const code = changeEntrySchemaIssueCode(diagnostic);
    return entryError(entry, code, diagnostic.message.replaceAll(`${entry.path}.`, ""));
  });
}

function changeEntrySchemaIssueCode(diagnostic: SkillsetSchemaDiagnostic): string {
  if (diagnostic.code === "schema/change-entry/id") return "change-id-invalid";
  if (diagnostic.code === "schema/change-entry/bump") return "change-bump-missing";
  if (diagnostic.code === "schema/change-entry/scope" || diagnostic.code === "schema/change-entry/scopes") return "change-scope-missing";
  if (diagnostic.code.startsWith("schema/change-entry/group")) return "change-group-invalid";
  if (diagnostic.code === "schema/change-entry/external") return "change-external-unsupported";
  if (diagnostic.code === "schema/change-entry/ignored") return "change-ignored-invalid";
  if (diagnostic.code.startsWith("schema/change-entry/evidence")) return "change-evidence-invalid";
  return "change-entry-invalid";
}

function hasSchemaPrefix(codes: ReadonlySet<string>, prefix: string): boolean {
  for (const code of codes) {
    if (code.startsWith(prefix)) return true;
  }
  return false;
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

async function readReasonMinLength(rootPath: string, _options: ChangeStatusOptions): Promise<number> {
  const configPaths = ["skillset.yaml"];
  const resolvedConfigPath = await firstExistingPath(configPaths.map((path) => resolveInside(rootPath, path)));
  if (resolvedConfigPath === undefined) return DEFAULT_REASON_MIN_LENGTH;
  const config = parseYamlRecord(await readFile(resolvedConfigPath, "utf8"), resolvedConfigPath);
  const changes = config.changes;
  if (!isJsonRecord(changes)) return DEFAULT_REASON_MIN_LENGTH;
  const reason = changes.reason;
  if (!isJsonRecord(reason)) return DEFAULT_REASON_MIN_LENGTH;
  const minLength = reason.minLength;
  return typeof minLength === "number" && Number.isInteger(minLength) && minLength > 0
    ? minLength
    : DEFAULT_REASON_MIN_LENGTH;
}

async function firstExistingPath(paths: readonly string[]): Promise<string | undefined> {
  for (const path of paths) {
    if (await exists(path)) return path;
  }
  return undefined;
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
