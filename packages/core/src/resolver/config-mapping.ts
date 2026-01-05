import type {
  CacheSchema,
  ConfigSchema,
  InvocationToken,
  ResolveResult,
  Skill,
  SkillEntry,
} from "@skillset/types";
import { normalizeTokenRef } from "../normalize";
import { looksLikePath, readSkillFromPath } from "./file-resolver";
import { matchSkillAlias } from "./matching";
import { applyScopeFilter, pickByScopePriority } from "./scope";

/**
 * Finds a skill entry in the config by alias, trying various normalizations.
 *
 * @param skills - The skills mapping from config
 * @param alias - The alias to search for
 * @param normalizedAlias - The normalized form of the alias
 * @returns The matching key and entry, or undefined
 */
export function findSkillEntry(
  skills: Record<string, SkillEntry>,
  alias: string,
  normalizedAlias: string
): { key: string; entry: SkillEntry } | undefined {
  if (skills[alias]) {
    return { key: alias, entry: skills[alias] };
  }
  if (normalizedAlias && skills[normalizedAlias]) {
    return { key: normalizedAlias, entry: skills[normalizedAlias] };
  }
  const lower = alias.toLowerCase();
  for (const [key, entry] of Object.entries(skills)) {
    if (key.toLowerCase() === lower) {
      return { key, entry };
    }
    if (normalizeTokenRef(key) === normalizedAlias) {
      return { key, entry };
    }
  }
  return undefined;
}

/**
 * Resolves a skill entry (string or object) to a skill or candidates.
 *
 * @param entry - The skill entry from config
 * @param aliasKey - The alias key
 * @param config - Configuration schema
 * @param cache - Cache schema
 * @param skills - Array of available skills
 * @param projectRoot - Project root directory
 * @returns Object containing skill or candidates
 */
export async function resolveSkillEntry(
  entry: SkillEntry,
  aliasKey: string,
  config: ConfigSchema,
  cache: CacheSchema,
  skills: Skill[],
  projectRoot: string
): Promise<{
  skill?: Skill;
  candidates?: Skill[];
  include_full?: boolean;
  include_layout?: boolean;
}> {
  if (typeof entry === "string") {
    return await resolveStringEntry(
      entry,
      aliasKey,
      config,
      cache,
      skills,
      projectRoot
    );
  }

  return await resolveObjectEntry(
    entry,
    aliasKey,
    config,
    cache,
    skills,
    projectRoot
  );
}

/**
 * Resolves a string skill entry (either a path or an alias).
 */
async function resolveStringEntry(
  entry: string,
  aliasKey: string,
  config: ConfigSchema,
  cache: CacheSchema,
  skills: Skill[],
  projectRoot: string
): Promise<{
  skill?: Skill;
  candidates?: Skill[];
  include_full?: boolean;
  include_layout?: boolean;
}> {
  if (looksLikePath(entry)) {
    const skill = await readSkillFromPath(entry, aliasKey, projectRoot);
    return skill ? { skill } : {};
  }

  return resolveByAlias(entry, skills, config, cache);
}

/**
 * Resolves an object skill entry (with path or scope).
 */
async function resolveObjectEntry(
  entry: Exclude<SkillEntry, string>,
  aliasKey: string,
  config: ConfigSchema,
  cache: CacheSchema,
  skills: Skill[],
  projectRoot: string
): Promise<{
  skill?: Skill;
  candidates?: Skill[];
  include_full?: boolean;
  include_layout?: boolean;
}> {
  if (entry.path) {
    const skill = await readSkillFromPath(entry.path, aliasKey, projectRoot);
    if (!skill) {
      return {};
    }
    const result: {
      skill: Skill;
      include_full?: boolean;
      include_layout?: boolean;
    } = { skill };
    if (entry.include_full !== undefined) {
      result.include_full = entry.include_full;
    }
    if (entry.include_layout !== undefined) {
      result.include_layout = entry.include_layout;
    }
    return result;
  }

  const target = entry.skill ?? aliasKey;
  const filtered = applyScopeFilter(skills, entry.scope);
  const baseResult = resolveByAlias(target, filtered, config, cache);
  const result: {
    skill?: Skill;
    candidates?: Skill[];
    include_full?: boolean;
    include_layout?: boolean;
  } = { ...baseResult };
  if (entry.include_full !== undefined) {
    result.include_full = entry.include_full;
  }
  if (entry.include_layout !== undefined) {
    result.include_layout = entry.include_layout;
  }
  return result;
}

/**
 * Resolves a skill by alias, checking cache first then matching.
 */
export function resolveByAlias(
  target: string,
  skills: Skill[],
  config: ConfigSchema,
  cache: CacheSchema
): { skill?: Skill; candidates?: Skill[] } {
  const normalized = normalizeTokenRef(target);
  const direct = cache.skills[target] ?? cache.skills[normalized];
  if (direct) {
    return { skill: direct };
  }

  const candidates = matchSkillAlias(
    skills,
    normalized,
    config.resolution?.fuzzy_matching ?? true
  );
  const selected = pickByScopePriority(candidates, config);
  if (selected) {
    return { skill: selected };
  }
  return candidates.length ? { candidates } : {};
}

/**
 * Resolves a token using explicit config mapping.
 *
 * @param token - The invocation token
 * @param normalizedAlias - The normalized alias
 * @param config - Configuration schema
 * @param cache - Cache schema
 * @param skills - Array of available skills
 * @param projectRoot - Project root directory
 * @returns ResolveResult or undefined if no mapping found
 */
export async function resolveFromConfigMapping(
  token: InvocationToken,
  normalizedAlias: string,
  config: ConfigSchema,
  cache: CacheSchema,
  skills: Skill[],
  projectRoot: string
): Promise<ResolveResult | undefined> {
  const entryMatch = findSkillEntry(
    config.skills,
    token.alias,
    normalizedAlias
  );
  if (!entryMatch) {
    return undefined;
  }
  const resolved = await resolveSkillEntry(
    entryMatch.entry,
    entryMatch.key,
    config,
    cache,
    skills,
    projectRoot
  );
  if (resolved.skill) {
    const result: ResolveResult = {
      invocation: token,
      skill: resolved.skill,
    };
    if (resolved.include_full !== undefined) {
      result.include_full = resolved.include_full;
    }
    if (resolved.include_layout !== undefined) {
      result.include_layout = resolved.include_layout;
    }
    return result;
  }
  if (resolved.candidates) {
    return {
      invocation: token,
      reason: "ambiguous",
      candidates: resolved.candidates,
    };
  }
  return {
    invocation: token,
    reason: `mapping points to missing ref ${entryMatch.key}`,
  };
}
