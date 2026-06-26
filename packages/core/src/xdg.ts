import { createHash } from "node:crypto";
import { homedir, hostname } from "node:os";
import { basename, isAbsolute, join, resolve } from "node:path";

import { readRecord } from "./config";
import type { JsonRecord, RuntimeTesterClaudeSettingSources, SkillsetWorkspaceConfig } from "./types";

export type { SkillsetWorkspaceConfig } from "./types";

const SKILLSET_XDG_DIR = "skillset";
const FALLBACK_HASH_LENGTH = 12;
const REPO_CACHE_KEY_PATTERN = /^[a-z0-9][a-z0-9._-]*(?:--[a-z0-9][a-z0-9._-]*)*$/;

export type SkillsetXdgKind = "cache" | "config" | "data" | "state";
export type RepoCacheKeySource = "explicit" | "fallback" | "remote";

export interface SkillsetXdgOptions {
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly homeDir?: string;
}

export interface SkillsetXdgPaths {
  readonly cache: string;
  readonly config: string;
  readonly data: string;
  readonly state: string;
}

export interface RepoCacheKeyOptions {
  /** @deprecated Remote identity no longer affects operational cache bucket keys. */
  readonly hostQualified?: boolean;
  readonly hostName?: string;
  /** @deprecated Remote identity no longer affects operational cache bucket keys. */
  readonly remoteUrl?: string;
  readonly rootPath: string;
  readonly workspaceCacheKey?: string;
}

export interface RepoCacheKeyResult {
  readonly key: string;
  readonly source: RepoCacheKeySource;
}

export interface RepoCachePathOptions extends RepoCacheKeyOptions, SkillsetXdgOptions {}

export interface RepoCachePathResult extends RepoCacheKeyResult {
  readonly path: string;
  readonly xdgCacheBase: string;
}

export function readSkillsetWorkspaceConfig(record: JsonRecord, label: string): SkillsetWorkspaceConfig {
  const workspace = readRecord(record, "workspace");
  const runtimeTester = readRuntimeTesterWorkspaceConfig(readRecord(record, "runtimeTester"), `${label}.runtimeTester`);
  if (workspace === undefined) return runtimeTester === undefined ? {} : { runtimeTester };
  for (const key of Object.keys(workspace)) {
    if (key !== "cacheKey") {
      throw new Error(`skillset: unsupported workspace key ${key} in ${label}.workspace`);
    }
  }

  const cacheKey = workspace.cacheKey;
  if (cacheKey === undefined) return runtimeTester === undefined ? {} : { runtimeTester };
  if (typeof cacheKey !== "string" || cacheKey.trim() !== cacheKey || cacheKey.length === 0) {
    throw new Error(`skillset: expected ${label}.workspace.cacheKey to be a lowercase repo cache key`);
  }
  return {
    cacheKey: validateRepoCacheKey(cacheKey, `${label}.workspace.cacheKey`),
    ...(runtimeTester === undefined ? {} : { runtimeTester }),
  };
}

function readRuntimeTesterWorkspaceConfig(
  runtimeTester: JsonRecord | undefined,
  label: string
): SkillsetWorkspaceConfig["runtimeTester"] {
  if (runtimeTester === undefined) return undefined;
  for (const key of Object.keys(runtimeTester)) {
    if (key !== "claude") throw new Error(`skillset: unsupported runtime tester key ${key} in ${label}`);
  }
  const claude = readRecord(runtimeTester, "claude");
  if (claude === undefined) return {};
  for (const key of Object.keys(claude)) {
    if (key !== "settingSources") throw new Error(`skillset: unsupported runtime tester Claude key ${key} in ${label}.claude`);
  }
  const settingSources = claude.settingSources;
  if (settingSources === undefined) return { claude: {} };
  return {
    claude: {
      settingSources: readRuntimeTesterClaudeSettingSources(settingSources, `${label}.claude.settingSources`),
    },
  };
}

function readRuntimeTesterClaudeSettingSources(value: unknown, label: string): RuntimeTesterClaudeSettingSources {
  if (value === "isolated" || value === "user" || value === "project" || value === "local") return value;
  throw new Error(`skillset: expected ${label} to be isolated, user, project, or local`);
}

export function resolveSkillsetXdgPaths(options: SkillsetXdgOptions = {}): SkillsetXdgPaths {
  const env = options.env ?? process.env;
  const home = options.homeDir ?? homedir();
  return {
    cache: join(readXdgBase(env.XDG_CACHE_HOME, home, ".cache"), SKILLSET_XDG_DIR),
    config: join(readXdgBase(env.XDG_CONFIG_HOME, home, ".config"), SKILLSET_XDG_DIR),
    data: join(readXdgBase(env.XDG_DATA_HOME, home, ".local/share"), SKILLSET_XDG_DIR),
    state: join(readXdgBase(env.XDG_STATE_HOME, home, ".local/state"), SKILLSET_XDG_DIR),
  };
}

export function resolveRepoCacheKey(options: RepoCacheKeyOptions): RepoCacheKeyResult {
  if (options.workspaceCacheKey !== undefined) {
    return {
      key: validateRepoCacheKey(options.workspaceCacheKey, "workspace.cacheKey"),
      source: "explicit",
    };
  }

  return {
    key: `${slugPart(basename(resolve(options.rootPath)), "repo basename")}--local-${fallbackHash(options.rootPath, options.hostName ?? hostname())}`,
    source: "fallback",
  };
}

export function resolveRepoCachePath(options: RepoCachePathOptions): RepoCachePathResult {
  const xdgCacheBase = resolveSkillsetXdgPaths(options).cache;
  const result = resolveRepoCacheKey(options);
  return {
    ...result,
    path: join(xdgCacheBase, result.key),
    xdgCacheBase,
  };
}

function readXdgBase(value: string | undefined, home: string, fallback: string): string {
  if (value === undefined || value.trim().length === 0 || !isAbsolute(value)) {
    return join(home, fallback);
  }
  return value;
}

function slugPart(value: string, label: string): string {
  const slug = value.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  if (slug.length === 0) {
    throw new Error(`skillset: expected ${label} to produce a repo cache key segment`);
  }
  return slug;
}

function validateRepoCacheKey(value: string, label: string): string {
  const trimmed = value.trim();
  if (!REPO_CACHE_KEY_PATTERN.test(trimmed)) {
    throw new Error(`skillset: expected ${label} to be a lowercase repo cache key`);
  }
  return trimmed;
}

function fallbackHash(rootPath: string, hostName: string): string {
  const normalizedHost = hostName.trim().toLowerCase();
  return createHash("sha256")
    .update(normalizedHost)
    .update("\0")
    .update(resolve(rootPath))
    .digest("hex")
    .slice(0, FALLBACK_HASH_LENGTH);
}
