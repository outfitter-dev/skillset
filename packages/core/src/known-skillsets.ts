import { readFile, realpath, stat } from "node:fs/promises";
import { join, resolve } from "node:path";

import {
  readSkillsetWorkspaceConfig,
  resolveSkillsetXdgPaths,
  resolveRepoCacheKey,
  type SkillsetXdgOptions,
} from "./xdg";
import { isJsonRecord, parseYamlRecord, stringifyJson } from "./yaml";
import type { JsonRecord, JsonValue } from "./types";
import {
  type KnownSkillsetsTransactionTestOptions,
  withKnownSkillsetsTransaction,
} from "./known-skillsets-transaction";

const KNOWN_SKILLSETS_SCHEMA_VERSION = 1;
const KNOWN_SKILLSETS_FILE = "skillsets.json";
const KNOWN_SKILLSETS_STALE_PROBE_LIMIT = 128;

export interface KnownSkillsetEntry {
  readonly cacheKey: string;
  readonly identities: readonly string[];
  readonly path: string;
  readonly repository?: string;
}

export interface KnownSkillsetsIndex {
  readonly maintenance?: KnownSkillsetsMaintenance;
  readonly schemaVersion: 1;
  readonly skillsets: readonly KnownSkillsetEntry[];
}

export interface KnownSkillsetsMaintenance {
  readonly staleSweepAfter?: string;
}

interface KnownSkillsetsUpdateTestOptions extends KnownSkillsetsTransactionTestOptions {
  readonly inspectPath?: (path: string) => Promise<KnownSkillsetPathState>;
}

type KnownSkillsetPathState = "directory" | "stale" | "unknown";

export interface RecordKnownSkillsetOptions extends SkillsetXdgOptions {
  readonly cacheKey?: string;
  readonly repository?: string;
}

export interface ResolveKnownSkillsetOptions extends SkillsetXdgOptions {}

export function knownSkillsetsIndexPath(options: SkillsetXdgOptions = {}): string {
  return join(resolveSkillsetXdgPaths(options).config, KNOWN_SKILLSETS_FILE);
}

export async function readKnownSkillsetsIndex(options: SkillsetXdgOptions = {}): Promise<KnownSkillsetsIndex> {
  const path = knownSkillsetsIndexPath(options);
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if (isNotFoundError(error)) return emptyKnownSkillsetsIndex();
    throw error;
  }

  const parsed = JSON.parse(raw) as unknown;
  return parseKnownSkillsetsIndex(parsed, path);
}

export async function writeKnownSkillsetsIndex(
  index: KnownSkillsetsIndex,
  options: SkillsetXdgOptions = {}
): Promise<void> {
  const path = knownSkillsetsIndexPath(options);
  await withKnownSkillsetsTransaction(path, async (transaction) => {
    await quarantineMalformedKnownSkillsetsIndex(options, transaction);
    await transaction.publish(stringifyKnownSkillsetsIndex(index));
  });
}

export async function recordKnownSkillsetWorkspace(
  rootPath: string,
  options: RecordKnownSkillsetOptions = {}
): Promise<KnownSkillsetEntry> {
  const resolvedPath = await realpath(rootPath).catch(() => resolve(rootPath));
  const cacheKey = options.cacheKey ?? await readWorkspaceCacheKey(resolvedPath) ?? resolveRepoCacheKey({ rootPath: resolvedPath }).key;
  const repository = options.repository ?? await readGitRemoteUrl(resolvedPath);
  const identities = normalizeKnownSkillsetIdentities(repository);
  const entry: KnownSkillsetEntry = {
    cacheKey,
    identities,
    path: resolvedPath,
    ...(repository === undefined ? {} : { repository }),
  };

  await updateKnownSkillsetsIndex(entry, options);
  return entry;
}

export async function updateKnownSkillsetsIndexForTest(
  entry: KnownSkillsetEntry,
  options: SkillsetXdgOptions,
  testOptions: KnownSkillsetsUpdateTestOptions
): Promise<void> {
  await updateKnownSkillsetsIndex(entry, options, testOptions);
}

export async function resolveKnownSkillsetWorkspace(
  identity: string,
  options: ResolveKnownSkillsetOptions = {}
): Promise<KnownSkillsetEntry | undefined> {
  const normalized = normalizeKnownSkillsetIdentity(identity);
  if (normalized === undefined) return undefined;

  const index = await readKnownSkillsetsIndex(options);
  for (const entry of index.skillsets) {
    if (!entry.identities.includes(normalized)) continue;
    if (await isExistingDirectory(entry.path)) return entry;
  }
  return undefined;
}

export function normalizeKnownSkillsetIdentity(value: string): string | undefined {
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;

  const github = normalizeGithubIdentity(trimmed);
  if (github !== undefined) return github;

  return trimmed.replace(/\.git$/i, "").toLowerCase();
}

function normalizeKnownSkillsetIdentities(repository: string | undefined): readonly string[] {
  const normalized = repository === undefined ? undefined : normalizeKnownSkillsetIdentity(repository);
  return normalized === undefined ? [] : [normalized];
}

function upsertKnownSkillsetEntry(index: KnownSkillsetsIndex, entry: KnownSkillsetEntry): KnownSkillsetsIndex {
  const entries = index.skillsets.filter((candidate) =>
    candidate.path !== entry.path &&
    candidate.cacheKey !== entry.cacheKey &&
    !candidate.identities.some((identity) => entry.identities.includes(identity))
  );
  return {
    ...(index.maintenance === undefined ? {} : { maintenance: index.maintenance }),
    schemaVersion: KNOWN_SKILLSETS_SCHEMA_VERSION,
    skillsets: [...entries, entry].sort(compareKnownSkillsetEntries),
  };
}

async function updateKnownSkillsetsIndex(
  entry: KnownSkillsetEntry,
  options: SkillsetXdgOptions,
  testOptions: KnownSkillsetsUpdateTestOptions = {}
): Promise<void> {
  const path = knownSkillsetsIndexPath(options);
  await withKnownSkillsetsTransaction(path, async (transaction) => {
    let index: KnownSkillsetsIndex;
    try {
      index = await readKnownSkillsetsIndex(options);
    } catch (error) {
      if (!isMalformedKnownSkillsetsIndexError(error, path)) throw error;
      await transaction.quarantine();
      index = emptyKnownSkillsetsIndex();
    }
    const compacted = await compactKnownSkillsetsIndex(index, testOptions.inspectPath ?? inspectKnownSkillsetPath);
    await transaction.publish(stringifyKnownSkillsetsIndex(upsertKnownSkillsetEntry(compacted, entry)));
  }, testOptions);
}

async function compactKnownSkillsetsIndex(
  index: KnownSkillsetsIndex,
  inspectPath: (path: string) => Promise<KnownSkillsetPathState>
): Promise<KnownSkillsetsIndex> {
  const entries = index.skillsets.toSorted(compareKnownSkillsetEntries);
  if (entries.length === 0) return index;
  const cursor = index.maintenance?.staleSweepAfter;
  const start = cursor === undefined
    ? 0
    : Math.max(0, entries.findIndex((entry) => entry.path.localeCompare(cursor) > 0));
  const ordered = start === 0 ? entries : [...entries.slice(start), ...entries.slice(0, start)];
  const probed = ordered.slice(0, KNOWN_SKILLSETS_STALE_PROBE_LIMIT);
  const stalePaths = new Set<string>();
  for (const candidate of probed) {
    if (await inspectPath(candidate.path) === "stale") stalePaths.add(candidate.path);
  }
  return {
    maintenance: { staleSweepAfter: probed.at(-1)!.path },
    schemaVersion: KNOWN_SKILLSETS_SCHEMA_VERSION,
    skillsets: entries.filter((candidate) => !stalePaths.has(candidate.path)),
  };
}

async function inspectKnownSkillsetPath(path: string): Promise<KnownSkillsetPathState> {
  try {
    return (await stat(path)).isDirectory() ? "directory" : "stale";
  } catch (error) {
    return isConfirmedMissingError(error) ? "stale" : "unknown";
  }
}

async function quarantineMalformedKnownSkillsetsIndex(
  options: SkillsetXdgOptions,
  transaction: { readonly indexPath: string; readonly quarantine: () => Promise<string> }
): Promise<void> {
  try {
    await readKnownSkillsetsIndex(options);
  } catch (error) {
    if (!isMalformedKnownSkillsetsIndexError(error, transaction.indexPath)) throw error;
    await transaction.quarantine();
  }
}

function isMalformedKnownSkillsetsIndexError(error: unknown, path: string): boolean {
  if (!(error instanceof Error)) return false;
  return error instanceof SyntaxError || error.message.startsWith(`skillset: expected ${path}`);
}

function parseKnownSkillsetsIndex(value: unknown, label: string): KnownSkillsetsIndex {
  if (!isJsonRecord(value)) throw new Error(`skillset: expected ${label} to contain a JSON object`);
  if (value.schemaVersion !== KNOWN_SKILLSETS_SCHEMA_VERSION) {
    throw new Error(`skillset: expected ${label}.schemaVersion to be ${KNOWN_SKILLSETS_SCHEMA_VERSION}`);
  }
  if (!Array.isArray(value.skillsets)) {
    throw new Error(`skillset: expected ${label}.skillsets to be an array`);
  }
  return {
    ...(readKnownSkillsetsMaintenance(value.maintenance, `${label}.maintenance`)),
    schemaVersion: KNOWN_SKILLSETS_SCHEMA_VERSION,
    skillsets: value.skillsets.map((item, index) => readKnownSkillsetEntry(item, `${label}.skillsets[${index}]`)),
  };
}

function readKnownSkillsetsMaintenance(
  value: JsonValue | undefined,
  label: string
): { readonly maintenance?: KnownSkillsetsMaintenance } {
  if (value === undefined) return {};
  if (!isJsonRecord(value)) throw new Error(`skillset: expected ${label} to be an object`);
  if (value.staleSweepAfter === undefined) return { maintenance: {} };
  return {
    maintenance: { staleSweepAfter: readRequiredString(value.staleSweepAfter, `${label}.staleSweepAfter`) },
  };
}

function readKnownSkillsetEntry(value: JsonValue | undefined, label: string): KnownSkillsetEntry {
  if (!isJsonRecord(value)) throw new Error(`skillset: expected ${label} to be an object`);
  const path = readRequiredString(value.path, `${label}.path`);
  const cacheKey = readRequiredString(value.cacheKey, `${label}.cacheKey`);
  if (!Array.isArray(value.identities) || !value.identities.every((identity) => typeof identity === "string")) {
    throw new Error(`skillset: expected ${label}.identities to be a string array`);
  }
  const identities = value.identities.map((identity) => {
    const normalized = normalizeKnownSkillsetIdentity(identity);
    if (normalized === undefined) throw new Error(`skillset: expected ${label}.identities to contain non-empty strings`);
    return normalized;
  });
  const repository = value.repository === undefined ? undefined : readRequiredString(value.repository, `${label}.repository`);
  return {
    cacheKey,
    identities: [...new Set(identities)].sort(),
    path,
    ...(repository === undefined ? {} : { repository }),
  };
}

function stringifyKnownSkillsetsIndex(index: KnownSkillsetsIndex): string {
  return stringifyJson(index as unknown as JsonRecord);
}

function emptyKnownSkillsetsIndex(): KnownSkillsetsIndex {
  return {
    schemaVersion: KNOWN_SKILLSETS_SCHEMA_VERSION,
    skillsets: [],
  };
}

function readRequiredString(value: JsonValue | undefined, label: string): string {
  if (typeof value !== "string" || value.trim() !== value || value.length === 0) {
    throw new Error(`skillset: expected ${label} to be a non-empty string`);
  }
  return value;
}

function normalizeGithubIdentity(value: string): string | undefined {
  const githubPrefix = value.match(/^github:([^/]+)\/([^/]+)$/i);
  if (githubPrefix !== null) return githubIdentity(githubPrefix[1], githubPrefix[2]);

  const scpLike = value.match(/^git@github\.com:([^/]+)\/(.+)$/i);
  if (scpLike !== null) return githubIdentity(scpLike[1], scpLike[2]);

  let url: URL;
  try {
    url = new URL(value.includes("://") ? value : `https://${value}`);
  } catch {
    return undefined;
  }

  if (url.hostname.toLowerCase() !== "github.com") return undefined;
  const [owner, repo] = url.pathname.replace(/^\/+/, "").split("/");
  return githubIdentity(owner, repo);
}

function githubIdentity(owner: string | undefined, repo: string | undefined): string | undefined {
  if (owner === undefined || repo === undefined) return undefined;
  const normalizedOwner = owner.trim().toLowerCase();
  const normalizedRepo = repo.trim().replace(/\.git$/i, "").toLowerCase();
  if (normalizedOwner.length === 0 || normalizedRepo.length === 0 || normalizedRepo.includes("/")) return undefined;
  return `github:${normalizedOwner}/${normalizedRepo}`;
}

async function readGitRemoteUrl(rootPath: string): Promise<string | undefined> {
  const proc = Bun.spawn({
    cmd: ["git", "-C", rootPath, "remote", "get-url", "origin"],
    env: gitCommandEnv(),
    stderr: "pipe",
    stdout: "pipe",
  });
  const [stdout, , exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (exitCode !== 0) return undefined;
  const remote = stdout.trim();
  return remote.length === 0 ? undefined : remote;
}

async function readWorkspaceCacheKey(rootPath: string): Promise<string | undefined> {
  const configPath = join(rootPath, "skillset.yaml");
  let content: string;
  try {
    content = await readFile(configPath, "utf8");
  } catch (error) {
    if (isNotFoundError(error)) return undefined;
    throw error;
  }
  return readSkillsetWorkspaceConfig(parseYamlRecord(content, configPath), configPath).cacheKey;
}

function gitCommandEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined || key === "GIT_DIR" || key === "GIT_WORK_TREE") continue;
    env[key] = value;
  }
  return env;
}

async function isExistingDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch (error) {
    if (isNotFoundError(error)) return false;
    throw error;
  }
}

function isNotFoundError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function isConfirmedMissingError(error: unknown): boolean {
  return error instanceof Error && "code" in error && (error.code === "ENOENT" || error.code === "ENOTDIR");
}

function compareKnownSkillsetEntries(left: KnownSkillsetEntry, right: KnownSkillsetEntry): number {
  return left.path.localeCompare(right.path);
}
