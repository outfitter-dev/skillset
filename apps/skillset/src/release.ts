import { appendFile, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";

import { buildSkillset } from "./build";
import { changeCheck, readPendingChangeEntries, type ChangeBump, type PendingChangeEntry } from "./change-entries";
import { SOURCE_HASH_SCHEMA } from "./change-status";
import { compareStrings, resolveInside } from "./path";
import { readReleaseState, writeReleaseState } from "./release-state";
import { loadBuildGraph } from "./resolver";
import {
  pluginIdForSelector,
  pluginScopeFromSourceUnit,
  sourceUnitSelector,
} from "./source-unit-selector";
import type { BuildGraph, JsonRecord, ReleaseScopeState, ReleaseState, SkillsetOptions, SourcePlugin } from "./types";
import { pluginVersion, rootVersion, skillVersion } from "./versioning";

export type ReleaseSubcommand = "apply" | "audit" | "plan";

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

interface ReleaseScopeAccumulator {
  bump: ChangeBump;
  entries: Set<string>;
}

interface FileSnapshot {
  readonly content?: Uint8Array;
  readonly path: string;
}

const HISTORY_FILE = "changes/history.jsonl";
const RELEASES_FILE = "changes/releases.jsonl";
const STATE_FILE = "changes/state.json";
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
  const pending = await readPendingChangeEntries(rootPath, options);
  if (pending.length === 0) return { baselineScopes: [], entries: [], ignoredEntries: [], scopes: [] };

  const check = await changeCheck(rootPath, options);
  const errors = check.issues.filter((issue) => issue.severity === "error");
  if (errors.length > 0) {
    throw new Error(
      `skillset: release plan requires valid pending change entries\n` +
        errors.map((issue) => `${issue.path ?? "change"}: ${issue.code}: ${issue.message}`).join("\n")
    );
  }

  const graph = await loadBuildGraph(rootPath, options);
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
  const plan = await planRelease(rootPath, options);
  if (plan.entries.length === 0) {
    return { files: [], plan, renderedFiles: 0 };
  }

  const sourceDir = options.sourceDir ?? ".skillset";
  const now = new Date().toISOString();
  const files = new Set<string>();
  const pending = (await changeCheck(rootPath, options)).entries;
  const snapshots = await snapshotReleaseFiles(rootPath, sourceDir, pending, plan.baselineScopes.length > 0);
  let renderedFiles = 0;
  try {
    await appendHistory(rootPath, sourceDir, pending, now, files);

    if (plan.baselineScopes.length > 0) {
      const state = await readReleaseState(rootPath, options);
      const statePath = await writeReleaseState(rootPath, nextReleaseState(state, plan.baselineScopes, now), options);
      files.add(statePath);
    }
    if (plan.scopes.length > 0) {
      await appendReleaseRecord(rootPath, sourceDir, plan, now, files);
    }

    const rendered = await buildSkillset(rootPath, options);
    renderedFiles = rendered.length;
    for (const file of rendered) files.add(file.path);
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
  sourceDir: string,
  entries: readonly PendingChangeEntry[],
  appliedAt: string,
  files: Set<string>
): Promise<void> {
  if (entries.length === 0) return;
  const relativePath = join(sourceDir, HISTORY_FILE).replaceAll("\\", "/");
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
  sourceDir: string,
  plan: ReleasePlanReport,
  appliedAt: string,
  files: Set<string>
): Promise<void> {
  if (plan.scopes.length === 0) return;
  const relativePath = join(sourceDir, RELEASES_FILE).replaceAll("\\", "/");
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

async function snapshotReleaseFiles(
  rootPath: string,
  sourceDir: string,
  entries: readonly PendingChangeEntry[],
  includeReleaseState: boolean
): Promise<readonly FileSnapshot[]> {
  const paths = new Set<string>([
    join(sourceDir, HISTORY_FILE).replaceAll("\\", "/"),
    ...entries.map((entry) => entry.path),
  ]);
  if (includeReleaseState) {
    paths.add(join(sourceDir, STATE_FILE).replaceAll("\\", "/"));
    paths.add(join(sourceDir, RELEASES_FILE).replaceAll("\\", "/"));
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
