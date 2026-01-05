import { getProjectRoot } from "@skillset/shared";
import type {
  CacheSchema,
  ConfigSchema,
  InvocationToken,
  ResolveResult,
  Skill,
  SkillSet,
} from "@skillset/types";
import { loadCaches } from "../cache";
import { loadConfig } from "../config";
import { normalizeTokenRef } from "../normalize";
import { resolveFromConfigMapping } from "./config-mapping";
import { matchSetAlias, matchSkillAlias } from "./matching";
import {
  filterByNamespace,
  filterSetsByConfig,
  filterSkillsByConfig,
  pickByScopePriority,
  resolveNamespace,
} from "./scope";

/**
 * Builds a unified index of skill sets from cache and config.
 *
 * @param cache - Cache schema containing cached sets
 * @param config - Config schema containing configured sets
 * @returns Record of normalized set references to skill sets
 */
function buildSetIndex(
  cache: CacheSchema,
  config: ConfigSchema
): Record<string, SkillSet> {
  const sets: Record<string, SkillSet> = {};
  if (cache.sets) {
    for (const set of Object.values(cache.sets)) {
      const ref = normalizeTokenRef(set.setRef);
      if (!ref) {
        continue;
      }
      sets[ref] = { ...set, setRef: ref };
    }
  }
  if (config.sets) {
    for (const [key, definition] of Object.entries(config.sets)) {
      const ref = normalizeTokenRef(key);
      if (!ref) {
        continue;
      }
      sets[ref] = {
        setRef: ref,
        name: definition.name,
        description: definition.description,
        skillRefs: definition.skills,
      };
    }
  }
  return sets;
}

/**
 * Resolves an alias to a skill, checking cache, config mapping, and fuzzy matching.
 *
 * @param alias - The alias to resolve
 * @param config - Configuration schema
 * @param cache - Cache schema
 * @param skills - Array of available skills
 * @param projectRoot - Project root directory
 * @returns The resolved skill or undefined
 */
async function resolveAliasToSkill(
  alias: string,
  config: ConfigSchema,
  cache: CacheSchema,
  skills: Skill[],
  projectRoot: string
): Promise<Skill | undefined> {
  const normalized = normalizeTokenRef(alias);
  const direct = cache.skills[alias] ?? cache.skills[normalized];
  if (direct) {
    return direct;
  }

  // Check config mapping
  const configMapping = await resolveFromConfigMapping(
    { raw: `$${alias}`, alias, namespace: undefined },
    normalized,
    config,
    cache,
    skills,
    projectRoot
  );
  if (configMapping?.skill) {
    return configMapping.skill;
  }

  // Fallback to fuzzy matching
  const candidates = matchSkillAlias(
    skills,
    normalized,
    config.resolution?.fuzzy_matching ?? true
  );
  return pickByScopePriority(candidates, config);
}

/**
 * Resolves skill candidates to a single skill or ambiguous result.
 */
function resolveSkillCandidates(
  invocation: InvocationToken,
  candidates: Skill[],
  config: ConfigSchema
): ResolveResult {
  if (candidates.length === 0) {
    return { invocation, reason: "unmatched" };
  }
  if (candidates.length === 1 && candidates[0]) {
    return { invocation, skill: candidates[0] };
  }

  const selected = pickByScopePriority(candidates, config);
  if (selected) {
    return { invocation, skill: selected };
  }

  return {
    invocation,
    reason: "ambiguous",
    candidates,
  };
}

/**
 * Resolves set candidates to a single set or ambiguous result.
 */
async function resolveSetCandidates(
  invocation: InvocationToken,
  candidates: SkillSet[],
  config: ConfigSchema,
  cache: CacheSchema,
  skills: Skill[],
  projectRoot: string
): Promise<ResolveResult> {
  if (candidates.length === 0) {
    return { invocation, reason: "unmatched" };
  }
  if (candidates.length === 1 && candidates[0]) {
    const set = candidates[0];
    const resolved = await Promise.all(
      set.skillRefs.map(async (ref) => ({
        ref,
        skill: await resolveAliasToSkill(
          ref,
          config,
          cache,
          skills,
          projectRoot
        ),
      }))
    );
    const setSkills = resolved
      .map((entry) => entry.skill)
      .filter((skill): skill is Skill => Boolean(skill));
    const missingSkillRefs = resolved
      .filter((entry) => !entry.skill)
      .map((entry) => entry.ref);
    return {
      invocation,
      set,
      setSkills,
      missingSkillRefs: missingSkillRefs.length ? missingSkillRefs : undefined,
    };
  }

  return { invocation, reason: "ambiguous-set", setCandidates: candidates };
}

/**
 * Resolves a token when kind is explicitly specified (skill or set).
 */
async function resolveTokenByKind(
  token: InvocationToken,
  normalizedAlias: string,
  namespace: string | undefined,
  skills: Skill[],
  sets: SkillSet[],
  config: ConfigSchema,
  cache: CacheSchema,
  projectRoot: string
): Promise<ResolveResult | undefined> {
  const fuzzy = config.resolution?.fuzzy_matching ?? true;
  if (token.kind === "skill") {
    let skillCandidates = matchSkillAlias(skills, normalizedAlias, fuzzy);
    if (namespace) {
      skillCandidates = filterByNamespace(
        skillCandidates,
        namespace,
        (s) => s.skillRef
      );
    }
    return resolveSkillCandidates(token, skillCandidates, config);
  }

  if (token.kind === "set") {
    let setCandidates = matchSetAlias(sets, normalizedAlias, fuzzy);
    if (namespace) {
      setCandidates = filterByNamespace(
        setCandidates,
        namespace,
        (s) => s.setRef
      );
    }
    return await resolveSetCandidates(
      token,
      setCandidates,
      config,
      cache,
      skills,
      projectRoot
    );
  }

  return undefined;
}

/**
 * Resolves a token by searching both skills and sets.
 * Handles collision detection when both skill and set match.
 */
async function resolveTokenBySearch(
  token: InvocationToken,
  normalizedAlias: string,
  namespace: string | undefined,
  skills: Skill[],
  sets: SkillSet[],
  config: ConfigSchema,
  cache: CacheSchema,
  projectRoot: string
): Promise<ResolveResult> {
  const fuzzy = config.resolution?.fuzzy_matching ?? true;
  let skillCandidates = matchSkillAlias(skills, normalizedAlias, fuzzy);
  let setCandidates = matchSetAlias(sets, normalizedAlias, fuzzy);

  if (namespace) {
    skillCandidates = filterByNamespace(
      skillCandidates,
      namespace,
      (s) => s.skillRef
    );
    setCandidates = filterByNamespace(
      setCandidates,
      namespace,
      (s) => s.setRef
    );
  }

  // Check for collision: both skill and set match
  if (skillCandidates.length > 0 && setCandidates.length > 0) {
    return {
      invocation: token,
      reason: "skill-set-collision",
      candidates: skillCandidates,
      setCandidates,
    };
  }

  // Only skill matches
  if (skillCandidates.length > 0) {
    return resolveSkillCandidates(token, skillCandidates, config);
  }

  // Only set matches
  if (setCandidates.length > 0) {
    return await resolveSetCandidates(
      token,
      setCandidates,
      config,
      cache,
      skills,
      projectRoot
    );
  }

  // No matches
  return { invocation: token, reason: "unmatched" };
}

/**
 * Resolves a single invocation token to a skill, set, or error result.
 *
 * Resolution follows this priority:
 * 1. Explicit config mapping (config.skills)
 * 2. Kind-specific search (if token.kind is set)
 * 3. General search across skills and sets
 *
 * @param token - The invocation token to resolve
 * @param config - Optional configuration (loaded if not provided)
 * @param cache - Optional cache (loaded if not provided)
 * @returns A resolve result containing the skill/set or error reason
 */
export async function resolveToken(
  token: InvocationToken,
  config?: ConfigSchema,
  cache?: CacheSchema
): Promise<ResolveResult> {
  const cfg = config ?? (await loadConfig());
  const c = cache ?? (await loadCaches());
  const projectRoot = getProjectRoot();
  const skills = filterSkillsByConfig(c.skills, cfg);
  const setsIndex = buildSetIndex(c, cfg);
  const filteredSets = filterSetsByConfig(setsIndex, cfg);

  const normalizedAlias = normalizeTokenRef(token.alias);
  if (!normalizedAlias) {
    return { invocation: token, reason: "unmatched" };
  }

  const namespace = resolveNamespace(token.namespace);

  // 1) explicit mapping via config.skills
  const mappingResult = await resolveFromConfigMapping(
    token,
    normalizedAlias,
    cfg,
    c,
    skills,
    projectRoot
  );
  if (mappingResult) {
    return mappingResult;
  }

  // 2) If kind is explicitly specified, only search that type
  const kindResult = await resolveTokenByKind(
    token,
    normalizedAlias,
    namespace,
    skills,
    filteredSets,
    cfg,
    c,
    projectRoot
  );
  if (kindResult) {
    return kindResult;
  }

  // 3) No kind specified - search both skills and sets
  return await resolveTokenBySearch(
    token,
    normalizedAlias,
    namespace,
    skills,
    filteredSets,
    cfg,
    c,
    projectRoot
  );
}

/**
 * Resolves multiple invocation tokens in sequence.
 *
 * @param tokens - Array of invocation tokens to resolve
 * @param config - Optional configuration (loaded if not provided)
 * @param cache - Optional cache (loaded if not provided)
 * @returns Array of resolve results
 */
export async function resolveTokens(
  tokens: InvocationToken[],
  config?: ConfigSchema,
  cache?: CacheSchema
): Promise<ResolveResult[]> {
  const cfg = config ?? (await loadConfig());
  const c = cache ?? (await loadCaches());
  const results: ResolveResult[] = [];
  for (const token of tokens) {
    results.push(await resolveToken(token, cfg, c));
  }
  return results;
}
