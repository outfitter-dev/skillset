import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import { isOutputSelected } from "./config";
import { compareStrings } from "./path";
import { pluginIdForSelector } from "./source-unit-selector";
import { loadBuildGraph } from "./resolver";
import { verifySkillsetResult } from "./build";
import { resolveKnownSkillsetWorkspace, type KnownSkillsetEntry } from "./known-skillsets";
import { pluginVersion } from "./versioning";
import type {
  BuildGraph,
  MarketplaceCatalogConfig,
  MarketplacePluginEntryConfig,
  SkillsetOptions,
  SourcePlugin,
  TargetName,
} from "./types";
import type { SkillsetRenderResult } from "./render-result";

const execFileAsync = promisify(execFile);

export type MarketplaceReadinessState =
  | "declared"
  | "floating"
  | "locked"
  | "pinned"
  | "resolved"
  | "renderable"
  | "generated"
  | "verified"
  | "stale"
  | "marketplace-ready"
  | "not-ready";

export type MarketplaceSourceKind = "current" | "known-index" | "unresolved";

export interface MarketplaceCheckReport {
  readonly entries: readonly MarketplaceCheckEntryReport[];
  readonly marketplaces: readonly string[];
  readonly ok: boolean;
}

export interface MarketplaceCheckEntryReport {
  readonly catalog: string;
  readonly entryId: string;
  readonly generatedPath?: string;
  readonly generatedPaths: readonly string[];
  readonly lock: MarketplaceCheckLockReport;
  readonly plugin: string;
  readonly provenance: MarketplaceLockEntry;
  readonly providerSource: string;
  readonly reason: string;
  readonly readiness: "marketplace-ready" | "not-ready";
  readonly repo?: string;
  readonly requestedTarget: TargetName;
  readonly resolvedTargetSupport: boolean;
  readonly source: MarketplaceCheckSourceReport;
  readonly states: readonly MarketplaceReadinessState[];
}

export interface MarketplaceCheckLockReport {
  readonly path: "skillset.lock";
  readonly policy: MarketplaceRefPolicyKind;
  readonly reason: string;
  readonly state: "absent" | "locked" | "stale";
  readonly expectedSha?: string;
  readonly resolvedSha?: string;
}

export interface MarketplaceCheckSourceReport {
  readonly cacheKey?: string;
  readonly ref?: string;
  readonly kind: MarketplaceSourceKind;
  readonly path?: string;
  readonly repository?: string;
  readonly sha?: string;
}

export type MarketplaceRefPolicyKind = "channel" | "local" | "ref" | "sha" | "version";

export interface MarketplaceLockEntry {
  readonly catalog: string;
  readonly entryId: string;
  readonly generatedPath?: string;
  readonly generatedPaths: readonly string[];
  readonly plugin: string;
  readonly providerSource: string;
  readonly readiness: "marketplace-ready" | "not-ready";
  readonly repo?: string;
  readonly requested: MarketplaceRequestedRefPolicy;
  readonly requestedTarget: TargetName;
  readonly resolved: MarketplaceResolvedLockState;
}

export interface MarketplaceRequestedRefPolicy {
  readonly channel?: string;
  readonly kind: MarketplaceRefPolicyKind;
  readonly ref?: string;
  readonly sha?: string;
  readonly version?: string;
}

export interface MarketplaceResolvedLockState {
  readonly cacheKey?: string;
  readonly generatedPath?: string;
  readonly generatedPaths: readonly string[];
  readonly pluginVersion?: string;
  readonly providerSource: string;
  readonly ref?: string;
  readonly repository?: string;
  readonly sha?: string;
  readonly sourceKind: MarketplaceSourceKind;
  readonly sourcePath?: string;
}

interface MarketplaceCheckOptions extends SkillsetOptions {
  readonly lockMode?: "check" | "refresh";
  readonly name?: string;
}

interface SourceInspection {
  readonly error?: string;
  readonly graph?: BuildGraph;
  readonly kind: MarketplaceSourceKind;
  readonly path?: string;
  readonly repository?: string;
  readonly cacheKey?: string;
  readonly ref?: string;
  readonly renderResults: readonly SkillsetRenderResult[];
  readonly sha?: string;
  readonly verifyFailures: readonly string[];
}

export async function checkMarketplaces(
  rootPath: string,
  options: MarketplaceCheckOptions = {}
): Promise<MarketplaceCheckReport> {
  const rootGraph = await loadBuildGraph(rootPath, options);
  const catalogs = selectedCatalogs(rootGraph.root.marketplaces, options.name);
  const lockEntries = await readMarketplaceLockEntries(rootPath);
  const current = await inspectSource(rootPath, "current", options);
  const inspections = new Map<string, Promise<SourceInspection | undefined>>();
  const entries: MarketplaceCheckEntryReport[] = [];

  for (const [catalogName, catalog] of catalogs) {
    for (const entry of catalog.plugins) {
      const inspection = entry.repo === undefined
        ? current
        : await resolveExternalInspection(entry.repo, options, inspections);
      for (const target of entry.targets ?? catalog.targets) {
        entries.push(checkMarketplaceEntry(catalogName, entry, target, inspection, lockEntries, options.lockMode ?? "check"));
      }
    }
  }

  return {
    entries: entries.sort(compareMarketplaceEntries),
    marketplaces: catalogs.map(([name]) => name),
    ok: entries.every((entry) => entry.readiness === "marketplace-ready"),
  };
}

function selectedCatalogs(
  catalogs: Readonly<Record<string, MarketplaceCatalogConfig>>,
  name: string | undefined
): readonly (readonly [string, MarketplaceCatalogConfig])[] {
  if (name !== undefined) {
    const catalog = catalogs[name];
    if (catalog === undefined) throw new Error(`skillset: unknown marketplace ${name}`);
    return [[name, catalog]];
  }
  return Object.entries(catalogs).sort(([left], [right]) => compareStrings(left, right));
}

async function resolveExternalInspection(
  repo: string,
  options: SkillsetOptions,
  inspections: Map<string, Promise<SourceInspection | undefined>>
): Promise<SourceInspection | undefined> {
  const existing = inspections.get(repo);
  if (existing !== undefined) return existing;
  const pending = resolveKnownSkillsetWorkspace(repo, options.xdg).then((entry) =>
    entry === undefined ? undefined : inspectKnownSource(entry, options).catch((error: unknown) => failedKnownSourceInspection(entry, error))
  );
  inspections.set(repo, pending);
  return pending;
}

function failedKnownSourceInspection(entry: KnownSkillsetEntry, error: unknown): SourceInspection {
  return {
    cacheKey: entry.cacheKey,
    error: error instanceof Error ? error.message : String(error),
    kind: "known-index",
    path: entry.path,
    ...(entry.repository === undefined ? {} : { repository: entry.repository }),
    renderResults: [],
    verifyFailures: [],
  };
}

async function inspectKnownSource(
  entry: KnownSkillsetEntry,
  options: SkillsetOptions
): Promise<SourceInspection> {
  return inspectSource(entry.path, "known-index", options, {
    cacheKey: entry.cacheKey,
    ...(entry.repository === undefined ? {} : { repository: entry.repository }),
  });
}

async function inspectSource(
  path: string,
  kind: MarketplaceSourceKind,
  options: SkillsetOptions,
  metadata: { readonly cacheKey?: string; readonly repository?: string } = {}
): Promise<SourceInspection> {
  const graph = await loadBuildGraph(path, options);
  const verified = await verifySkillsetResult(path, options);
  return {
    graph,
    kind,
    path,
    ...(metadata.cacheKey === undefined ? {} : { cacheKey: metadata.cacheKey }),
    ...(metadata.repository === undefined ? {} : { repository: metadata.repository }),
    ...(await gitIdentity(path)),
    renderResults: verified.renderResults,
    verifyFailures: verified.data.failures,
  };
}

function checkMarketplaceEntry(
  catalog: string,
  entry: MarketplacePluginEntryConfig,
  target: TargetName,
  inspection: SourceInspection | undefined,
  lockEntries: readonly MarketplaceLockEntry[],
  lockMode: "check" | "refresh"
): MarketplaceCheckEntryReport {
  const refPolicy = requestedRefPolicy(entry);
  const policyStates = statesForRefPolicy(refPolicy);
  const declared = ["declared", ...policyStates] as const;
  if (inspection === undefined) {
    return notReady(catalog, entry, target, inspection, declared, "unresolved external repo", [], refPolicy, lockEntries);
  }
  if (inspection.graph === undefined) {
    return notReady(catalog, entry, target, inspection, declared, `failed to inspect source: ${inspection.error ?? "missing build graph"}`, [], refPolicy, lockEntries);
  }

  const source = sourceReport(inspection);
  const plugin = inspection.graph.plugins.find((candidate) => candidate.id === entry.plugin);
  if (plugin === undefined) {
    return notReady(catalog, entry, target, inspection, [...declared, "resolved"], `missing plugin ${entry.plugin}`, [], refPolicy, lockEntries);
  }

  const generatedPath = pluginManifestPath(inspection.graph, plugin, target);
  const baseLockEntry = marketplaceLockEntryFor({
    catalog,
    entry,
    generatedPath,
    generatedPaths: [],
    inspection,
    pluginVersion: pluginVersion(inspection.graph, plugin),
    readiness: "not-ready",
    requested: refPolicy,
    target,
  });
  if (!pluginTargetRenderable(inspection.graph, plugin, target)) {
    const lock = compareMarketplaceLock(baseLockEntry, lockEntries);
    return {
      catalog,
      entryId: entry.id,
      generatedPath,
      generatedPaths: [],
      lock,
      plugin: entry.plugin,
      provenance: baseLockEntry,
      providerSource: providerSource(generatedPath),
      reason: `${target} output is not enabled for plugin ${entry.plugin}`,
      readiness: "not-ready",
      ...(entry.repo === undefined ? {} : { repo: entry.repo }),
      requestedTarget: target,
      resolvedTargetSupport: false,
      source,
      states: ["declared", ...policyStates, "resolved", ...lockStates(lock), "not-ready"],
    };
  }

  const outputPaths = pluginOutputPaths(inspection, plugin.id, target);
  if (outputPaths.length === 0) {
    return notReady(catalog, entry, target, inspection, ["declared", ...policyStates, "resolved", "renderable"], "no generated provider output was planned", [], refPolicy, lockEntries, generatedPath, true);
  }

  const failures = outputPaths.flatMap((path) => failuresForPath(inspection.verifyFailures, path));
  if (failures.length > 0) {
    return notReady(catalog, entry, target, inspection, ["declared", ...policyStates, "resolved", "renderable"], failures[0] ?? "generated provider output is stale", outputPaths, refPolicy, lockEntries, generatedPath, true);
  }

  const lockEntry = marketplaceLockEntryFor({
    catalog,
    entry,
    generatedPath,
    generatedPaths: outputPaths,
    inspection,
    pluginVersion: pluginVersion(inspection.graph, plugin),
    readiness: "marketplace-ready",
    requested: refPolicy,
    target,
  });
  const lock = compareMarketplaceLock(lockEntry, lockEntries);
  if (lockBlocksReadiness(lock, refPolicy, lockMode)) {
    return {
      catalog,
      entryId: entry.id,
      generatedPath,
      generatedPaths: outputPaths,
      lock,
      plugin: entry.plugin,
      provenance: lockEntry,
      providerSource: providerSource(generatedPath),
      reason: lock.reason,
      readiness: "not-ready",
      ...(entry.repo === undefined ? {} : { repo: entry.repo }),
      requestedTarget: target,
      resolvedTargetSupport: true,
      source,
      states: ["declared", ...policyStates, "resolved", "renderable", "generated", "verified", ...lockStates(lock), "not-ready"],
    };
  }

  return {
    catalog,
    entryId: entry.id,
    generatedPath,
    generatedPaths: outputPaths,
    lock,
    plugin: entry.plugin,
    provenance: lockEntry,
    providerSource: providerSource(generatedPath),
    reason: "provider output is generated and verified",
    readiness: "marketplace-ready",
    ...(entry.repo === undefined ? {} : { repo: entry.repo }),
    requestedTarget: target,
    resolvedTargetSupport: true,
    source,
    states: ["declared", ...policyStates, "resolved", "renderable", "generated", "verified", "locked", "marketplace-ready"],
  };
}

function notReady(
  catalog: string,
  entry: MarketplacePluginEntryConfig,
  target: TargetName,
  inspection: SourceInspection | undefined,
  states: readonly MarketplaceReadinessState[],
  reason: string,
  generatedPaths: readonly string[],
  requested: MarketplaceRequestedRefPolicy,
  lockEntries: readonly MarketplaceLockEntry[],
  generatedPath?: string,
  resolvedTargetSupport = false
): MarketplaceCheckEntryReport {
  const lockEntryInput = {
    catalog,
    entry,
    generatedPaths,
    inspection,
    readiness: "not-ready",
    requested,
    target,
  } satisfies Omit<Parameters<typeof marketplaceLockEntryFor>[0], "generatedPath">;
  const provenance = marketplaceLockEntryFor({
    ...lockEntryInput,
    ...(generatedPath === undefined ? {} : { generatedPath }),
  });
  const lock = compareMarketplaceLock(provenance, lockEntries);
  return {
    catalog,
    entryId: entry.id,
    ...(generatedPath === undefined ? {} : { generatedPath }),
    generatedPaths,
    lock,
    plugin: entry.plugin,
    provenance,
    providerSource: generatedPath === undefined ? "" : providerSource(generatedPath),
    reason,
    readiness: "not-ready",
    ...(entry.repo === undefined ? {} : { repo: entry.repo }),
    requestedTarget: target,
    resolvedTargetSupport,
    source: inspection === undefined ? { kind: "unresolved" } : sourceReport(inspection),
    states: [...states, ...lockStates(lock), "not-ready"],
  };
}

function sourceReport(inspection: SourceInspection): MarketplaceCheckSourceReport {
  return {
    ...(inspection.cacheKey === undefined ? {} : { cacheKey: inspection.cacheKey }),
    kind: inspection.kind,
    ...(inspection.path === undefined ? {} : { path: inspection.path }),
    ...(inspection.ref === undefined ? {} : { ref: inspection.ref }),
    ...(inspection.repository === undefined ? {} : { repository: inspection.repository }),
    ...(inspection.sha === undefined ? {} : { sha: inspection.sha }),
  };
}

function requestedRefPolicy(entry: MarketplacePluginEntryConfig): MarketplaceRequestedRefPolicy {
  if (entry.sha !== undefined) return { kind: "sha", sha: entry.sha };
  if (entry.ref !== undefined) return { kind: "ref", ref: entry.ref };
  if (entry.channel !== undefined) return { channel: entry.channel, kind: "channel" };
  if (entry.version !== undefined) return { kind: "version", version: entry.version };
  return { kind: "local" };
}

function statesForRefPolicy(policy: MarketplaceRequestedRefPolicy): readonly MarketplaceReadinessState[] {
  if (policy.kind === "sha") return ["pinned"];
  if (policy.kind === "channel" || policy.kind === "ref" || policy.kind === "version") return ["floating"];
  return [];
}

function lockStates(lock: MarketplaceCheckLockReport): readonly MarketplaceReadinessState[] {
  if (lock.state === "locked") return ["locked"];
  if (lock.state === "stale") return ["stale"];
  return [];
}

function lockBlocksReadiness(
  lock: MarketplaceCheckLockReport,
  policy: MarketplaceRequestedRefPolicy,
  mode: "check" | "refresh"
): boolean {
  if (mode === "refresh" && policy.kind === "sha" && lock.state === "stale") return true;
  if (mode === "refresh" && policy.kind !== "local" && policy.kind !== "sha" && lock.resolvedSha === undefined) return true;
  if (mode === "refresh") return false;
  if (lock.state === "stale") return true;
  return lock.state === "absent" && policy.kind !== "local";
}

function marketplaceLockEntryFor(args: {
  readonly catalog: string;
  readonly entry: MarketplacePluginEntryConfig;
  readonly generatedPath?: string;
  readonly generatedPaths: readonly string[];
  readonly inspection: SourceInspection | undefined;
  readonly pluginVersion?: string;
  readonly readiness: "marketplace-ready" | "not-ready";
  readonly requested: MarketplaceRequestedRefPolicy;
  readonly target: TargetName;
}): MarketplaceLockEntry {
  const provider = args.generatedPath === undefined ? "" : providerSource(args.generatedPath);
  return {
    catalog: args.catalog,
    entryId: args.entry.id,
    ...(args.generatedPath === undefined ? {} : { generatedPath: args.generatedPath }),
    generatedPaths: args.generatedPaths,
    plugin: args.entry.plugin,
    providerSource: provider,
    readiness: args.readiness,
    ...(args.entry.repo === undefined ? {} : { repo: args.entry.repo }),
    requested: args.requested,
    requestedTarget: args.target,
    resolved: {
      ...(args.inspection?.cacheKey === undefined ? {} : { cacheKey: args.inspection.cacheKey }),
      ...(args.generatedPath === undefined ? {} : { generatedPath: args.generatedPath }),
      generatedPaths: args.generatedPaths,
      ...(args.pluginVersion === undefined ? {} : { pluginVersion: args.pluginVersion }),
      providerSource: provider,
      ...(args.inspection?.ref === undefined ? {} : { ref: args.inspection.ref }),
      ...(args.inspection?.repository === undefined ? {} : { repository: args.inspection.repository }),
      ...(args.inspection?.sha === undefined ? {} : { sha: args.inspection.sha }),
      sourceKind: args.inspection?.kind ?? "unresolved",
      ...(args.inspection?.path === undefined ? {} : { sourcePath: args.inspection.path }),
    },
  };
}

function compareMarketplaceLock(
  current: MarketplaceLockEntry,
  lockedEntries: readonly MarketplaceLockEntry[]
): MarketplaceCheckLockReport {
  const match = lockedEntries.find((entry) =>
    entry.catalog === current.catalog &&
    entry.entryId === current.entryId &&
    entry.requestedTarget === current.requestedTarget
  );
  const expectedSha = current.requested.kind === "sha" ? current.requested.sha : match?.resolved.sha;
  const resolvedSha = current.resolved.sha;

  const pinnedSha = current.requested.kind === "sha" ? current.requested.sha : undefined;
  if (pinnedSha !== undefined && resolvedSha === undefined) {
    return {
      expectedSha: pinnedSha,
      path: "skillset.lock",
      policy: current.requested.kind,
      reason: `pinned sha ${pinnedSha} could not be verified for the resolved source`,
      state: "stale",
    };
  }
  if (pinnedSha !== undefined && resolvedSha !== undefined && pinnedSha !== resolvedSha) {
    return {
      expectedSha: pinnedSha,
      path: "skillset.lock",
      policy: current.requested.kind,
      reason: `pinned sha mismatch: resolved ${resolvedSha}, expected ${pinnedSha}`,
      resolvedSha,
      state: "stale",
    };
  }

  if (match === undefined) {
    if (current.requested.kind === "local") {
      return {
        path: "skillset.lock",
        policy: current.requested.kind,
        reason: "no marketplace lock entry; run skillset build --yes after marketplace source changes",
        ...(resolvedSha === undefined ? {} : { resolvedSha }),
        state: "absent",
      };
    }
    return {
      path: "skillset.lock",
      policy: current.requested.kind,
      reason: `${current.requested.kind} marketplace entry is not locked; run skillset marketplace update after resolution support lands`,
      ...(expectedSha === undefined ? {} : { expectedSha }),
      ...(resolvedSha === undefined ? {} : { resolvedSha }),
      state: "absent",
    };
  }

  if (stableMarketplaceLockFingerprint(match) !== stableMarketplaceLockFingerprint(current)) {
    return {
      path: "skillset.lock",
      policy: current.requested.kind,
      reason: "marketplace lock entry is stale for the current resolution",
      ...(expectedSha === undefined ? {} : { expectedSha }),
      ...(resolvedSha === undefined ? {} : { resolvedSha }),
      state: "stale",
    };
  }

  return {
    path: "skillset.lock",
    policy: current.requested.kind,
    reason: "marketplace resolution matches skillset.lock",
    ...(expectedSha === undefined ? {} : { expectedSha }),
    ...(resolvedSha === undefined ? {} : { resolvedSha }),
    state: "locked",
  };
}

function stableMarketplaceLockFingerprint(entry: MarketplaceLockEntry): string {
  const resolved = { ...entry.resolved };
  if (entry.requested.kind === "local") {
    delete resolved.ref;
    delete resolved.sha;
    delete resolved.sourcePath;
  }
  return stableJson({
    catalog: entry.catalog,
    entryId: entry.entryId,
    generatedPath: entry.generatedPath,
    generatedPaths: entry.generatedPaths,
    plugin: entry.plugin,
    providerSource: entry.providerSource,
    readiness: entry.readiness,
    repo: entry.repo,
    requested: entry.requested,
    requestedTarget: entry.requestedTarget,
    resolved,
  });
}

function compareMarketplaceLockEntries(left: MarketplaceLockEntry, right: MarketplaceLockEntry): number {
  return compareStrings(
    `${left.catalog}\0${left.entryId}\0${left.requestedTarget}`,
    `${right.catalog}\0${right.entryId}\0${right.requestedTarget}`
  );
}

async function readMarketplaceLockEntries(rootPath: string): Promise<readonly MarketplaceLockEntry[]> {
  const lockPath = join(rootPath, "skillset.lock");
  if (!(await exists(lockPath))) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(lockPath, "utf8")) as unknown;
  } catch {
    return [];
  }
  if (!isRecord(parsed) || !isRecord(parsed.marketplaces) || !Array.isArray(parsed.marketplaces.entries)) return [];
  return parsed.marketplaces.entries
    .filter(isMarketplaceLockEntry)
    .sort(compareMarketplaceLockEntries);
}

function isMarketplaceLockEntry(value: unknown): value is MarketplaceLockEntry {
  return isRecord(value) &&
    typeof value.catalog === "string" &&
    typeof value.entryId === "string" &&
    Array.isArray(value.generatedPaths) &&
    value.generatedPaths.every((path) => typeof path === "string") &&
    typeof value.plugin === "string" &&
    typeof value.providerSource === "string" &&
    (value.readiness === "marketplace-ready" || value.readiness === "not-ready") &&
    isRecord(value.requested) &&
    typeof value.requested.kind === "string" &&
    typeof value.requestedTarget === "string" &&
    isRecord(value.resolved) &&
    Array.isArray(value.resolved.generatedPaths) &&
    value.resolved.generatedPaths.every((path) => typeof path === "string") &&
    typeof value.resolved.providerSource === "string" &&
    typeof value.resolved.sourceKind === "string";
}

function pluginTargetRenderable(graph: BuildGraph, plugin: SourcePlugin, target: TargetName): boolean {
  return plugin.targets[target].enabled && isOutputSelected(graph.root.outputs.targetOutputs[target].plugins, plugin.id);
}

function pluginManifestPath(graph: BuildGraph, plugin: SourcePlugin, target: TargetName): string {
  const root = graph.root.outputs.plugins[target];
  const manifest = target === "claude" ? ".claude-plugin/plugin.json" : ".codex-plugin/plugin.json";
  return join(root, "plugins", plugin.id, manifest).replaceAll("\\", "/");
}

function pluginOutputPaths(
  inspection: SourceInspection,
  pluginId: string,
  target: TargetName
): readonly string[] {
  const paths = new Set<string>();
  for (const result of inspection.renderResults) {
    if (result.target !== target) continue;
    if (pluginIdForSelector(result.sourceUnit) !== pluginId) continue;
    if (result.outputs === undefined) continue;
    for (const output of result.outputs) paths.add(output.path);
  }
  return [...paths].sort(compareStrings);
}

function failuresForPath(failures: readonly string[], path: string): readonly string[] {
  return failures.filter((failure) => failure.includes(path));
}

function providerSource(path: string): string {
  const match = path.match(/^(.*)\/plugins\/([^/]+)/);
  if (match === null) return path;
  const outputRoot = match[1];
  const pluginId = match[2];
  if (outputRoot === undefined || pluginId === undefined) return path;
  return `./plugins/${pluginId}`;
}

function compareMarketplaceEntries(left: MarketplaceCheckEntryReport, right: MarketplaceCheckEntryReport): number {
  return compareStrings(
    `${left.catalog}\0${left.entryId}\0${left.requestedTarget}`,
    `${right.catalog}\0${right.entryId}\0${right.requestedTarget}`
  );
}

async function gitIdentity(path: string): Promise<{ readonly ref?: string; readonly sha?: string }> {
  const sha = await runGit(path, ["rev-parse", "--verify", "HEAD^{commit}"]);
  const ref = await runGit(path, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
  return {
    ...(ref === undefined ? {} : { ref }),
    ...(sha === undefined ? {} : { sha }),
  };
}

async function runGit(path: string, args: readonly string[]): Promise<string | undefined> {
  try {
    const result = await execFileAsync("git", ["-C", path, ...args], { timeout: 5000 });
    const stdout = String(result.stdout).trim();
    return stdout.length === 0 ? undefined : stdout;
  } catch {
    return undefined;
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stableJson(value: unknown): string {
  return JSON.stringify(sortJson(value));
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => compareStrings(left, right))
      .map(([key, entry]) => [key, sortJson(entry)])
  );
}
