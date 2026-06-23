import { isAbsolute, join, relative, resolve } from "node:path";

import { resolveInside } from "./path";
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
  if (isAbsolute(candidate)) return candidate;
  return resolveInside(context.rootPath, candidate);
}

export function logicalOperationalPath(
  context: OperationalPathContext,
  absolutePath: string
): string {
  const relativePath = relative(resolve(context.cacheRootPath), resolve(absolutePath));
  if (
    relativePath === "" ||
    (!relativePath.startsWith("..") && !relativePath.startsWith("../") && relativePath !== "..")
  ) {
    return join(REPO_OPERATIONAL_CACHE_ROOT, relativePath).replaceAll("\\", "/");
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
