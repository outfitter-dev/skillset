import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { basename, isAbsolute, join, resolve } from "node:path";

import { readRecord } from "./config";
import type { JsonRecord, SkillsetWorkspaceConfig } from "./types";

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
  readonly hostQualified?: boolean;
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

interface ParsedRemote {
  readonly host: string;
  readonly pathParts: readonly string[];
}

export function readSkillsetWorkspaceConfig(record: JsonRecord, label: string): SkillsetWorkspaceConfig {
  const workspace = readRecord(record, "workspace");
  if (workspace === undefined) return {};
  for (const key of Object.keys(workspace)) {
    if (key !== "cacheKey") {
      throw new Error(`skillset: unsupported workspace key ${key} in ${label}.workspace`);
    }
  }

  const cacheKey = workspace.cacheKey;
  if (cacheKey === undefined) return {};
  if (typeof cacheKey !== "string" || cacheKey.trim() !== cacheKey || cacheKey.length === 0) {
    throw new Error(`skillset: expected ${label}.workspace.cacheKey to be a lowercase repo cache key`);
  }
  return { cacheKey: validateRepoCacheKey(cacheKey, `${label}.workspace.cacheKey`) };
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

  const remote = parseGitRemote(options.remoteUrl);
  if (remote !== undefined) {
    const pathKey = remote.pathParts.map((part) => slugPart(part, "git remote path")).join("--");
    return {
      key: options.hostQualified === true
        ? `${slugPart(remote.host, "git remote host")}--${pathKey}`
        : pathKey,
      source: "remote",
    };
  }

  return {
    key: `${slugPart(basename(resolve(options.rootPath)), "repo basename")}--${fallbackHash(options.rootPath)}`,
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

function parseGitRemote(remoteUrl: string | undefined): ParsedRemote | undefined {
  if (remoteUrl === undefined || remoteUrl.trim().length === 0) return undefined;
  const trimmed = remoteUrl.trim();
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) {
    try {
      const url = new URL(trimmed);
      if (url.hostname.length === 0) return undefined;
      return parsedRemoteFromParts(url.hostname, url.pathname);
    } catch {
      return undefined;
    }
  }

  const scpLike = /^(?:[^@/:]+@)?([^/:]+):(.+)$/.exec(trimmed);
  if (scpLike !== null) return parsedRemoteFromParts(scpLike[1], scpLike[2]);

  try {
    const url = new URL(trimmed);
    if (url.hostname.length === 0) return undefined;
    return parsedRemoteFromParts(url.hostname, url.pathname);
  } catch {
    return undefined;
  }
}

function parsedRemoteFromParts(host: string | undefined, rawPath: string | undefined): ParsedRemote | undefined {
  if (host === undefined || rawPath === undefined) return undefined;
  const normalizedPath = rawPath.replace(/^\/+|\/+$/g, "");
  const parts = normalizedPath.split("/").filter(Boolean);
  if (parts.length < 2) return undefined;
  const last = parts.at(-1);
  if (last !== undefined) {
    parts[parts.length - 1] = last.replace(/\.git$/i, "");
  }
  return {
    host: host.toLowerCase(),
    pathParts: parts,
  };
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

function fallbackHash(rootPath: string): string {
  return createHash("sha256").update(resolve(rootPath)).digest("hex").slice(0, FALLBACK_HASH_LENGTH);
}
