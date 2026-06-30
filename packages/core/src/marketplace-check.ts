import { join } from "node:path";

import { isOutputSelected } from "./config";
import { compareStrings } from "./path";
import { pluginIdForSelector } from "./source-unit-selector";
import { loadBuildGraph } from "./resolver";
import { verifySkillsetResult } from "./build";
import { resolveKnownSkillsetWorkspace, type KnownSkillsetEntry } from "./known-skillsets";
import type {
  BuildGraph,
  MarketplaceCatalogConfig,
  MarketplacePluginEntryConfig,
  SkillsetOptions,
  SourcePlugin,
  TargetName,
} from "./types";
import type { SkillsetRenderResult } from "./render-result";

export type MarketplaceReadinessState =
  | "declared"
  | "resolved"
  | "renderable"
  | "generated"
  | "verified"
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
  readonly plugin: string;
  readonly providerSource: string;
  readonly reason: string;
  readonly readiness: "marketplace-ready" | "not-ready";
  readonly repo?: string;
  readonly requestedTarget: TargetName;
  readonly resolvedTargetSupport: boolean;
  readonly source: MarketplaceCheckSourceReport;
  readonly states: readonly MarketplaceReadinessState[];
}

export interface MarketplaceCheckSourceReport {
  readonly cacheKey?: string;
  readonly kind: MarketplaceSourceKind;
  readonly path?: string;
  readonly repository?: string;
}

interface MarketplaceCheckOptions extends SkillsetOptions {
  readonly name?: string;
}

interface SourceInspection {
  readonly error?: string;
  readonly graph?: BuildGraph;
  readonly kind: MarketplaceSourceKind;
  readonly path?: string;
  readonly repository?: string;
  readonly cacheKey?: string;
  readonly renderResults: readonly SkillsetRenderResult[];
  readonly verifyFailures: readonly string[];
}

export async function checkMarketplaces(
  rootPath: string,
  options: MarketplaceCheckOptions = {}
): Promise<MarketplaceCheckReport> {
  const rootGraph = await loadBuildGraph(rootPath, options);
  const catalogs = selectedCatalogs(rootGraph.root.marketplaces, options.name);
  const current = await inspectSource(rootPath, "current", options);
  const inspections = new Map<string, Promise<SourceInspection | undefined>>();
  const entries: MarketplaceCheckEntryReport[] = [];

  for (const [catalogName, catalog] of catalogs) {
    for (const entry of catalog.plugins) {
      const inspection = entry.repo === undefined
        ? current
        : await resolveExternalInspection(entry.repo, options, inspections);
      for (const target of entry.targets ?? catalog.targets) {
        entries.push(checkMarketplaceEntry(catalogName, entry, target, inspection));
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
    renderResults: verified.renderResults,
    verifyFailures: verified.data.failures,
  };
}

function checkMarketplaceEntry(
  catalog: string,
  entry: MarketplacePluginEntryConfig,
  target: TargetName,
  inspection: SourceInspection | undefined
): MarketplaceCheckEntryReport {
  const declared = ["declared"] as const;
  if (inspection === undefined) {
    return notReady(catalog, entry, target, inspection, declared, "unresolved external repo", []);
  }
  if (inspection.graph === undefined) {
    return notReady(catalog, entry, target, inspection, declared, `failed to inspect source: ${inspection.error ?? "missing build graph"}`, []);
  }

  const source = sourceReport(inspection);
  const plugin = inspection.graph.plugins.find((candidate) => candidate.id === entry.plugin);
  if (plugin === undefined) {
    return notReady(catalog, entry, target, inspection, [...declared, "resolved"], `missing plugin ${entry.plugin}`, []);
  }

  const generatedPath = pluginManifestPath(inspection.graph, plugin, target);
  if (!pluginTargetRenderable(inspection.graph, plugin, target)) {
    return {
      catalog,
      entryId: entry.id,
      generatedPath,
      generatedPaths: [],
      plugin: entry.plugin,
      providerSource: providerSource(generatedPath),
      reason: `${target} output is not enabled for plugin ${entry.plugin}`,
      readiness: "not-ready",
      ...(entry.repo === undefined ? {} : { repo: entry.repo }),
      requestedTarget: target,
      resolvedTargetSupport: false,
      source,
      states: ["declared", "resolved", "not-ready"],
    };
  }

  const outputPaths = pluginOutputPaths(inspection, plugin.id, target);
  if (outputPaths.length === 0) {
    return notReady(catalog, entry, target, inspection, ["declared", "resolved", "renderable"], "no generated provider output was planned", [], generatedPath, true);
  }

  const failures = outputPaths.flatMap((path) => failuresForPath(inspection.verifyFailures, path));
  if (failures.length > 0) {
    return notReady(catalog, entry, target, inspection, ["declared", "resolved", "renderable"], failures[0] ?? "generated provider output is stale", outputPaths, generatedPath, true);
  }

  return {
    catalog,
    entryId: entry.id,
    generatedPath,
    generatedPaths: outputPaths,
    plugin: entry.plugin,
    providerSource: providerSource(generatedPath),
    reason: "provider output is generated and verified",
    readiness: "marketplace-ready",
    ...(entry.repo === undefined ? {} : { repo: entry.repo }),
    requestedTarget: target,
    resolvedTargetSupport: true,
    source,
    states: ["declared", "resolved", "renderable", "generated", "verified", "marketplace-ready"],
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
  generatedPath?: string,
  resolvedTargetSupport = false
): MarketplaceCheckEntryReport {
  return {
    catalog,
    entryId: entry.id,
    ...(generatedPath === undefined ? {} : { generatedPath }),
    generatedPaths,
    plugin: entry.plugin,
    providerSource: generatedPath === undefined ? "" : providerSource(generatedPath),
    reason,
    readiness: "not-ready",
    ...(entry.repo === undefined ? {} : { repo: entry.repo }),
    requestedTarget: target,
    resolvedTargetSupport,
    source: inspection === undefined ? { kind: "unresolved" } : sourceReport(inspection),
    states: [...states, "not-ready"],
  };
}

function sourceReport(inspection: SourceInspection): MarketplaceCheckSourceReport {
  return {
    ...(inspection.cacheKey === undefined ? {} : { cacheKey: inspection.cacheKey }),
    kind: inspection.kind,
    ...(inspection.path === undefined ? {} : { path: inspection.path }),
    ...(inspection.repository === undefined ? {} : { repository: inspection.repository }),
  };
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
