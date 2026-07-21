import { readFile } from "node:fs/promises";
import { join, relative } from "node:path";

import { storedClaudeMarketplaceProviderEntry } from "./claude-marketplace";
import {
  isOutputSelected,
  mergeRecords,
  readRecord,
  readString,
} from "./config";
import { resolveLicense, type ResolvedLicense } from "./licenses";
import { marketplaceRequestedRefPolicy } from "./marketplace-ref-policy";
import { corruptWorkspaceLock } from "./output-safety";
import { compareStrings } from "./path";
import {
  claudeMarketplacePath,
  isDefaultPluginOutputRoot,
  pluginManifestPath,
  providerSourceForPlugin,
} from "./plugin-output";
import { parseRemoteRepositoryReference } from "./remote-repository-reference";
import { GENERATED_BY, textFile, type LockRoot } from "./render-support";
import { renderValidatedJson } from "./structured-output";
import { targetNames } from "./targets";
import type {
  BuildGraph,
  JsonRecord,
  JsonValue,
  MarketplaceCatalogConfig,
  MarketplacePluginEntryConfig,
  RenderedFile,
  SourcePlugin,
  TargetName,
} from "./types";
import { pluginVersion, rootVersion } from "./versioning";
import { isJsonRecord } from "./yaml";

export async function renderClaudeMarketplace(
  graph: BuildGraph
): Promise<readonly RenderedFile[]> {
  const existingState = await readExistingMarketplaceState(graph.rootPath);
  const declaredCatalog = selectClaudeMarketplaceCatalog(graph, existingState);
  if (declaredCatalog !== undefined) {
    const [catalogName, catalog] = declaredCatalog;
    const rootLicense = await resolveRootLicense(graph);
    const plugins: JsonRecord[] = [];
    for (const entry of catalog.plugins) {
      if (!(entry.targets ?? catalog.targets).includes("claude")) continue;
      if (entry.repo !== undefined) {
        const providerEntry = lockedClaudeProviderEntry(
          existingState.entries,
          catalogName,
          entry
        );
        if (providerEntry !== undefined) plugins.push(providerEntry);
        continue;
      }
      const plugin = graph.plugins.find(
        (candidate) => candidate.id === entry.plugin
      );
      if (plugin === undefined || !shouldRenderPlugin(graph, plugin, "claude"))
        continue;
      plugins.push(
        await renderClaudeMarketplacePlugin(graph, plugin, rootLicense)
      );
    }
    return [
      textFile(
        claudeMarketplacePath(graph.root.outputs.plugins.claude),
        renderValidatedJson(
          renderClaudeMarketplaceDocument(graph, catalogName, catalog, plugins),
          "Claude marketplace"
        )
      ),
    ];
  }

  const rootLicense = await resolveRootLicense(graph);
  const plugins: JsonRecord[] = [];
  for (const plugin of graph.plugins.filter((candidate) =>
    shouldRenderPlugin(graph, candidate, "claude")
  )) {
    plugins.push(
      await renderClaudeMarketplacePlugin(graph, plugin, rootLicense)
    );
  }

  if (plugins.length === 0) return [];

  const root = graph.root.metadata;
  const owner = readRecord(root, "owner") ?? readRecord(root, "author") ?? {};
  const portableMarketplace = readRecord(root, "marketplace") ?? {};
  const marketplace = mergeRecords(
    {
      name:
        readString(portableMarketplace, "name") ??
        readString(root, "name") ??
        readString(root, "id") ??
        "skillset",
      owner,
      metadata: {
        description:
          readString(root, "summary") ??
          readString(root, "description") ??
          "Source-first Skillset plugins",
        version: rootVersion(graph),
        pluginRoot: isDefaultPluginOutputRoot(graph.root.outputs.plugins.claude)
          ? "./plugins"
          : "./plugins",
        generatedBy: "example content repo skillset compiler",
      },
      plugins,
    },
    readRecord(graph.root.targets.claude.options, "marketplace") ?? {}
  );

  return [
    textFile(
      claudeMarketplacePath(graph.root.outputs.plugins.claude),
      renderValidatedJson(marketplace, "Claude marketplace")
    ),
  ];
}

async function renderClaudeMarketplacePlugin(
  graph: BuildGraph,
  plugin: SourcePlugin,
  rootLicense: ResolvedLicense | undefined
): Promise<JsonRecord> {
  const metadata = plugin.metadata;
  const pluginLicense = await resolvePluginLicense(graph, plugin, rootLicense);
  return mergeRecords(
    {
      name: plugin.id,
      source: providerSourceForPlugin(
        graph.root.outputs.plugins.claude,
        "claude",
        plugin.id
      ),
      description:
        readString(metadata, "summary") ??
        readString(metadata, "description") ??
        plugin.id,
      version: pluginVersion(graph, plugin),
      author: metadata.author,
      repository: metadata.repository,
      license: pluginLicense?.manifestValue,
      keywords: metadata.keywords,
      category: metadata.category,
      strict: metadata.strict,
    },
    readRecord(plugin.targets.claude.options, "marketplace") ?? {}
  );
}

export function renderClaudeMarketplaceDocument(
  graph: BuildGraph,
  catalogName: string,
  catalog: MarketplaceCatalogConfig,
  plugins: readonly JsonRecord[]
): JsonRecord {
  const root = graph.root.metadata;
  const owner = readRecord(root, "owner") ??
    readRecord(root, "author") ?? {
      name: readString(root, "name") ?? catalogName,
    };
  return {
    name: catalogName,
    owner,
    ...(catalog.description === undefined
      ? {}
      : { description: catalog.description }),
    metadata: {
      description:
        catalog.description ??
        readString(root, "summary") ??
        readString(root, "description") ??
        "Source-first Skillset plugins",
      generatedBy: GENERATED_BY,
      version: rootVersion(graph),
    },
    plugins: [...plugins].sort((left, right) =>
      compareStrings(String(left.name), String(right.name))
    ),
  };
}

function selectClaudeMarketplaceCatalog(
  graph: BuildGraph,
  existingState: ExistingMarketplaceState
): readonly [string, MarketplaceCatalogConfig] | undefined {
  const catalogs = Object.entries(graph.root.marketplaces)
    .filter(([, catalog]) =>
      catalog.plugins.some((entry) =>
        (entry.targets ?? catalog.targets).includes("claude")
      )
    )
    .sort(([left], [right]) => compareStrings(left, right));
  const activeCatalog = optionalString(existingState.activeCatalogs.claude);
  if (activeCatalog !== undefined) {
    const selected = catalogs.find(([name]) => name === activeCatalog);
    if (selected !== undefined) return selected;
  }
  const onlyCatalog = catalogs[0];
  if (catalogs.length === 1 && onlyCatalog !== undefined) return onlyCatalog;
  return undefined;
}

function lockedClaudeProviderEntry(
  existingEntries: readonly JsonRecord[],
  catalogName: string,
  entry: MarketplacePluginEntryConfig
): JsonRecord | undefined {
  if (entry.repo === undefined) return undefined;
  const requested = marketplaceRequestedRefPolicy(
    entry
  ) as unknown as JsonRecord;
  const locked = existingEntries.find(
    (candidate) =>
      candidate.catalog === catalogName &&
      candidate.entryId === entry.id &&
      candidate.plugin === entry.plugin &&
      candidate.repo === entry.repo &&
      candidate.requestedTarget === "claude" &&
      candidate.readiness === "marketplace-ready" &&
      isJsonRecord(candidate.requested) &&
      marketplaceRequestedPoliciesEqual(candidate.requested, requested)
  );
  return locked === undefined
    ? undefined
    : storedClaudeMarketplaceProviderEntry(locked);
}

export async function renderCursorMarketplace(
  graph: BuildGraph
): Promise<readonly RenderedFile[]> {
  const plugins = [];
  for (const plugin of graph.plugins.filter((candidate) =>
    shouldRenderPlugin(graph, candidate, "cursor")
  )) {
    const metadata = plugin.metadata;
    plugins.push(
      mergeRecords(
        {
          name: plugin.id,
          source: providerSourceForPlugin(
            graph.root.outputs.plugins.cursor,
            "cursor",
            plugin.id
          ).replace(/^\.\//, ""),
          description:
            readString(metadata, "summary") ??
            readString(metadata, "description") ??
            plugin.id,
        },
        readRecord(plugin.targets.cursor.options, "marketplace") ?? {}
      )
    );
  }

  if (plugins.length === 0) return [];

  const root = graph.root.metadata;
  const owner = readRecord(root, "owner") ?? readRecord(root, "author") ?? {};
  const portableMarketplace = readRecord(root, "marketplace") ?? {};
  const marketplace = mergeRecords(
    {
      name:
        readString(portableMarketplace, "name") ??
        readString(root, "name") ??
        readString(root, "id") ??
        "skillset",
      owner,
      metadata: {
        description:
          readString(root, "summary") ??
          readString(root, "description") ??
          "Source-first Skillset plugins",
      },
      plugins,
    },
    readRecord(graph.root.targets.cursor.options, "marketplace") ?? {}
  );

  return [
    textFile(
      cursorMarketplacePath(graph.root.outputs.plugins.cursor),
      renderValidatedJson(marketplace, "Cursor marketplace")
    ),
  ];
}

function cursorMarketplacePath(outputRoot: string): string {
  return isDefaultPluginOutputRoot(outputRoot)
    ? ".cursor-plugin/marketplace.json"
    : join(outputRoot, ".cursor-plugin", "marketplace.json").replaceAll(
        "\\",
        "/"
      );
}

export function marketplaceLockProvenance(
  graph: BuildGraph,
  lockRoots: ReadonlyMap<string, LockRoot>,
  existingState: ExistingMarketplaceState
): JsonRecord {
  const entries: JsonRecord[] = [];
  for (const [catalogName, catalog] of Object.entries(
    graph.root.marketplaces
  ).sort(([left], [right]) => compareStrings(left, right))) {
    for (const entry of catalog.plugins) {
      const requested = marketplaceRequestedRefPolicy(
        entry
      ) as unknown as JsonRecord;
      const plugin =
        entry.repo === undefined
          ? graph.plugins.find((candidate) => candidate.id === entry.plugin)
          : undefined;
      for (const target of entry.targets ?? catalog.targets) {
        if (entry.repo !== undefined) {
          const preserved = preserveExternalMarketplaceEntry(
            existingState.entries,
            catalogName,
            entry.id,
            entry.plugin,
            entry.repo,
            requested,
            target
          );
          if (preserved !== undefined) {
            entries.push(preserved);
            continue;
          }
        }
        const generatedPath =
          plugin === undefined
            ? undefined
            : marketplacePluginManifestPath(graph, plugin, target);
        const renderable =
          plugin !== undefined &&
          plugin.targets[target].enabled &&
          isOutputSelected(
            graph.root.outputs.targetOutputs[target].plugins,
            plugin.id
          );
        const generatedPaths = renderable
          ? marketplaceGeneratedPaths(
              lockRoots,
              graph.root.outputs.plugins[target],
              target,
              entry.plugin
            )
          : [];
        const provider =
          generatedPath === undefined
            ? ""
            : marketplaceProviderSource(generatedPath);
        entries.push(
          stripUndefinedJsonRecord({
            catalog: catalogName,
            entryId: entry.id,
            generatedPath,
            generatedPaths: [...generatedPaths],
            plugin: entry.plugin,
            providerSource: provider,
            readiness: renderable ? "marketplace-ready" : "not-ready",
            repo: entry.repo,
            requested,
            requestedTarget: target,
            resolved: stripUndefinedJsonRecord({
              generatedPath,
              generatedPaths: [...generatedPaths],
              pluginVersion:
                plugin === undefined ? undefined : pluginVersion(graph, plugin),
              providerSource: provider,
              repository:
                entry.repo === undefined
                  ? undefined
                  : parseRemoteRepositoryReference(entry.repo).canonical,
              sourceKind: entry.repo === undefined ? "current" : "unresolved",
            }),
          })
        );
      }
    }
  }
  return entries.length === 0
    ? {}
    : {
        marketplaces: {
          activeCatalogs: activeMarketplaceCatalogs(
            graph,
            existingState.activeCatalogs
          ),
          entries: entries.sort((left, right) =>
            compareStrings(
              `${left.catalog}\0${left.entryId}\0${left.requestedTarget}`,
              `${right.catalog}\0${right.entryId}\0${right.requestedTarget}`
            )
          ),
        },
      };
}

interface ExistingMarketplaceState {
  readonly activeCatalogs: JsonRecord;
  readonly entries: readonly JsonRecord[];
}

const EMPTY_MARKETPLACE_STATE: ExistingMarketplaceState = {
  activeCatalogs: {},
  entries: [],
};

export async function readExistingMarketplaceState(
  rootPath: string
): Promise<ExistingMarketplaceState> {
  let raw: string;
  try {
    raw = await readFile(join(rootPath, "skillset.lock"), "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return EMPTY_MARKETPLACE_STATE;
    throw error;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw corruptWorkspaceLock(
      "skillset.lock",
      `it is not valid JSON: ${message}`
    );
  }
  if (!isJsonRecord(parsed)) {
    throw corruptWorkspaceLock(
      "skillset.lock",
      "it is missing a string generatedBy field"
    );
  }
  const marketplaces = parsed.marketplaces;
  if (!isJsonRecord(marketplaces)) return EMPTY_MARKETPLACE_STATE;
  return {
    activeCatalogs: isJsonRecord(marketplaces.activeCatalogs)
      ? marketplaces.activeCatalogs
      : {},
    entries: Array.isArray(marketplaces.entries)
      ? marketplaces.entries.filter(isJsonRecord)
      : [],
  };
}

function activeMarketplaceCatalogs(
  graph: BuildGraph,
  existing: JsonRecord
): JsonRecord {
  const active: Record<string, JsonValue> = {};
  for (const target of targetNames()) {
    const catalogs = Object.entries(graph.root.marketplaces)
      .filter(([, catalog]) =>
        catalog.plugins.some((entry) =>
          (entry.targets ?? catalog.targets).includes(target)
        )
      )
      .sort(([left], [right]) => compareStrings(left, right));
    const requested = optionalString(existing[target]);
    const selected =
      requested === undefined
        ? undefined
        : catalogs.find(([name]) => name === requested);
    if (selected !== undefined) {
      active[target] = selected[0];
      continue;
    }
    const onlyCatalog = catalogs[0];
    if (catalogs.length === 1 && onlyCatalog !== undefined)
      active[target] = onlyCatalog[0];
  }
  return active;
}

function preserveExternalMarketplaceEntry(
  existingEntries: readonly JsonRecord[],
  catalog: string,
  entryId: string,
  plugin: string,
  repo: string,
  requested: JsonRecord,
  target: TargetName
): JsonRecord | undefined {
  const existing = existingEntries.find(
    (candidate) =>
      candidate.catalog === catalog &&
      candidate.entryId === entryId &&
      candidate.plugin === plugin &&
      candidate.repo === repo &&
      candidate.requestedTarget === target &&
      isJsonRecord(candidate.requested) &&
      marketplaceRequestedPoliciesEqual(candidate.requested, requested)
  );
  if (
    existing === undefined ||
    existing.readiness !== "marketplace-ready" ||
    !isJsonRecord(existing.resolved)
  ) {
    return undefined;
  }
  const resolved = existing.resolved;
  if (
    !isStringArray(existing.generatedPaths) ||
    !isStringArray(resolved.generatedPaths)
  )
    return undefined;
  const providerEntry =
    target === "claude"
      ? storedClaudeMarketplaceProviderEntry(existing)
      : undefined;
  if (target === "claude" && providerEntry === undefined) return undefined;
  if (
    typeof existing.providerSource !== "string" ||
    typeof resolved.providerSource !== "string"
  )
    return undefined;
  if (typeof resolved.sha !== "string" || !/^[0-9a-f]{40}$/u.test(resolved.sha))
    return undefined;
  const generatedPath = optionalString(existing.generatedPath);
  const resolvedGeneratedPath = optionalString(resolved.generatedPath);
  if (generatedPath !== undefined && !isPortableMarketplacePath(generatedPath))
    return undefined;
  if (
    resolvedGeneratedPath !== undefined &&
    !isPortableMarketplacePath(resolvedGeneratedPath)
  )
    return undefined;
  if (!existing.generatedPaths.every(isPortableMarketplacePath))
    return undefined;
  if (!resolved.generatedPaths.every(isPortableMarketplacePath))
    return undefined;
  if (
    !isPortableMarketplacePath(existing.providerSource) ||
    !isPortableMarketplacePath(resolved.providerSource)
  ) {
    return undefined;
  }

  return stripUndefinedJsonRecord({
    catalog,
    entryId,
    generatedPath,
    generatedPaths: [...existing.generatedPaths],
    plugin,
    ...(providerEntry === undefined ? {} : { providerEntry }),
    providerSource: existing.providerSource,
    readiness: "marketplace-ready",
    repo,
    requested,
    requestedTarget: target,
    resolved: stripUndefinedJsonRecord({
      generatedPath: resolvedGeneratedPath,
      generatedPaths: [...resolved.generatedPaths],
      pluginVersion: optionalString(resolved.pluginVersion),
      providerSource: resolved.providerSource,
      ref: optionalString(resolved.ref),
      repository: parseRemoteRepositoryReference(repo).canonical,
      sha: resolved.sha,
      sourceKind: "external",
    }),
  });
}

function marketplaceRequestedPoliciesEqual(
  left: JsonRecord,
  right: JsonRecord
): boolean {
  return (
    left.kind === right.kind &&
    left.channel === right.channel &&
    left.ref === right.ref &&
    left.sha === right.sha &&
    left.version === right.version
  );
}

function isStringArray(value: JsonValue | undefined): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === "string")
  );
}

function optionalString(value: JsonValue | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function isPortableMarketplacePath(value: string): boolean {
  return (
    !value.startsWith("/") &&
    !value.startsWith("~") &&
    !/^[A-Za-z]:[\\/]/u.test(value) &&
    !value.split(/[\\/]+/u).includes("..")
  );
}

function marketplaceGeneratedPaths(
  lockRoots: ReadonlyMap<string, LockRoot>,
  outputRoot: string,
  target: TargetName,
  pluginId: string
): readonly string[] {
  const lock = lockRoots.get(outputRoot);
  if (lock === undefined) return [];
  const paths = new Set<string>();
  for (const item of lock.items) {
    if (
      item.plugin !== pluginId &&
      !(item.kind === "plugin" && item.name === pluginId)
    )
      continue;
    for (const file of item.files) {
      if (
        isDefaultPluginOutputRoot(outputRoot) &&
        !file.startsWith(`${pluginId}/${target}/`)
      )
        continue;
      paths.add(join(outputRoot, file).replaceAll("\\", "/"));
    }
  }
  return [...paths].sort(compareStrings);
}

function marketplacePluginManifestPath(
  graph: BuildGraph,
  plugin: SourcePlugin,
  target: TargetName
): string {
  return pluginManifestPath(
    graph.root.outputs.plugins[target],
    target,
    plugin.id
  );
}

function marketplaceProviderSource(path: string): string {
  const defaultMatch = path.match(/^plugins\/([^/]+)\/(claude|codex|cursor)\//);
  if (defaultMatch !== null)
    return `./plugins/${defaultMatch[1]}/${defaultMatch[2]}`;
  const overrideMatch = path.match(/^(.*)\/plugins\/([^/]+)/);
  if (overrideMatch === null) return path;
  const pluginId = overrideMatch[2];
  return pluginId === undefined ? path : `./plugins/${pluginId}`;
}

function stripUndefinedJsonRecord(
  record: Record<string, JsonValue | undefined>
): JsonRecord {
  return Object.fromEntries(
    Object.entries(record).filter(([, value]) => value !== undefined)
  ) as JsonRecord;
}

function shouldRenderPlugin(
  graph: BuildGraph,
  plugin: SourcePlugin,
  target: TargetName
): boolean {
  return (
    plugin.targets[target].enabled &&
    isOutputSelected(
      graph.root.outputs.targetOutputs[target].plugins,
      plugin.id
    )
  );
}

function resolveRootLicense(
  graph: BuildGraph
): Promise<ResolvedLicense | undefined> {
  return resolveLicense({
    graph,
    label: relative(graph.rootPath, graph.rootManifestPath),
    metadata: graph.root.metadata,
    scopePath: graph.sourceRootPath,
    sourcePath: graph.rootManifestPath,
  });
}

function resolvePluginLicense(
  graph: BuildGraph,
  plugin: SourcePlugin,
  rootLicense: ResolvedLicense | undefined
): Promise<ResolvedLicense | undefined> {
  return resolveLicense({
    graph,
    label: relative(graph.rootPath, plugin.configPath),
    metadata: plugin.metadata,
    ...(rootLicense === undefined ? {} : { parent: rootLicense }),
    scopePath: plugin.path,
    sourcePath: plugin.configPath,
  });
}
