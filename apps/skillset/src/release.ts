import { appendFile, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createHash, randomBytes } from "node:crypto";
import { dirname, join } from "node:path";

import { buildSkillsetResult } from "@skillset/core";
import { changeCheck, readPendingChangeEntries, type ChangeBump, type PendingChangeEntry } from "./change-entries";
import { resolveChangeReason, type ChangeReasonInput } from "./change-workflow";
import { detectWorkspaceOptions, SOURCE_HASH_SCHEMA } from "./change-status";
import { compareStrings, resolveInside } from "@skillset/core/internal/path";
import { readReleaseState, writeReleaseState } from "@skillset/core/internal/release-state";
import { loadBuildGraph } from "@skillset/core/internal/resolver";
import {
  pluginIdForSelector,
  pluginScopeFromSourceUnit,
  sourceUnitSelector,
} from "@skillset/core/internal/source-unit-selector";
import type { BuildGraph, JsonRecord, ReleaseScopeState, ReleaseState, SkillsetOptions, SourcePlugin } from "@skillset/core/internal/types";
import { pluginVersion, rootVersion, skillVersion } from "@skillset/core/internal/versioning";
import { workspaceChangeFile } from "@skillset/core";

export type ReleaseSubcommand = "amend" | "apply" | "audit" | "plan";

export interface ReleaseEntryPlan {
  readonly bump: ChangeBump;
  readonly id: string;
  readonly ignored: boolean;
  readonly path: string;
  readonly reason: string;
  readonly ref: string;
  readonly scopes: readonly string[];
}

export interface ReleaseScopePlan {
  readonly bump: ChangeBump;
  readonly currentVersion: string;
  readonly entries: readonly string[];
  readonly nextVersion: string;
  readonly removed: boolean;
  readonly scope: string;
  readonly sourceHash?: string;
}

export interface ReleasePlanReport {
  readonly baselineScopes: readonly ReleaseScopePlan[];
  readonly entries: readonly ReleaseEntryPlan[];
  readonly ignoredEntries: readonly ReleaseEntryPlan[];
  readonly releaseId?: string;
  readonly scopes: readonly ReleaseScopePlan[];
}

export interface ReleaseApplyReport {
  readonly files: readonly string[];
  readonly plan: ReleasePlanReport;
  readonly renderedFiles: number;
}

export interface ReleaseAmendOptions extends SkillsetOptions {
  readonly reason: ChangeReasonInput;
  readonly ref: string;
}

export interface ReleaseRecordView {
  readonly appliedAt?: string;
  readonly entries: readonly string[];
  readonly id: string;
  readonly notes?: string;
  readonly path: string;
  readonly ref: string;
  readonly scopes: readonly ReleaseRecordScope[];
}

export interface ReleaseAmendReport {
  readonly amendmentPath: string;
  readonly release: ReleaseRecordView;
}

export interface ReleaseRecordScope {
  readonly bump?: ChangeBump;
  readonly entries: readonly string[];
  readonly nextVersion?: string;
  readonly previousVersion?: string;
  readonly scope: string;
  readonly sourceHash?: string;
}

interface ReleaseScopeAccumulator {
  bump: ChangeBump;
  entries: Set<string>;
}

interface FileSnapshot {
  readonly content?: Uint8Array;
  readonly path: string;
}

const HISTORY_FILE = "history.jsonl";
const RELEASES_FILE = "releases.jsonl";
const RELEASE_AMENDMENTS_FILE = "release-amendments.jsonl";
const LEDGER_FILE = "ledger.jsonl";
const STATE_FILE = "state.json";
const MIN_REF_LENGTH = 6;
const BUMP_WEIGHT: Readonly<Record<ChangeBump, number>> = {
  none: 0,
  patch: 1,
  minor: 2,
  major: 3,
};

export async function planRelease(
  rootPath: string,
  options: SkillsetOptions = {}
): Promise<ReleasePlanReport> {
  const releaseOptions = await detectWorkspaceOptions(rootPath, options);
  const graph = await loadBuildGraph(rootPath, releaseOptions);
  const pending = await readPendingChangeEntries(rootPath, releaseOptions);
  if (pending.length === 0) return { baselineScopes: [], entries: [], ignoredEntries: [], scopes: [] };

  const check = await changeCheck(rootPath, releaseOptions);
  const errors = check.issues.filter((issue) => issue.severity === "error");
  if (errors.length > 0) {
    throw new Error(
      `skillset: release plan requires valid pending change entries\n` +
        errors.map((issue) => `${issue.path ?? "change"}: ${issue.code}: ${issue.message}`).join("\n")
    );
  }

  const sourceUnits = new Map(check.status.sourceUnits.map((unit) => [unit.id, unit]));
  const sourceChanges = new Map(check.status.sourceChanges.map((change) => [change.id, change]));
  const entries = check.entries.flatMap((entry) => releaseEntryPlan(entry));
  const activeEntries = entries.filter((entry) => !entry.ignored);
  const ignoredEntries = entries.filter((entry) => entry.ignored);
  const scopes = releaseScopePlans(graph, sourceUnits, sourceChanges, activeEntries, { bumpEntries: true });
  const baselineScopes = mergeScopePlans(
    releaseScopePlans(graph, sourceUnits, sourceChanges, ignoredEntries, { bumpEntries: false }),
    scopes
  );
  return {
    baselineScopes,
    entries,
    ignoredEntries,
    ...(scopes.length === 0 ? {} : { releaseId: releaseIdFor(scopes) }),
    scopes,
  };
}

export async function applyRelease(
  rootPath: string,
  options: SkillsetOptions = {}
): Promise<ReleaseApplyReport> {
  const releaseOptions = await detectWorkspaceOptions(rootPath, options);
  const plan = await planRelease(rootPath, releaseOptions);
  if (plan.entries.length === 0) {
    return { files: [], plan, renderedFiles: 0 };
  }

  const now = new Date().toISOString();
  const files = new Set<string>();
  const pending = (await changeCheck(rootPath, releaseOptions)).entries;
  const snapshots = await snapshotReleaseFiles(rootPath, releaseOptions.sourceDir, pending, plan.baselineScopes.length > 0);
  let renderedFiles = 0;
  try {
    await appendHistory(rootPath, releaseOptions.sourceDir, pending, now, files);

    if (plan.baselineScopes.length > 0) {
      const state = await readReleaseState(rootPath, releaseOptions);
      const statePath = await writeReleaseState(rootPath, nextReleaseState(state, plan.baselineScopes, now), releaseOptions);
      files.add(statePath);
      await appendReleaseAppliedLedgerEvent(rootPath, releaseOptions.sourceDir, plan, now, files);
    }
    if (plan.scopes.length > 0) {
      await appendReleaseRecord(rootPath, releaseOptions.sourceDir, plan, now, files);
    }

    const build = await buildSkillsetResult(rootPath, releaseOptions);
    renderedFiles = build.data.length;
    for (const path of build.writes.paths) files.add(path);
    if (build.writes.backupManifestPath !== undefined) {
      files.add(build.writes.backupManifestPath);
    }
  } catch (error) {
    await restoreSnapshots(rootPath, snapshots);
    throw error;
  }

  for (const entry of pending) {
    await rm(resolveInside(rootPath, entry.path), { force: true });
    files.add(entry.path);
  }

  return { files: [...files].sort(compareStrings), plan, renderedFiles };
}

export async function amendReleaseRecord(
  rootPath: string,
  options: ReleaseAmendOptions
): Promise<ReleaseAmendReport> {
  const storageOptions = await detectWorkspaceOptions(rootPath, options);
  const records = await readReleaseRecords(rootPath, storageOptions);
  const amendments = await readReleaseAmendments(rootPath, storageOptions);
  const release = releaseView(resolveReleaseRef(records, options.ref), releaseRefIndex(records), amendments);
  const notes = await resolveChangeReason(rootPath, options.reason);
  const now = new Date().toISOString();
  const amendmentPath = workspaceChangeFile(storageOptions.sourceDir, RELEASE_AMENDMENTS_FILE);
  const absolutePath = resolveInside(rootPath, amendmentPath);
  await mkdir(dirname(absolutePath), { recursive: true });
  await appendFile(absolutePath, `${JSON.stringify({
    amendedAt: now,
    id: release.id,
    notes,
    ...(release.notes === undefined ? {} : { previousNotes: release.notes }),
    source: release.path,
  })}\n`, "utf8");
  const updatedAmendments = await readReleaseAmendments(rootPath, storageOptions);
  return {
    amendmentPath,
    release: releaseView(resolveReleaseRef(records, release.id), releaseRefIndex(records), updatedAmendments),
  };
}

function releaseEntryPlan(entry: PendingChangeEntry): readonly ReleaseEntryPlan[] {
  if (entry.id === undefined || entry.bump === undefined) return [];
  return [{
    bump: entry.bump,
    id: entry.id,
    ignored: entry.ignored,
    path: entry.path,
    reason: entry.reason,
    ref: `@${entry.id.slice(0, 6)}`,
    scopes: entry.scopes.map(sourceUnitSelector),
  }];
}

function releaseScopePlans(
  graph: BuildGraph,
  sourceUnits: ReadonlyMap<string, { readonly hash: string }>,
  sourceChanges: ReadonlyMap<string, { readonly baselineHash?: string; readonly currentHash?: string; readonly status: string }>,
  entries: readonly ReleaseEntryPlan[],
  options: { readonly bumpEntries: boolean }
): readonly ReleaseScopePlan[] {
  const accumulators = new Map<string, ReleaseScopeAccumulator>();
  for (const entry of entries) {
    for (const scope of entry.scopes) {
      addScope(accumulators, scope, entry, options);
      const aggregate = aggregateScope(scope);
      if (aggregate !== undefined && aggregate !== scope) addScope(accumulators, aggregate, entry, options);
    }
  }

  return [...accumulators.entries()]
    .map(([scope, item]): ReleaseScopePlan => {
      const currentVersion = versionForScope(graph, scope);
      const nextVersion = bumpVersion(currentVersion, item.bump);
      const change = sourceChanges.get(scope);
      const sourceHash = sourceUnits.get(scope)?.hash ?? change?.currentHash ?? change?.baselineHash;
      const removed = change?.status === "removed";
      return {
        bump: item.bump,
        currentVersion,
        entries: [...item.entries].sort(compareStrings),
        nextVersion,
        removed,
        scope,
        ...(removed || sourceHash === undefined ? {} : { sourceHash }),
      };
    })
    .sort((left, right) => compareStrings(left.scope, right.scope));
}

function addScope(
  accumulators: Map<string, ReleaseScopeAccumulator>,
  scope: string,
  entry: ReleaseEntryPlan,
  options: { readonly bumpEntries: boolean }
): void {
  const bump = options.bumpEntries ? entry.bump : "none";
  const current = accumulators.get(scope);
  if (current === undefined) {
    accumulators.set(scope, { bump, entries: new Set([entry.id]) });
    return;
  }
  current.bump = maxBump(current.bump, bump);
  current.entries.add(entry.id);
}

function mergeScopePlans(
  left: readonly ReleaseScopePlan[],
  right: readonly ReleaseScopePlan[]
): readonly ReleaseScopePlan[] {
  const scopes = new Map<string, ReleaseScopePlan>();
  for (const scope of left) scopes.set(scope.scope, scope);
  for (const scope of right) scopes.set(scope.scope, scope);
  return [...scopes.values()].sort((a, b) => compareStrings(a.scope, b.scope));
}

function aggregateScope(scope: string): string | undefined {
  return pluginScopeFromSourceUnit(scope);
}

function maxBump(left: ChangeBump, right: ChangeBump): ChangeBump {
  return BUMP_WEIGHT[right] > BUMP_WEIGHT[left] ? right : left;
}

function bumpVersion(version: string, bump: ChangeBump): string {
  const match = version.match(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(.*)$/);
  if (match === null || bump === "none") return version;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  if (bump === "major") return `${major + 1}.0.0`;
  if (bump === "minor") return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

function versionForScope(graph: BuildGraph, scope: string): string {
  const selector = sourceUnitSelector(scope);
  const releaseScope = graph.releaseState.scopes[selector];
  const releasedVersion = releaseScope?.removed === true ? undefined : releaseScope?.version;
  if (releasedVersion !== undefined) return releasedVersion;
  if (selector === "config:root") return rootVersion(graph);
  if (selector.startsWith("skill:")) {
    const skill = graph.standaloneSkills.find((item) => item.id === selector.slice("skill:".length));
    if (skill !== undefined) return skillVersion(graph, undefined, skill);
  }
  if (selector.startsWith("plugin:")) {
    const plugin = pluginForScope(graph, selector);
    if (plugin !== undefined) return pluginVersion(graph, plugin);
  }
  const pluginSkill = selector.match(/^plugin\.([^.]+)\.skill:(.+)$/);
  if (pluginSkill !== null) {
    const [, pluginId, skillId] = pluginSkill;
    const plugin = pluginId === undefined ? undefined : graph.plugins.find((item) => item.id === pluginId);
    const skill = plugin?.skills.find((item) => item.id === skillId);
    if (plugin !== undefined && skill !== undefined) return skillVersion(graph, plugin, skill);
  }
  const pluginId = pluginIdForSelector(selector);
  if (pluginId !== undefined) {
    const plugin = graph.plugins.find((item) => item.id === pluginId);
    if (plugin !== undefined) return pluginVersion(graph, plugin);
  }
  return rootVersion(graph);
}

function pluginForScope(graph: BuildGraph, scope: string): SourcePlugin | undefined {
  const pluginId = pluginIdForSelector(scope);
  return pluginId === undefined ? undefined : graph.plugins.find((plugin) => plugin.id === pluginId);
}

function nextReleaseState(
  state: ReleaseState,
  scopesToWrite: readonly ReleaseScopePlan[],
  updatedAt: string
): ReleaseState {
  const scopes: Record<string, ReleaseScopeState> = { ...state.scopes };
  for (const scope of scopesToWrite) {
    scopes[sourceUnitSelector(scope.scope)] = {
      ...(scope.removed ? { removed: true } : {}),
      ...(scope.sourceHash === undefined ? {} : { sourceHash: scope.sourceHash }),
      updatedAt,
      version: scope.nextVersion,
    };
  }
  return { scopes };
}

async function appendHistory(
  rootPath: string,
  sourceDir: string | undefined,
  entries: readonly PendingChangeEntry[],
  appliedAt: string,
  files: Set<string>
): Promise<void> {
  if (entries.length === 0) return;
  const relativePath = workspaceChangeFile(sourceDir, HISTORY_FILE);
  const absolutePath = resolveInside(rootPath, relativePath);
  await mkdir(dirname(absolutePath), { recursive: true });
  const lines = entries.flatMap((entry) => entry.id === undefined || entry.bump === undefined ? [] : [
    JSON.stringify({
      appliedAt,
      bump: entry.bump,
      ...(entry.group === undefined ? {} : { group: groupJson(entry.group) }),
      id: entry.id,
      ...(entry.ignored ? { ignored: true } : {}),
      reason: entry.reason,
      scopes: [...entry.scopes],
      evidence: historyEvidence(entry),
    }),
  ]);
  if (lines.length === 0) return;
  await appendFile(absolutePath, `${lines.join("\n")}\n`, "utf8");
  files.add(relativePath);
}

async function appendReleaseRecord(
  rootPath: string,
  sourceDir: string | undefined,
  plan: ReleasePlanReport,
  appliedAt: string,
  files: Set<string>
): Promise<void> {
  if (plan.scopes.length === 0) return;
  const relativePath = workspaceChangeFile(sourceDir, RELEASES_FILE);
  const absolutePath = resolveInside(rootPath, relativePath);
  await mkdir(dirname(absolutePath), { recursive: true });
  await appendFile(absolutePath, `${JSON.stringify({
    appliedAt,
    baseline: { hashSchema: SOURCE_HASH_SCHEMA, kind: "source-hashes" },
    entries: plan.entries.filter((entry) => !entry.ignored).map((entry) => entry.id).sort(compareStrings),
    id: plan.releaseId,
    scopes: plan.scopes.map((scope) => ({
      bump: scope.bump,
      entries: [...scope.entries],
      nextVersion: scope.nextVersion,
      previousVersion: scope.currentVersion,
      scope: scope.scope,
      ...(scope.sourceHash === undefined ? {} : { sourceHash: scope.sourceHash }),
    })),
  })}\n`, "utf8");
  files.add(relativePath);
}

async function appendReleaseAppliedLedgerEvent(
  rootPath: string,
  sourceDir: string | undefined,
  plan: ReleasePlanReport,
  appliedAt: string,
  files: Set<string>
): Promise<void> {
  const relativePath = workspaceChangeFile(sourceDir, LEDGER_FILE);
  const absolutePath = resolveInside(rootPath, relativePath);
  const releaseId = plan.releaseId ?? releaseIdFor(plan.baselineScopes);
  await mkdir(dirname(absolutePath), { recursive: true });
  await appendFile(absolutePath, `${JSON.stringify({
    createdAt: appliedAt,
    id: ledgerEventId("release.applied", releaseId),
    payload: {
      changeIds: plan.entries.map((entry) => entry.id).sort(compareStrings),
      releaseId,
      scopes: ledgerReleaseScopes(plan.baselineScopes),
      sourceUnits: ledgerSourceUnits(plan.baselineScopes),
    },
    schemaVersion: 1,
    type: "release.applied",
  })}\n`, "utf8");
  files.add(relativePath);
}

function ledgerReleaseScopes(scopes: readonly ReleaseScopePlan[]): readonly JsonRecord[] {
  return scopes.map((scope) => ({
    bump: scope.bump,
    changeIds: [...scope.entries].sort(compareStrings),
    hashSchema: SOURCE_HASH_SCHEMA,
    previousVersion: scope.currentVersion,
    ...(scope.removed ? { removed: true } : {}),
    selector: sourceUnitSelector(scope.scope),
    ...(scope.sourceHash === undefined ? {} : { sourceHash: scope.sourceHash }),
    version: scope.nextVersion,
  }));
}

function ledgerSourceUnits(scopes: readonly ReleaseScopePlan[]): readonly JsonRecord[] {
  return scopes.map((scope) => ({
    hashSchema: SOURCE_HASH_SCHEMA,
    selector: sourceUnitSelector(scope.scope),
    ...(scope.sourceHash === undefined ? {} : { sourceHash: scope.sourceHash }),
  }));
}

function ledgerEventId(type: string, releaseId: string): string {
  const hash = createHash("sha256");
  hash.update(type);
  hash.update("\0");
  hash.update(releaseId);
  hash.update("\0");
  hash.update(String(Date.now()));
  hash.update("\0");
  hash.update(randomBytes(16));
  return `evt-${hash.digest("hex").slice(0, 16)}`;
}

async function snapshotReleaseFiles(
  rootPath: string,
  sourceDir: string | undefined,
  entries: readonly PendingChangeEntry[],
  includeReleaseState: boolean
): Promise<readonly FileSnapshot[]> {
  const paths = new Set<string>([
    workspaceChangeFile(sourceDir, LEDGER_FILE),
    workspaceChangeFile(sourceDir, HISTORY_FILE),
    ...entries.map((entry) => entry.path),
  ]);
  if (includeReleaseState) {
    paths.add(workspaceChangeFile(sourceDir, STATE_FILE));
    paths.add(workspaceChangeFile(sourceDir, RELEASES_FILE));
  }

  const snapshots: FileSnapshot[] = [];
  for (const path of [...paths].sort(compareStrings)) {
    const absolutePath = resolveInside(rootPath, path);
    snapshots.push({
      ...(await exists(absolutePath) ? { content: await readFile(absolutePath) } : {}),
      path,
    });
  }
  return snapshots;
}

async function restoreSnapshots(rootPath: string, snapshots: readonly FileSnapshot[]): Promise<void> {
  for (const snapshot of snapshots) {
    const absolutePath = resolveInside(rootPath, snapshot.path);
    if (snapshot.content === undefined) {
      await rm(absolutePath, { force: true });
      continue;
    }
    await mkdir(dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, snapshot.content);
  }
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

function historyEvidence(entry: PendingChangeEntry): readonly JsonRecord[] {
  const evidence: JsonRecord[] = [];
  for (const scope of entry.scopes) {
    const selector = sourceUnitSelector(scope);
    for (const sourceHash of entry.sourceHashes.get(selector) ?? entry.sourceHashes.get(scope) ?? []) {
      evidence.push({ scope: selector, sourceHash });
    }
  }
  return evidence;
}

function groupJson(group: NonNullable<PendingChangeEntry["group"]>): JsonRecord {
  return {
    id: group.id,
    ...(group.provider === undefined ? {} : { provider: group.provider }),
  };
}

function releaseIdFor(scopes: readonly ReleaseScopePlan[]): string {
  const hash = createHash("sha256");
  hash.update("skillset-release-v1\0");
  for (const scope of scopes) {
    hash.update(scope.scope);
    hash.update("\0");
    hash.update(scope.nextVersion);
    hash.update("\0");
    hash.update(scope.entries.join("\0"));
    hash.update("\0");
  }
  return hash.digest("hex").slice(0, 12);
}

interface ReleaseRecord {
  readonly appliedAt?: string;
  readonly entries: readonly string[];
  readonly id: string;
  readonly path: string;
  readonly scopes: readonly ReleaseRecordScope[];
}

interface ReleaseAmendmentRecord {
  readonly amendedAt?: string;
  readonly id: string;
  readonly notes: string;
}

async function readReleaseRecords(
  rootPath: string,
  options: SkillsetOptions = {}
): Promise<readonly ReleaseRecord[]> {
  const path = workspaceChangeFile(options.sourceDir, RELEASES_FILE);
  const absolutePath = resolveInside(rootPath, path);
  if (!(await exists(absolutePath))) return [];
  const records: ReleaseRecord[] = [];
  const lines = (await readFile(absolutePath, "utf8")).split("\n");
  for (const [index, line] of lines.entries()) {
    if (line.trim().length === 0) continue;
    const parsed = parseJsonLine(line, `${path}:${index + 1}`);
    const id = readStringField(parsed, "id", `${path}:${index + 1}`);
    const entries = readStringArrayField(parsed, "entries", `${path}:${index + 1}`);
    const scopes = readReleaseScopeArray(parsed, `${path}:${index + 1}`);
    records.push({
      ...(typeof parsed.appliedAt === "string" ? { appliedAt: parsed.appliedAt } : {}),
      entries,
      id,
      path,
      scopes,
    });
  }
  return records;
}

async function readReleaseAmendments(
  rootPath: string,
  options: SkillsetOptions = {}
): Promise<ReadonlyMap<string, ReleaseAmendmentRecord>> {
  const path = workspaceChangeFile(options.sourceDir, RELEASE_AMENDMENTS_FILE);
  const absolutePath = resolveInside(rootPath, path);
  if (!(await exists(absolutePath))) return new Map();
  const amendments = new Map<string, ReleaseAmendmentRecord>();
  const lines = (await readFile(absolutePath, "utf8")).split("\n");
  for (const [index, line] of lines.entries()) {
    if (line.trim().length === 0) continue;
    const parsed = parseJsonLine(line, `${path}:${index + 1}`);
    const id = readStringField(parsed, "id", `${path}:${index + 1}`);
    const notes = readStringField(parsed, "notes", `${path}:${index + 1}`);
    amendments.set(id, {
      ...(typeof parsed.amendedAt === "string" ? { amendedAt: parsed.amendedAt } : {}),
      id,
      notes,
    });
  }
  return amendments;
}

function resolveReleaseRef(records: readonly ReleaseRecord[], ref: string): ReleaseRecord {
  const normalized = ref.startsWith("@") ? ref.slice(1) : ref;
  if (normalized.length < MIN_REF_LENGTH) {
    throw new Error(`skillset: release ref ${ref} must include at least ${MIN_REF_LENGTH} characters`);
  }
  const matches = records.filter((record) => record.id === normalized || record.id.startsWith(normalized));
  if (matches.length === 0) throw new Error(`skillset: unknown release ref ${ref}`);
  if (matches.length > 1) {
    throw new Error(`skillset: ambiguous release ref ${ref}; matches ${matches.map((record) => `@${record.id.slice(0, MIN_REF_LENGTH)}`).join(", ")}`);
  }
  const [record] = matches;
  if (record === undefined) throw new Error(`skillset: unknown release ref ${ref}`);
  return record;
}

function releaseRefIndex(records: readonly ReleaseRecord[]): ReadonlyMap<string, string> {
  const refs = new Map<string, string>();
  for (const record of records) refs.set(record.id, `@${record.id.slice(0, MIN_REF_LENGTH)}`);
  return refs;
}

function releaseView(
  record: ReleaseRecord,
  refs: ReadonlyMap<string, string>,
  amendments: ReadonlyMap<string, ReleaseAmendmentRecord>
): ReleaseRecordView {
  const notes = amendments.get(record.id)?.notes;
  return {
    ...(record.appliedAt === undefined ? {} : { appliedAt: record.appliedAt }),
    entries: record.entries,
    id: record.id,
    ...(notes === undefined ? {} : { notes }),
    path: record.path,
    ref: refs.get(record.id) ?? `@${record.id}`,
    scopes: record.scopes,
  };
}

function readReleaseScopeArray(record: JsonRecord, location: string): readonly ReleaseRecordScope[] {
  if (!Array.isArray(record.scopes)) throw new Error(`skillset: release record ${location} scopes must be an array`);
  return record.scopes.map((item, index): ReleaseRecordScope => {
    const scopeLocation = `${location}.scopes[${index}]`;
    if (!isRecord(item)) throw new Error(`skillset: release record ${scopeLocation} must be an object`);
    const scope = readStringField(item, "scope", scopeLocation);
    return {
      ...(isChangeBump(item.bump) ? { bump: item.bump } : {}),
      entries: Array.isArray(item.entries) ? item.entries.filter((entry): entry is string => typeof entry === "string") : [],
      ...(typeof item.nextVersion === "string" ? { nextVersion: item.nextVersion } : {}),
      ...(typeof item.previousVersion === "string" ? { previousVersion: item.previousVersion } : {}),
      scope,
      ...(typeof item.sourceHash === "string" ? { sourceHash: item.sourceHash } : {}),
    };
  });
}

function readStringArrayField(record: JsonRecord, field: string, location: string): readonly string[] {
  const value = record[field];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`skillset: release record ${location} ${field} must be an array of strings`);
  }
  return value.map((item) => String(item));
}

function readStringField(record: JsonRecord, field: string, location: string): string {
  const value = record[field];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`skillset: release record ${location} ${field} must be a string`);
  }
  return value;
}

function parseJsonLine(line: string, location: string): JsonRecord {
  try {
    const parsed = JSON.parse(line) as unknown;
    if (isRecord(parsed)) return parsed;
  } catch {
    // Throw the uniform error below.
  }
  throw new Error(`skillset: invalid release JSON in ${location}`);
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isChangeBump(value: unknown): value is ChangeBump {
  return value === "major" || value === "minor" || value === "patch" || value === "none";
}
