import { readFileSync } from "node:fs";
import { isAbsolute, join, sep } from "node:path";
import { getProjectRoot } from "@skillset/shared";
import type {
  CacheSchema,
  ConfigSchema,
  InvocationToken,
  ResolveResult,
  Scope,
  Skill,
  SkillEntry,
  SkillSet,
  Tool,
} from "@skillset/types";
import { loadCaches } from "../cache";
import { loadConfig } from "../config";
import { normalizeTokenRef, normalizeTokenSegment } from "../normalize";

const NAMESPACE_SHORTCUTS: Record<string, Scope> = {
  p: "project",
  proj: "project",
  project: "project",
  u: "user",
  g: "user",
  user: "user",
  global: "user",
  plugin: "plugin",
};

function resolveNamespace(input: string | undefined): string | undefined {
  if (!input) return undefined;
  const normalized = normalizeTokenSegment(input);
  return NAMESPACE_SHORTCUTS[normalized] ?? normalized;
}

function skillScope(skillRef: string): Scope | undefined {
  const prefix = skillRef.split(":")[0];
  if (prefix === "project" || prefix === "user" || prefix === "plugin") {
    return prefix;
  }
  return undefined;
}

function inferToolFromPath(path: string): Tool | undefined {
  if (path.includes(`${sep}.claude${sep}skills${sep}`)) return "claude";
  if (path.includes(`${sep}.codex${sep}skills${sep}`)) return "codex";
  if (path.includes(`${sep}.github${sep}skills${sep}`)) return "copilot";
  if (path.includes(`${sep}.cursor${sep}skills${sep}`)) return "cursor";
  if (path.includes(`${sep}.amp${sep}skills${sep}`)) return "amp";
  if (path.includes(`${sep}.goose${sep}skills${sep}`)) return "goose";
  return undefined;
}

function filterSkillsByConfig(cache: CacheSchema, config: ConfigSchema): Skill[] {
  const ignored = new Set(config.ignore_scopes ?? []);
  const tools = config.tools;
  return Object.values(cache.skills).filter((skill) => {
    const scope = skillScope(skill.skillRef);
    if (scope && ignored.has(scope)) return false;
    if (tools && tools.length > 0) {
      const tool = inferToolFromPath(skill.path);
      if (tool && !tools.includes(tool)) return false;
    }
    return true;
  });
}

function filterSetsByConfig(sets: Record<string, SkillSet>, config: ConfigSchema) {
  const ignored = new Set(config.ignore_scopes ?? []);
  return Object.values(sets).filter((set) => {
    const scope = skillScope(set.setRef);
    if (scope && ignored.has(scope)) return false;
    return true;
  });
}

function matchSkillAlias(
  skills: Skill[],
  alias: string,
  fuzzy: boolean
): Skill[] {
  const normalized = normalizeTokenSegment(alias);
  const normalizedLoose = normalized.replace(/-/g, "");
  return skills.filter((skill) => {
    const parts = normalizeTokenRef(skill.skillRef);
    const partsLoose = parts.replace(/-/g, "");
    const nameNormalized = normalizeTokenSegment(skill.name);
    const nameLoose = nameNormalized.replace(/-/g, "");
    const pathLower = skill.path.toLowerCase();

    const nameExact = nameNormalized === normalized || nameLoose === normalizedLoose;
    const refExact =
      parts.endsWith(`/${normalized}`) ||
      parts.endsWith(`:${normalized}`) ||
      parts === normalized ||
      partsLoose.endsWith(`/${normalizedLoose}`) ||
      partsLoose.endsWith(`:${normalizedLoose}`) ||
      partsLoose === normalizedLoose;

    if (!fuzzy) {
      return nameExact || refExact;
    }

    const nameMatch =
      nameNormalized.includes(normalized) || nameLoose.includes(normalizedLoose);
    const refMatch = refExact;
    const pathMatch =
      pathLower.includes(normalized) || pathLower.includes(normalizedLoose);
    return nameExact || nameMatch || refMatch || pathMatch;
  });
}

function matchSetAlias(sets: SkillSet[], alias: string, fuzzy: boolean): SkillSet[] {
  if (sets.length === 0) return [];
  const normalized = normalizeTokenSegment(alias);
  const normalizedLoose = normalized.replace(/-/g, "");
  return sets.filter((set) => {
    const parts = normalizeTokenRef(set.setRef);
    const partsLoose = parts.replace(/-/g, "");
    const nameNormalized = normalizeTokenSegment(set.name);
    const nameLoose = nameNormalized.replace(/-/g, "");

    const nameExact = nameNormalized === normalized || nameLoose === normalizedLoose;
    const refExact =
      parts.endsWith(`/${normalized}`) ||
      parts.endsWith(`:${normalized}`) ||
      parts === normalized ||
      partsLoose.endsWith(`/${normalizedLoose}`) ||
      partsLoose.endsWith(`:${normalizedLoose}`) ||
      partsLoose === normalizedLoose;

    if (!fuzzy) {
      return nameExact || refExact;
    }

    const nameMatch =
      nameNormalized.includes(normalized) || nameLoose.includes(normalizedLoose);
    const refMatch = refExact;
    return nameExact || nameMatch || refMatch;
  });
}

function findSkillEntry(
  skills: Record<string, SkillEntry>,
  alias: string,
  normalizedAlias: string
): { key: string; entry: SkillEntry } | undefined {
  if (skills[alias]) return { key: alias, entry: skills[alias] };
  if (normalizedAlias && skills[normalizedAlias]) {
    return { key: normalizedAlias, entry: skills[normalizedAlias] };
  }
  const lower = alias.toLowerCase();
  for (const [key, entry] of Object.entries(skills)) {
    if (key.toLowerCase() === lower) return { key, entry };
    if (normalizeTokenRef(key) === normalizedAlias) return { key, entry };
  }
  return undefined;
}

function readSkillFromPath(path: string, aliasKey: string, projectRoot: string): Skill | undefined {
  const resolved = isAbsolute(path) ? path : join(projectRoot, path);
  try {
    const content = readFileSync(resolved, "utf8");
    const lines = content.split(/\r?\n/);
    const firstHeading = lines.find((line) => line.startsWith("#"));
    const fallbackName = normalizeTokenSegment(aliasKey) || aliasKey;
    const name = firstHeading
      ? firstHeading.replace(/^#+\s*/, "").trim()
      : fallbackName;
    const description = lines.find((line) => line.trim().length > 0 && !line.startsWith("#"))?.trim();
    return {
      skillRef: `project:${normalizeTokenRef(aliasKey)}`,
      path: resolved,
      name,
      description,
      structure: undefined,
      lineCount: lines.length,
      cachedAt: undefined,
    };
  } catch {
    return undefined;
  }
}

function looksLikePath(value: string): boolean {
  return value.includes("/") || value.includes("\\") || value.endsWith(".md");
}

function applyScopeFilter(skills: Skill[], scope?: Scope | Scope[]): Skill[] {
  if (!scope) return skills;
  const scopes = Array.isArray(scope) ? scope : [scope];
  return skills.filter((skill) => {
    const skillScopeValue = skillScope(skill.skillRef);
    return skillScopeValue ? scopes.includes(skillScopeValue) : false;
  });
}

function pickByScopePriority(
  candidates: Skill[],
  config: ConfigSchema
): Skill | undefined {
  if (candidates.length <= 1) return candidates[0];
  const priority =
    config.resolution?.default_scope_priority ?? ["project", "user", "plugin"];
  for (const scope of priority) {
    const scoped = candidates.filter((skill) => skillScope(skill.skillRef) === scope);
    if (scoped.length === 1) return scoped[0];
    if (scoped.length > 1) return undefined;
  }
  return undefined;
}

function resolveSkillEntry(
  entry: SkillEntry,
  aliasKey: string,
  config: ConfigSchema,
  cache: CacheSchema,
  skills: Skill[],
  projectRoot: string
): { skill?: Skill; candidates?: Skill[] } {
  if (typeof entry === "string") {
    if (looksLikePath(entry)) {
      const skill = readSkillFromPath(entry, aliasKey, projectRoot);
      return skill ? { skill } : {};
    }
    const normalized = normalizeTokenRef(entry);
    const direct = cache.skills[entry] ?? cache.skills[normalized];
    if (direct) return { skill: direct };
    const candidates = matchSkillAlias(skills, normalized, config.resolution?.fuzzy_matching ?? true);
    const selected = pickByScopePriority(candidates, config);
    if (selected) return { skill: selected };
    return candidates.length ? { candidates } : {};
  }

  if (entry.path) {
    const skill = readSkillFromPath(entry.path, aliasKey, projectRoot);
    return skill ? { skill } : {};
  }

  const target = entry.skill ?? aliasKey;
  const normalized = normalizeTokenRef(target);
  const direct = cache.skills[target] ?? cache.skills[normalized];
  if (direct) return { skill: direct };

  const filtered = applyScopeFilter(skills, entry.scope);
  const candidates = matchSkillAlias(
    filtered,
    normalized,
    config.resolution?.fuzzy_matching ?? true
  );
  const selected = pickByScopePriority(candidates, config);
  if (selected) return { skill: selected };
  return candidates.length ? { candidates } : {};
}

function resolveAliasToSkill(
  alias: string,
  config: ConfigSchema,
  cache: CacheSchema,
  skills: Skill[],
  projectRoot: string
): Skill | undefined {
  const normalized = normalizeTokenRef(alias);
  const direct = cache.skills[alias] ?? cache.skills[normalized];
  if (direct) return direct;

  const entryMatch = findSkillEntry(config.skills, alias, normalized);
  if (entryMatch) {
    const resolved = resolveSkillEntry(
      entryMatch.entry,
      entryMatch.key,
      config,
      cache,
      skills,
      projectRoot
    );
    if (resolved.skill) return resolved.skill;
  }

  const candidates = matchSkillAlias(
    skills,
    normalized,
    config.resolution?.fuzzy_matching ?? true
  );
  const selected = pickByScopePriority(candidates, config);
  return selected;
}

function buildSetIndex(
  cache: CacheSchema,
  config: ConfigSchema
): Record<string, SkillSet> {
  const sets: Record<string, SkillSet> = {};
  if (cache.sets) {
    for (const set of Object.values(cache.sets)) {
      const ref = normalizeTokenRef(set.setRef);
      if (!ref) continue;
      sets[ref] = { ...set, setRef: ref };
    }
  }
  if (config.sets) {
    for (const [key, definition] of Object.entries(config.sets)) {
      const ref = normalizeTokenRef(key);
      if (!ref) continue;
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

function filterByNamespace<T>(
  items: T[],
  namespace: string,
  getRef: (item: T) => string
): T[] {
  return items.filter((item) => {
    const ref = getRef(item);
    return (
      ref.startsWith(`${namespace}:`) ||
      ref.startsWith(`${namespace}/`) ||
      ref.startsWith(`${namespace}`)
    );
  });
}

export function resolveToken(
  token: InvocationToken,
  config?: ConfigSchema,
  cache?: CacheSchema
): ResolveResult {
  const cfg = config ?? loadConfig();
  const c = cache ?? loadCaches();
  const projectRoot = getProjectRoot();
  const skills = filterSkillsByConfig(c, cfg);
  const setsIndex = buildSetIndex(c, cfg);
  const filteredSets = filterSetsByConfig(setsIndex, cfg);

  const normalizedAlias = normalizeTokenRef(token.alias);
  if (!normalizedAlias) {
    return { invocation: token, reason: "unmatched" };
  }

  const namespace = resolveNamespace(token.namespace);

  // 1) explicit mapping via config.skills
  const entryMatch = findSkillEntry(cfg.skills, token.alias, normalizedAlias);
  if (entryMatch) {
    const resolved = resolveSkillEntry(
      entryMatch.entry,
      entryMatch.key,
      cfg,
      c,
      skills,
      projectRoot
    );
    if (resolved.skill) return { invocation: token, skill: resolved.skill };
    if (resolved.candidates) {
      return { invocation: token, reason: "ambiguous", candidates: resolved.candidates };
    }
    return {
      invocation: token,
      reason: `mapping points to missing ref ${entryMatch.key}`,
    };
  }

  const fuzzy = cfg.resolution?.fuzzy_matching ?? true;

  // 2) If kind is explicitly specified, only search that type
  if (token.kind === "skill") {
    let skillCandidates = matchSkillAlias(skills, normalizedAlias, fuzzy);
    if (namespace) {
      skillCandidates = filterByNamespace(
        skillCandidates,
        namespace,
        (s) => s.skillRef
      );
    }

    if (skillCandidates.length === 0) {
      return { invocation: token, reason: "unmatched" };
    }
    if (skillCandidates.length === 1 && skillCandidates[0]) {
      return { invocation: token, skill: skillCandidates[0] };
    }

    const selected = pickByScopePriority(skillCandidates, cfg);
    if (selected) return { invocation: token, skill: selected };

    return {
      invocation: token,
      reason: "ambiguous",
      candidates: skillCandidates,
    };
  }

  if (token.kind === "set") {
    let setCandidates = matchSetAlias(filteredSets, normalizedAlias, fuzzy);
    if (namespace) {
      setCandidates = filterByNamespace(setCandidates, namespace, (s) => s.setRef);
    }

    if (setCandidates.length === 0) {
      return { invocation: token, reason: "unmatched" };
    }
    if (setCandidates.length === 1 && setCandidates[0]) {
      const setSkills = setCandidates[0].skillRefs
        .map((ref) =>
          resolveAliasToSkill(ref, cfg, c, skills, projectRoot)
        )
        .filter((skill): skill is Skill => Boolean(skill));
      return { invocation: token, set: setCandidates[0], setSkills };
    }
    return { invocation: token, reason: "ambiguous-set", setCandidates };
  }

  // 3) No kind specified - search both skills and sets
  let skillCandidates = matchSkillAlias(skills, normalizedAlias, fuzzy);
  let setCandidates = matchSetAlias(filteredSets, normalizedAlias, fuzzy);

  if (namespace) {
    skillCandidates = filterByNamespace(skillCandidates, namespace, (s) => s.skillRef);
    setCandidates = filterByNamespace(setCandidates, namespace, (s) => s.setRef);
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
    if (skillCandidates.length === 1 && skillCandidates[0]) {
      return { invocation: token, skill: skillCandidates[0] };
    }
    const selected = pickByScopePriority(skillCandidates, cfg);
    if (selected) return { invocation: token, skill: selected };
    return {
      invocation: token,
      reason: "ambiguous",
      candidates: skillCandidates,
    };
  }

  // Only set matches
  if (setCandidates.length > 0) {
    if (setCandidates.length === 1 && setCandidates[0]) {
      const setSkills = setCandidates[0].skillRefs
        .map((ref) =>
          resolveAliasToSkill(ref, cfg, c, skills, projectRoot)
        )
        .filter((skill): skill is Skill => Boolean(skill));
      return { invocation: token, set: setCandidates[0], setSkills };
    }
    return { invocation: token, reason: "ambiguous-set", setCandidates };
  }

  // No matches
  return { invocation: token, reason: "unmatched" };
}

export function resolveTokens(
  tokens: InvocationToken[],
  config?: ConfigSchema,
  cache?: CacheSchema
): ResolveResult[] {
  const cfg = config ?? loadConfig();
  const c = cache ?? loadCaches();
  return tokens.map((token) => resolveToken(token, cfg, c));
}
