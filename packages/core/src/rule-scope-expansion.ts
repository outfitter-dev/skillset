import { join, resolve } from "node:path";

import { compareStrings, isPathInside, resolveInside } from "./path";
import type { SourceRule, SourceRuleSegment } from "./types";
import { lstat, readdir } from "./workspace-fs";

export function hasWildcardRuleScope(rule: SourceRule): boolean {
  return (
    rule.segments?.some((segment) => segment.classification !== "literal") ===
    true
  );
}

/** One graph-local directory observation, shared by every wildcard rule. */
export async function expandWildcardRuleScopes(
  rootPath: string,
  rules: readonly SourceRule[],
  excludedRoots: readonly string[]
): Promise<readonly SourceRule[]> {
  if (!rules.some(hasWildcardRuleScope)) return rules;
  const root = resolve(rootPath);
  // A workspace lock at '.' is bookkeeping, not a generated directory tree.
  const excluded = excludedRoots
    .map((path) => resolve(path))
    .filter((path) => path !== root);
  const observations = new Map<string, Promise<readonly string[]>>();
  const children = (directory: string): Promise<readonly string[]> => {
    const existing = observations.get(directory);
    if (existing !== undefined) return existing;
    const observation = readChildren(directory);
    observations.set(directory, observation);
    return observation;
  };
  async function readChildren(directory: string): Promise<readonly string[]> {
    const absolute = directory === "" ? root : resolveInside(root, directory);
    try {
      const info = await lstat(absolute);
      if (!info.isDirectory() || info.isSymbolicLink()) return [];
      const entries = await readdir(absolute, { withFileTypes: true });
      return entries
        .filter((entry) => {
          if (
            entry.name.startsWith(".") ||
            entry.name === "node_modules" ||
            !entry.isDirectory() ||
            entry.isSymbolicLink()
          )
            return false;
          const path = join(absolute, entry.name);
          return !excluded.some((exclusion) =>
            isPathInside(exclusion, path, { allowEqual: true })
          );
        })
        .map((entry) => entry.name)
        .sort(compareStrings);
    } catch (error) {
      if (
        (error as NodeJS.ErrnoException).code === "ENOENT" ||
        (error as NodeJS.ErrnoException).code === "ENOTDIR"
      )
        return [];
      throw error;
    }
  }
  async function expand(
    segments: readonly SourceRuleSegment[]
  ): Promise<readonly string[]> {
    const matches = new Set<string>();
    const visited = new Set<string>();
    async function visit(directory: string, index: number): Promise<void> {
      const key = `${index}:${directory}`;
      if (visited.has(key)) return;
      visited.add(key);
      const segment = segments[index];
      if (segment === undefined) {
        matches.add(directory);
        return;
      }
      if (segment.classification === "any-depth")
        await visit(directory, index + 1);
      for (const child of await children(directory)) {
        if (segment.classification === "literal" && child !== segment.value)
          continue;
        const next = directory === "" ? child : `${directory}/${child}`;
        // Recheck the child itself; a directory entry may have changed to a symlink.
        const info = await lstat(resolveInside(root, next)).catch((error) => {
          if ((error as NodeJS.ErrnoException).code === "ENOENT")
            return undefined;
          throw error;
        });
        if (info === undefined || !info.isDirectory() || info.isSymbolicLink())
          continue;
        await visit(
          next,
          segment.classification === "any-depth" ? index : index + 1
        );
      }
    }
    await visit("", 0);
    return [...matches].sort(compareStrings);
  }
  const result: SourceRule[] = [];
  for (const rule of rules) {
    result.push(
      hasWildcardRuleScope(rule)
        ? { ...rule, expandedScopes: await expand(rule.segments ?? []) }
        : rule
    );
  }
  return result;
}

/** Destination context changes; authored identity and provenance do not. */
export function ruleAtConcreteScope(
  rule: SourceRule,
  scopeDir: string
): SourceRule {
  const scopeSegments = scopeDir === "" ? [] : scopeDir.split("/");
  return {
    ...rule,
    scopeDir,
    scopeSegments,
    segments: scopeSegments.map((value) => ({
      value,
      classification: "literal",
    })),
  };
}
