import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { relative } from "node:path";

import { writeAtomicFileSet } from "./atomic-file-set";
import { renderBuildGraphWithOutcomeMetadata } from "./build";
import { claudeMarketplacePluginRoot, claudeMarketplaceRepoSource } from "./claude-marketplace";
import {
  marketplaceEntryResolutionKey,
  resolveMarketplaceChecks,
  type MarketplaceCheckEntryReport,
  type MarketplaceCheckReport,
} from "./marketplace-check";
import { compareStrings, resolveInside } from "./path";
import { claudeMarketplacePath } from "./plugin-output";
import { readExistingMarketplaceState } from "./render-marketplaces";
import { loadBuildGraph } from "./resolver";
import type { BuildGraph, JsonRecord, JsonValue, MarketplaceLockState, SkillsetOptions, TargetName } from "./types";

export interface MarketplaceUpdateOptions extends SkillsetOptions {
  readonly expectedPlanHash?: string;
  readonly name?: string;
  readonly write?: boolean;
}

export interface MarketplaceUpdateReport {
  readonly check: MarketplaceCheckReport;
  readonly files: readonly MarketplaceUpdateFile[];
  readonly lockPath: "skillset.lock";
  readonly ok: boolean;
  readonly planHash?: string;
  readonly reason?: string;
  readonly writtenPaths: readonly string[];
  readonly write: boolean;
}

export interface MarketplaceUpdateFile {
  readonly catalog: string;
  readonly path: string;
  readonly target: TargetName;
}

export async function updateMarketplaces(
  rootPath: string,
  options: MarketplaceUpdateOptions = {}
): Promise<MarketplaceUpdateReport> {
  const graph = await loadBuildGraph(rootPath, options);
  const resolution = await resolveMarketplaceChecks(rootPath, { ...options, lockMode: "refresh" });
  const check = resolution.report;
  const resolved = check.ok
    ? await resolveMarketplaceUpdateEntries(rootPath, graph, check, resolution.sourceRoots)
    : { files: [], providerEntries: new Map<string, JsonRecord>() };
  const files = resolved.files;
  const plan = check.ok
    ? await prepareMarketplaceUpdate(
        rootPath,
        graph,
        check,
        files,
        resolved.providerEntries
      )
    : undefined;
  const planChanged = options.write === true &&
    options.expectedPlanHash !== undefined &&
    options.expectedPlanHash !== plan?.hash;
  const writtenPaths = options.write === true && plan !== undefined && !planChanged
    ? await writeMarketplaceUpdate(plan)
    : [];

  return {
    check,
    files,
    lockPath: "skillset.lock",
    ok: check.ok && !planChanged,
    ...(plan === undefined ? {} : { planHash: plan.hash }),
    ...(planChanged
      ? {
          reason:
            "marketplace update changed after preview; review the latest plan before writing",
        }
      : {}),
    writtenPaths,
    write: options.write === true,
  };
}

async function resolveMarketplaceUpdateEntries(
  rootPath: string,
  graph: BuildGraph,
  check: MarketplaceCheckReport,
  sourceRoots: ReadonlyMap<string, string>
): Promise<ResolvedMarketplaceUpdate> {
  const claudeEntries = check.entries.filter((entry) => entry.requestedTarget === "claude");
  const catalogs = new Set(claudeEntries.map((entry) => entry.catalog));
  if (catalogs.size > 1) {
    throw new Error("skillset: marketplace update requires a marketplace name when multiple Claude catalogs are configured");
  }
  const catalog = [...catalogs][0];
  if (catalog === undefined) return { files: [], providerEntries: new Map() };
  if (graph.root.marketplaces[catalog] === undefined) throw new Error(`skillset: unknown marketplace ${catalog}`);

  const externalEntries = claudeEntries.filter((entry) => entry.repo !== undefined);
  const providerEntries = new Map(
    await Promise.all(
      externalEntries.map(async (entry) => [
        marketplaceEntryResolutionKey(entry),
        await claudeMarketplacePlugin(rootPath, entry, sourceRoots),
      ] as const)
    )
  );
  return {
    files: [{
      catalog,
      path: claudeMarketplacePath(graph.root.outputs.plugins.claude),
      target: "claude",
    }],
    providerEntries,
  };
}

async function claudeMarketplacePlugin(
  rootPath: string,
  entry: MarketplaceCheckEntryReport,
  sourceRoots: ReadonlyMap<string, string>
): Promise<JsonRecord> {
  if (entry.generatedPath === undefined) throw new Error(`skillset: marketplace entry ${entry.catalog}/${entry.entryId} is missing a generated Claude plugin manifest path`);
  const sourceRoot = sourceRoots.get(marketplaceEntryResolutionKey(entry)) ??
    (entry.source.kind === "current" ? rootPath : undefined);
  if (sourceRoot === undefined) throw new Error(`skillset: marketplace entry ${entry.catalog}/${entry.entryId} is missing a resolved source path`);
  const manifest = await readJsonRecord(resolveInside(sourceRoot, entry.generatedPath), entry.generatedPath);
  const marketplaceEntry = pickClaudeMarketplaceFields(manifest);
  return stripUndefinedJsonRecord({
    ...marketplaceEntry,
    name: entry.plugin,
    source: claudeMarketplaceSource(entry),
  });
}

function pickClaudeMarketplaceFields(manifest: JsonRecord): JsonRecord {
  return stripUndefinedJsonRecord({
    author: manifest.author,
    category: manifest.category,
    description: manifest.description,
    homepage: manifest.homepage,
    keywords: manifest.keywords,
    license: manifest.license,
    repository: manifest.repository,
    strict: manifest.strict,
    tags: manifest.tags,
    version: manifest.version,
  });
}

function claudeMarketplaceSource(entry: MarketplaceCheckEntryReport): JsonValue {
  if (entry.repo === undefined) return entry.providerSource;
  if (entry.generatedPath === undefined) throw new Error(`skillset: marketplace entry ${entry.catalog}/${entry.entryId} is missing a generated Claude plugin manifest path`);
  return stripUndefinedJsonRecord({
    path: pluginRootPath(entry.generatedPath),
    source: "git-subdir",
    url: claudeMarketplaceRepoSource(entry.repo),
    ...claudeRefFields(entry),
  });
}

function claudeRefFields(entry: MarketplaceCheckEntryReport): JsonRecord {
  const requested = entry.provenance.requested;
  const resolvedSha = fortyCharSha(entry.source.sha);
  if (requested.kind === "sha") return stripUndefinedJsonRecord({ sha: fortyCharSha(requested.sha) });
  if (requested.kind === "ref") return stripUndefinedJsonRecord({ ref: requested.ref, sha: resolvedSha });
  if (requested.kind === "channel" || requested.kind === "version") return stripUndefinedJsonRecord({ sha: resolvedSha });
  return {};
}

function fortyCharSha(value: string | undefined): string | undefined {
  return value !== undefined && /^[a-f0-9]{40}$/u.test(value) ? value : undefined;
}

function pluginRootPath(generatedPath: string): string {
  return claudeMarketplacePluginRoot(generatedPath);
}

/**
 * Renders the update through the ordinary build with the resolved marketplace
 * state, so the catalog and lock bytes are exactly what the next build would
 * write: the build owns both files, and update only supplies resolution.
 */
async function prepareMarketplaceUpdate(
  rootPath: string,
  graph: BuildGraph,
  check: MarketplaceCheckReport,
  files: readonly MarketplaceUpdateFile[],
  providerEntries: ReadonlyMap<string, JsonRecord>
): Promise<PreparedMarketplaceUpdate> {
  const marketplaceState = await resolvedMarketplaceState(rootPath, check, files, providerEntries);
  const rendered = await renderBuildGraphWithOutcomeMetadata({ ...graph, marketplaceState });
  const paths = [...files.map(({ path }) => path), "skillset.lock"].sort(compareStrings);
  const writes = paths.map((path) => {
    const file = rendered.find((candidate) => candidate.path === path);
    if (file === undefined) throw new Error(`skillset: marketplace update could not render ${path}`);
    return { content: file.content, path: resolveInside(rootPath, path) };
  });
  return {
    hash: hashMarketplaceUpdatePlan(rootPath, writes),
    paths,
    writes,
  };
}

async function writeMarketplaceUpdate(
  plan: PreparedMarketplaceUpdate
): Promise<readonly string[]> {
  await writeAtomicFileSet(plan.writes);
  return plan.paths;
}

function hashMarketplaceUpdatePlan(
  rootPath: string,
  writes: PreparedMarketplaceUpdate["writes"]
): string {
  const hash = createHash("sha256");
  const planned = writes.map((write) => ({
    ...write,
    planPath: normalizeMarketplaceUpdatePlanPath(
      relative(rootPath, write.path)
    ),
  })).toSorted((left, right) => compareStrings(left.planPath, right.planPath));
  for (const write of planned) {
    hash.update(write.planPath);
    hash.update("\0");
    hash.update(write.content);
    hash.update("\0");
  }
  return `sha256:${hash.digest("hex")}`;
}

export function normalizeMarketplaceUpdatePlanPath(path: string): string {
  return path.replaceAll("\\", "/");
}

async function resolvedMarketplaceState(
  rootPath: string,
  check: MarketplaceCheckReport,
  files: readonly MarketplaceUpdateFile[],
  providerEntries: ReadonlyMap<string, JsonRecord>
): Promise<MarketplaceLockState> {
  const existing = await readExistingMarketplaceState(rootPath);
  const selected = new Set(check.marketplaces);
  const entries = [
    ...existing.entries.filter((entry) => typeof entry.catalog !== "string" || !selected.has(entry.catalog)),
    ...check.entries.map((entry) => {
      const providerEntry = providerEntries.get(marketplaceEntryResolutionKey(entry));
      return (providerEntry === undefined ? entry.provenance : { ...entry.provenance, providerEntry }) as unknown as JsonRecord;
    }),
  ];
  const activeCatalogs: JsonRecord = {
    ...existing.activeCatalogs,
    ...Object.fromEntries(files.map((file) => [file.target, file.catalog])),
  };
  return { activeCatalogs, entries };
}

async function readJsonRecord(path: string, label: string): Promise<JsonRecord> {
  const parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
  if (!isRecord(parsed)) throw new Error(`skillset: expected ${label} to be a JSON object`);
  return parsed as JsonRecord;
}

function stripUndefinedJsonRecord(record: Record<string, JsonValue | undefined>): JsonRecord {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined)) as JsonRecord;
}

function isRecord(value: unknown): value is Record<string, JsonValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

interface ResolvedMarketplaceUpdate {
  readonly files: readonly MarketplaceUpdateFile[];
  readonly providerEntries: ReadonlyMap<string, JsonRecord>;
}

interface PreparedMarketplaceUpdate {
  readonly hash: string;
  readonly paths: readonly string[];
  readonly writes: readonly {
    readonly content: Uint8Array | string;
    readonly path: string;
  }[];
}
