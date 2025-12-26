import { mkdir, rename } from "node:fs/promises";
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

async function readCache(path: string): Promise<CacheSchema | null> {
  const file = Bun.file(path);
  if (!(await file.exists())) {
    return null;
  }
  try {
    const parsed = (await file.json()) as CacheSchema;
    return parsed;
  } catch (err) {
    console.warn(`skillset: failed to read cache ${path}:`, err);
    return null;
  }
}

export async function loadCaches(): Promise<CacheSchema> {
  const [project, user] = await Promise.all([
    readCache(CACHE_PATHS.project),
    readCache(CACHE_PATHS.user),
  ]);
  const projectCache = project ?? DEFAULT_CACHE;
  const userCache = user ?? DEFAULT_CACHE;
  // project overrides user for determinism within repo
  return {
    ...DEFAULT_CACHE,
    skills: { ...userCache.skills, ...projectCache.skills },
    structureTTL:
      projectCache.structureTTL ??
      userCache.structureTTL ??
      DEFAULT_CACHE.structureTTL,
    version: 1,
  };
}

async function ensureDir(path: string): Promise<void> {
  const dir = dirname(path);
  await mkdir(dir, { recursive: true });
}

export async function writeCache(path: string, cache: CacheSchema) {
  await ensureDir(path);
  const temp = `${path}.tmp`;
  await Bun.write(temp, JSON.stringify(cache, null, 2));
  await rename(temp, path);
}

export async function updateCache(
  target: "project" | "user",
  updater: (cache: CacheSchema) => CacheSchema
) {
  const path = CACHE_PATHS[target];
  const current = (await readCache(path)) ?? DEFAULT_CACHE;
  const next = updater(current);
  await writeCache(path, next);
}

export function isStructureFresh(skill: Skill, ttlSeconds: number): boolean {
  if (!skill.cachedAt) {
    return false;
  }
  const ageMs = Date.now() - new Date(skill.cachedAt).getTime();
  return ageMs < ttlSeconds * 1000;
}
