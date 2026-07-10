import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import { isOutputSelected } from "./config";
import { storedClaudeMarketplaceProviderEntry } from "./claude-marketplace";
import {
  marketplaceRequestedRefPolicy,
  type MarketplaceRefPolicyKind,
  type MarketplaceRequestedRefPolicy,
} from "./marketplace-ref-policy";
import { compareStrings } from "./path";
import { pluginManifestPath as pluginManifestOutputPath } from "./plugin-output";
import {
  acquireRemoteRepository,
  parseRemoteRepositoryReference,
  type RemoteRepositoryRevision,
} from "./remote-repository-cache";
import { pluginIdForSelector } from "./source-unit-selector";
import { loadBuildGraph } from "./resolver";
import { verifySkillsetResult } from "./build";
import { resolveKnownSkillsetWorkspace, type KnownSkillsetEntry } from "./known-skillsets";
import { pluginVersion } from "./versioning";
import type {
  BuildGraph,
  MarketplaceCatalogConfig,
  MarketplacePluginEntryConfig,
  JsonRecord,
  SkillsetOptions,
  SourcePlugin,
  TargetName,
} from "./types";
import type { SkillsetRenderResult } from "./render-result";

export type { MarketplaceRefPolicyKind, MarketplaceRequestedRefPolicy } from "./marketplace-ref-policy";

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

export type MarketplaceSourceKind = "current" | "known-index" | "remote-cache" | "unresolved";
export type MarketplaceLockSourceKind = "current" | "external" | "unresolved";

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
  readonly ref?: string;
  readonly kind: MarketplaceSourceKind;
  readonly repository?: string;
  readonly sha?: string;
}

export interface MarketplaceLockEntry {
  readonly catalog: string;
  readonly entryId: string;
  readonly generatedPath?: string;
  readonly generatedPaths: readonly string[];
  readonly plugin: string;
  readonly providerEntry?: JsonRecord;
  readonly providerSource: string;
  readonly readiness: "marketplace-ready" | "not-ready";
  readonly repo?: string;
  readonly requested: MarketplaceRequestedRefPolicy;
  readonly requestedTarget: TargetName;
  readonly resolved: MarketplaceResolvedLockState;
}

export interface MarketplaceResolvedLockState {
  readonly generatedPath?: string;
  readonly generatedPaths: readonly string[];
  readonly pluginVersion?: string;
  readonly providerSource: string;
  readonly ref?: string;
  readonly repository?: string;
  readonly sha?: string;
  readonly sourceKind: MarketplaceLockSourceKind;
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

export interface MarketplaceCheckResolution {
  readonly report: MarketplaceCheckReport;
  readonly sourceRoots: ReadonlyMap<string, string>;
}

export async function checkMarketplaces(
  rootPath: string,
  options: MarketplaceCheckOptions = {}
): Promise<MarketplaceCheckReport> {
  return (await resolveMarketplaceChecks(rootPath, options)).report;
}

export async function resolveMarketplaceChecks(
  rootPath: string,
  options: MarketplaceCheckOptions = {}
): Promise<MarketplaceCheckResolution> {
  const rootGraph = await loadBuildGraph(rootPath, options);
  const catalogs = selectedCatalogs(rootGraph.root.marketplaces, options.name);
  const lockEntries = await readMarketplaceLockEntries(rootPath);
  const current = await inspectSource(rootPath, "current", options);
  const inspections = new Map<string, Promise<SourceInspection | undefined>>();
  const entries: MarketplaceCheckEntryReport[] = [];
  const sourceRoots = new Map<string, string>();

  for (const [catalogName, catalog] of catalogs) {
    for (const entry of catalog.plugins) {
      const requested = marketplaceRequestedRefPolicy(entry);
      const inspection = entry.repo === undefined
        ? current
        : await resolveExternalInspection(entry.repo, requested, options, inspections);
      for (const target of entry.targets ?? catalog.targets) {
        const checked = checkMarketplaceEntry(
          catalogName,
          entry,
          target,
          inspection,
          lockEntries,
          options.lockMode ?? "check",
          requested
        );
        entries.push(checked);
        if (inspection?.path !== undefined) sourceRoots.set(marketplaceEntryResolutionKey(checked), inspection.path);
      }
    }
  }

  return {
    report: {
      entries: entries.sort(compareMarketplaceEntries),
      marketplaces: catalogs.map(([name]) => name),
      ok: entries.every((entry) => entry.readiness === "marketplace-ready"),
    },
    sourceRoots,
  };
}

export function marketplaceEntryResolutionKey(entry: MarketplaceCheckEntryReport): string {
  return `${entry.catalog}\0${entry.entryId}\0${entry.requestedTarget}`;
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
  requested: MarketplaceRequestedRefPolicy,
  options: SkillsetOptions,
  inspections: Map<string, Promise<SourceInspection | undefined>>
): Promise<SourceInspection | undefined> {
  const key = `${repo}\0${JSON.stringify(requested)}`;
  const existing = inspections.get(key);
  if (existing !== undefined) return existing;
  const pending = resolveKnownSkillsetWorkspace(repo, options.xdg).then(async (entry) => {
    if (entry !== undefined && requested.kind === "sha" && requested.sha !== undefined) {
      const known = await inspectKnownSource(entry, repo, options).catch(() => undefined);
      if (known?.sha === requested.sha) {
        const { ref: _localRef, ...pinnedKnown } = known;
        return pinnedKnown;
      }
    }
    return inspectRemoteSource(repo, requested, options).catch((error: unknown) =>
      failedRemoteSourceInspection(repo, error)
    );
  });
  inspections.set(key, pending);
  return pending;
}

function failedRemoteSourceInspection(repo: string, error: unknown): SourceInspection {
  return {
    error: portableRemoteInspectionError(error),
    kind: "remote-cache",
    repository: canonicalRepository(repo),
    renderResults: [],
    verifyFailures: [],
  };
}

function portableRemoteInspectionError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message.startsWith("skillset: corrupt remote cache")) return "skillset: remote cache is corrupt";
  if (message.startsWith("skillset: origin mismatch in remote cache")) {
    return "skillset: remote cache origin does not match the requested repository";
  }
  if (message.startsWith("skillset: timed out waiting for the remote cache lock")) {
    return "skillset: timed out waiting for the remote cache lock";
  }
  const portablePrefixes = [
    "skillset: remote ",
    "skillset: resolved remote commit changed",
  ];
  if (portablePrefixes.some((prefix) => message.startsWith(prefix))) return message;
  return "skillset: resolved remote repository is not a valid generated Skillset workspace";
}

async function inspectKnownSource(
  entry: KnownSkillsetEntry,
  repo: string,
  options: SkillsetOptions
): Promise<SourceInspection> {
  await assertKnownRepositoryIdentity(entry.path, repo);
  return inspectSource(entry.path, "known-index", options, {
    cacheKey: entry.cacheKey,
    repository: canonicalRepository(repo),
  });
}

async function assertKnownRepositoryIdentity(path: string, repo: string): Promise<void> {
  const origin = await runGit(path, ["config", "--get", "remote.origin.url"]);
  if (origin === undefined) throw new Error("skillset: known Skillset checkout is missing an origin remote");
  let canonical: string;
  try {
    canonical = canonicalRepository(origin);
  } catch {
    throw new Error("skillset: known Skillset checkout has an unsupported origin remote");
  }
  if (canonical !== canonicalRepository(repo)) {
    throw new Error("skillset: known Skillset checkout origin does not match the marketplace repository");
  }
  const status = await execFileAsync("git", [
    "-C",
    path,
    "-c",
    "core.fsmonitor=false",
    "-c",
    "core.untrackedCache=false",
    "status",
    "--porcelain=v1",
    "--untracked-files=all",
  ], {
    env: { ...gitCommandEnv(), GIT_OPTIONAL_LOCKS: "0" },
    timeout: 5000,
  });
  if (String(status.stdout).trim().length > 0) {
    throw new Error("skillset: known Skillset checkout has uncommitted content");
  }
}

async function inspectRemoteSource(
  repo: string,
  requested: MarketplaceRequestedRefPolicy,
  options: SkillsetOptions
): Promise<SourceInspection> {
  const acquired = await acquireRemoteRepository({
    repository: repo,
    revision: remoteRevision(requested),
    ...(options.xdg === undefined ? {} : { xdg: options.xdg }),
  });
  return inspectSource(acquired.rootPath, "remote-cache", options, {
    cacheKey: acquired.cacheKey,
    ...(acquired.ref === undefined ? {} : { ref: acquired.ref }),
    repository: acquired.repository,
    sha: acquired.sha,
  });
}

async function inspectSource(
  path: string,
  kind: MarketplaceSourceKind,
  options: SkillsetOptions,
  metadata: {
    readonly cacheKey?: string;
    readonly ref?: string;
    readonly repository?: string;
    readonly sha?: string;
  } = {}
): Promise<SourceInspection> {
  const graph = await loadBuildGraph(path, options);
  const verified = await verifySkillsetResult(path, options);
  const identity = await gitIdentity(path);
  const ref = metadata.ref ?? identity.ref;
  const sha = metadata.sha ?? identity.sha;
  return {
    graph,
    kind,
    path,
    ...(metadata.cacheKey === undefined ? {} : { cacheKey: metadata.cacheKey }),
    ...(metadata.repository === undefined ? {} : { repository: metadata.repository }),
    ...(ref === undefined ? {} : { ref }),
    ...(sha === undefined ? {} : { sha }),
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
  lockMode: "check" | "refresh",
  refPolicy: MarketplaceRequestedRefPolicy
): MarketplaceCheckEntryReport {
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
    kind: inspection.kind,
    ...(inspection.ref === undefined ? {} : { ref: inspection.ref }),
    ...(inspection.repository === undefined ? {} : { repository: inspection.repository }),
    ...(inspection.sha === undefined ? {} : { sha: inspection.sha }),
  };
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
      ...(args.generatedPath === undefined ? {} : { generatedPath: args.generatedPath }),
      generatedPaths: args.generatedPaths,
      ...(args.pluginVersion === undefined ? {} : { pluginVersion: args.pluginVersion }),
      providerSource: provider,
      ...(args.inspection?.ref === undefined ? {} : { ref: args.inspection.ref }),
      ...(args.inspection?.repository === undefined ? {} : { repository: args.inspection.repository }),
      ...(args.inspection?.sha === undefined ? {} : { sha: args.inspection.sha }),
      sourceKind: marketplaceLockSourceKind(args.entry, args.inspection),
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

function marketplaceLockSourceKind(
  entry: MarketplacePluginEntryConfig,
  inspection: SourceInspection | undefined
): MarketplaceLockSourceKind {
  if (inspection?.graph === undefined) return "unresolved";
  return entry.repo === undefined ? "current" : "external";
}

function remoteRevision(policy: MarketplaceRequestedRefPolicy): RemoteRepositoryRevision {
  if (policy.kind === "sha" && policy.sha !== undefined) return { kind: "sha", sha: policy.sha };
  if (policy.kind === "ref" && policy.ref !== undefined) return { kind: "ref", ref: policy.ref };
  if (policy.kind === "version" && policy.version !== undefined) {
    return { kind: "version", version: policy.version };
  }
  if (policy.kind === "channel" && policy.channel === "latest") return { kind: "default" };
  if (policy.kind === "channel") {
    throw new Error(`skillset: unsupported marketplace channel ${policy.channel ?? ""}`);
  }
  throw new Error("skillset: external marketplace repositories require a remote ref policy");
}

function canonicalRepository(repo: string): string {
  return parseRemoteRepositoryReference(repo).canonical;
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
  if (!(isRecord(value) &&
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
    typeof value.resolved.sourceKind === "string")) {
    return false;
  }
  return value.repo === undefined ||
    value.requestedTarget !== "claude" ||
    storedClaudeMarketplaceProviderEntry(value as unknown as JsonRecord) !== undefined;
}

function pluginTargetRenderable(graph: BuildGraph, plugin: SourcePlugin, target: TargetName): boolean {
  return plugin.targets[target].enabled && isOutputSelected(graph.root.outputs.targetOutputs[target].plugins, plugin.id);
}

function pluginManifestPath(graph: BuildGraph, plugin: SourcePlugin, target: TargetName): string {
  return pluginManifestOutputPath(graph.root.outputs.plugins[target], target, plugin.id);
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
  const defaultMatch = path.match(/^plugins\/([^/]+)\/(claude|codex)\//);
  if (defaultMatch !== null) return `./plugins/${defaultMatch[1]}/${defaultMatch[2]}`;
  const overrideMatch = path.match(/^(.*)\/plugins\/([^/]+)/);
  if (overrideMatch === null) return path;
  const pluginId = overrideMatch[2];
  return pluginId === undefined ? path : `./plugins/${pluginId}`;
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
    const result = await execFileAsync("git", ["-C", path, ...args], {
      env: gitCommandEnv(),
      timeout: 5000,
    });
    const stdout = String(result.stdout).trim();
    return stdout.length === 0 ? undefined : stdout;
  } catch {
    return undefined;
  }
}

function gitCommandEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined || isGitRepositoryEnv(key)) continue;
    env[key] = value;
  }
  return env;
}

function isGitRepositoryEnv(key: string): boolean {
  return (
    key === "GIT_DIR" ||
    key === "GIT_WORK_TREE" ||
    key === "GIT_INDEX_FILE" ||
    key === "GIT_OBJECT_DIRECTORY" ||
    key === "GIT_COMMON_DIR" ||
    key === "GIT_NAMESPACE" ||
    key.startsWith("GIT_ALTERNATE_OBJECT")
  );
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
