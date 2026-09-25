import { isAbsolute, join, relative, resolve } from "node:path";

import { isPathInside, resolveInside } from "./path";
import { resolveRepoCachePath, type SkillsetXdgOptions } from "./xdg";

export const REPO_OPERATIONAL_CACHE_ROOT = ".skillset/cache";

export interface OperationalCacheOptions extends SkillsetXdgOptions {
  readonly workspaceCacheKey?: string;
}

export interface OperationalPathContext {
  readonly cacheRootPath: string;
  readonly rootPath: string;
}

export function createOperationalPathContext(
  rootPath: string,
  options: OperationalCacheOptions = {}
): OperationalPathContext {
  return {
    cacheRootPath: resolveRepoOperationalCachePath(rootPath, options),
    rootPath,
  };
}

export function resolveRepoOperationalCachePath(
  rootPath: string,
  options: OperationalCacheOptions = {}
): string {
  return resolveRepoCachePath({
    rootPath,
    ...(options.workspaceCacheKey === undefined ? {} : { workspaceCacheKey: options.workspaceCacheKey }),
    ...(options.env === undefined ? {} : { env: options.env }),
    ...(options.homeDir === undefined ? {} : { homeDir: options.homeDir }),
  }).path;
}

export function resolveOperationalPath(
  context: OperationalPathContext,
  candidate: string
): string {
  if (isRepoOperationalCachePath(candidate)) {
    const suffix = operationalCacheSuffix(candidate);
    return suffix.length === 0 ? context.cacheRootPath : join(context.cacheRootPath, suffix);
  }
  if (isAbsolute(candidate)) {
    const resolved = resolve(candidate);
    if (
      isPathInside(resolve(context.rootPath), resolved, { allowEqual: true }) ||
      isPathInside(resolve(context.cacheRootPath), resolved, { allowEqual: true })
    ) {
      return resolved;
    }
    throw new Error(`skillset: refusing to operate outside repo root: ${candidate}`);
  }
  return resolveInside(context.rootPath, candidate);
}

export function logicalOperationalPath(
  context: OperationalPathContext,
  absolutePath: string
): string {
  const cacheRoot = resolve(context.cacheRootPath);
  const resolved = resolve(absolutePath);
  if (isPathInside(cacheRoot, resolved, { allowEqual: true })) {
    return join(REPO_OPERATIONAL_CACHE_ROOT, relative(cacheRoot, resolved)).replaceAll("\\", "/");
  }
  return relative(context.rootPath, absolutePath).replaceAll("\\", "/");
}

export function isRepoOperationalCachePath(candidate: string): boolean {
  const normalized = candidate.replaceAll("\\", "/").replace(/^\.\/+/, "");
  return normalized === REPO_OPERATIONAL_CACHE_ROOT || normalized.startsWith(`${REPO_OPERATIONAL_CACHE_ROOT}/`);
}

function operationalCacheSuffix(candidate: string): string {
  const normalized = candidate.replaceAll("\\", "/").replace(/^\.\/+/, "");
  if (normalized === REPO_OPERATIONAL_CACHE_ROOT) return "";
  return normalized.slice(REPO_OPERATIONAL_CACHE_ROOT.length + 1);
}
