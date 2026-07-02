import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { readRecord, readString } from "./config";
import { checkMarketplaces, type MarketplaceCheckEntryReport, type MarketplaceCheckReport, type MarketplaceLockEntry } from "./marketplace-check";
import { compareStrings, resolveInside } from "./path";
import { claudeMarketplacePath } from "./plugin-output";
import { loadBuildGraph } from "./resolver";
import { renderValidatedJson } from "./structured-output";
import type { BuildGraph, JsonRecord, JsonValue, SkillsetOptions, TargetName } from "./types";
import { rootVersion } from "./versioning";

export interface MarketplaceUpdateOptions extends SkillsetOptions {
  readonly name?: string;
  readonly write?: boolean;
}

export interface MarketplaceUpdateReport {
  readonly check: MarketplaceCheckReport;
  readonly files: readonly MarketplaceUpdateFile[];
  readonly lockPath: "skillset.lock";
  readonly ok: boolean;
  readonly writtenPaths: readonly string[];
  readonly write: boolean;
}

export interface MarketplaceUpdateFile {
  readonly catalog: string;
  readonly path: string;
  readonly target: TargetName;
}

const textEncoder = new TextEncoder();

export async function updateMarketplaces(
  rootPath: string,
  options: MarketplaceUpdateOptions = {}
): Promise<MarketplaceUpdateReport> {
  const graph = await loadBuildGraph(rootPath, options);
  const check = await checkMarketplaces(rootPath, { ...options, lockMode: "refresh" });
  const files = check.ok ? await renderMarketplaceUpdateFiles(rootPath, graph, check) : [];
  const writtenPaths = options.write === true && check.ok
    ? await writeMarketplaceUpdate(rootPath, check, files)
    : [];

  return {
    check,
    files,
    lockPath: "skillset.lock",
    ok: check.ok,
    writtenPaths,
    write: options.write === true,
  };
}

async function renderMarketplaceUpdateFiles(
  rootPath: string,
  graph: BuildGraph,
  check: MarketplaceCheckReport
): Promise<readonly MarketplaceUpdateFileWithContent[]> {
  const claudeEntries = check.entries.filter((entry) => entry.requestedTarget === "claude");
  const catalogs = new Set(claudeEntries.map((entry) => entry.catalog));
  if (catalogs.size > 1) {
    throw new Error("skillset: marketplace update requires a marketplace name when multiple Claude catalogs are configured");
  }
  const catalog = [...catalogs][0];
  if (catalog === undefined) return [];
  const catalogConfig = graph.root.marketplaces[catalog];
  if (catalogConfig === undefined) throw new Error(`skillset: unknown marketplace ${catalog}`);

  const path = claudeMarketplacePath(graph.root.outputs.plugins.claude);
  const plugins = await Promise.all(claudeEntries.map((entry) => claudeMarketplacePlugin(rootPath, entry)));
  const root = graph.root.metadata;
  const owner = readRecord(root, "owner") ?? readRecord(root, "author") ?? { name: readString(root, "name") ?? catalog };
  const marketplace = {
    name: catalog,
    owner,
    ...(catalogConfig.description === undefined ? {} : { description: catalogConfig.description }),
    metadata: {
      description:
        catalogConfig.description ??
        readString(root, "summary") ??
        readString(root, "description") ??
        "Source-first Skillset plugins",
      generatedBy: "skillset@0.1.0",
      version: rootVersion(graph),
    },
    plugins: plugins.sort((left, right) => compareStrings(String(left.name), String(right.name))),
  } satisfies JsonRecord;

  return [{
    catalog,
    content: textEncoder.encode(renderValidatedJson(marketplace, "Claude marketplace")),
    path,
    target: "claude",
  }];
}

async function claudeMarketplacePlugin(
  rootPath: string,
  entry: MarketplaceCheckEntryReport
): Promise<JsonRecord> {
  if (entry.generatedPath === undefined) throw new Error(`skillset: marketplace entry ${entry.catalog}/${entry.entryId} is missing a generated Claude plugin manifest path`);
  const sourceRoot = entry.source.path ?? (entry.source.kind === "current" ? rootPath : undefined);
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
    url: claudeRepoSource(entry.repo),
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

function claudeRepoSource(repo: string): string {
  const github = repo.match(/^github:([^/]+\/[^/]+)$/u);
  return github?.[1] ?? repo;
}

function pluginRootPath(generatedPath: string): string {
  const suffix = "/.claude-plugin/plugin.json";
  if (!generatedPath.endsWith(suffix)) return dirname(generatedPath).replaceAll("\\", "/");
  return generatedPath.slice(0, -suffix.length);
}

async function writeMarketplaceUpdate(
  rootPath: string,
  check: MarketplaceCheckReport,
  files: readonly MarketplaceUpdateFileWithContent[]
): Promise<readonly string[]> {
  const written: string[] = [];
  for (const file of files) {
    const absolute = resolveInside(rootPath, file.path);
    await mkdir(dirname(absolute), { recursive: true });
    await writeFile(absolute, file.content);
    written.push(file.path);
  }
  await writeMarketplaceLock(rootPath, check);
  written.push("skillset.lock");
  return written.sort(compareStrings);
}

async function writeMarketplaceLock(rootPath: string, check: MarketplaceCheckReport): Promise<void> {
  const lockPath = resolveInside(rootPath, "skillset.lock");
  const existing = await readExistingLock(lockPath);
  const selected = new Set(check.marketplaces);
  const previousEntries = marketplaceLockEntries(existing);
  const nextEntries = [
    ...previousEntries.filter((entry) => !selected.has(entry.catalog)),
    ...check.entries.map((entry) => entry.provenance),
  ].sort(compareMarketplaceLockEntries);
  const next = stripUndefinedJsonRecord({
    generatedBy: existing.generatedBy ?? "skillset@0.1.0",
    items: Array.isArray(existing.items) ? existing.items : [],
    ...existing,
    marketplaces: {
      ...(isRecord(existing.marketplaces) ? existing.marketplaces : {}),
      entries: nextEntries as unknown as JsonValue,
    },
    outputRoot: existing.outputRoot ?? ".",
    schemaVersion: existing.schemaVersion ?? 1,
    target: existing.target ?? "workspace",
  });
  await writeFile(lockPath, renderValidatedJson(next, "skillset.lock"));
}

async function readExistingLock(path: string): Promise<JsonRecord> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if (isNotFoundError(error)) return {};
    throw error;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`skillset: cannot update corrupt skillset.lock: ${message}`);
  }
  if (!isRecord(parsed)) throw new Error("skillset: cannot update skillset.lock because it is not a JSON object");
  return parsed as JsonRecord;
}

function marketplaceLockEntries(lock: JsonRecord): readonly MarketplaceLockEntry[] {
  if (!isRecord(lock.marketplaces) || !Array.isArray(lock.marketplaces.entries)) return [];
  return (lock.marketplaces.entries as unknown[]).filter(isMarketplaceLockEntry);
}

function isMarketplaceLockEntry(value: unknown): value is MarketplaceLockEntry {
  return isRecord(value) &&
    typeof value.catalog === "string" &&
    typeof value.entryId === "string" &&
    typeof value.plugin === "string" &&
    typeof value.providerSource === "string" &&
    typeof value.requestedTarget === "string" &&
    isRecord(value.requested) &&
    isRecord(value.resolved);
}

function compareMarketplaceLockEntries(left: MarketplaceLockEntry, right: MarketplaceLockEntry): number {
  return compareStrings(
    `${left.catalog}\0${left.entryId}\0${left.requestedTarget}`,
    `${right.catalog}\0${right.entryId}\0${right.requestedTarget}`
  );
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

function isNotFoundError(error: unknown): boolean {
  return isRecord(error) && error.code === "ENOENT";
}

interface MarketplaceUpdateFileWithContent extends MarketplaceUpdateFile {
  readonly content: Uint8Array;
}
