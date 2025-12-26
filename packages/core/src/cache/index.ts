import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { getCacheDir, getProjectRoot } from "@skillset/shared";
import type { CacheSchema, Skill } from "@skillset/types";

const DEFAULT_CACHE: CacheSchema = {
  version: 1,
  structureTTL: 3600,
  skills: {},
};

export const CACHE_PATHS = {
  project: join(getProjectRoot(), ".skillset", "cache.json"),
  user: join(getCacheDir(), "cache.json"),
};

function readCache(path: string): CacheSchema | null {
  if (!existsSync(path)) {
    return null;
  }
  try {
    const content = readFileSync(path, "utf8");
    const parsed = JSON.parse(content) as CacheSchema;
    return parsed;
  } catch (err) {
    console.warn(`skillset: failed to read cache ${path}:`, err);
    return null;
  }
}

export function loadCaches(): CacheSchema {
  const project = readCache(CACHE_PATHS.project) ?? DEFAULT_CACHE;
  const user = readCache(CACHE_PATHS.user) ?? DEFAULT_CACHE;
  // project overrides user for determinism within repo
  return {
    ...DEFAULT_CACHE,
    skills: { ...user.skills, ...project.skills },
    structureTTL:
      project.structureTTL ?? user.structureTTL ?? DEFAULT_CACHE.structureTTL,
    version: 1,
  };
}

function ensureDir(path: string) {
  const dir = dirname(path);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

export function writeCacheSync(path: string, cache: CacheSchema) {
  ensureDir(path);
  const temp = `${path}.tmp`;
  writeFileSync(temp, JSON.stringify(cache, null, 2));
  renameSync(temp, path);
}

export function updateCacheSync(
  target: "project" | "user",
  updater: (cache: CacheSchema) => CacheSchema
) {
  const path = CACHE_PATHS[target];
  const current = readCache(path) ?? DEFAULT_CACHE;
  const next = updater(current);
  writeCacheSync(path, next);
}

export function isStructureFresh(skill: Skill, ttlSeconds: number): boolean {
  if (!skill.cachedAt) {
    return false;
  }
  const ageMs = Date.now() - new Date(skill.cachedAt).getTime();
  return ageMs < ttlSeconds * 1000;
}
