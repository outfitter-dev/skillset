import { readFileSync } from "node:fs";
import { isAbsolute, join, resolve, sep } from "node:path";
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

const DASH_REGEX = /-/g;
const LINE_SPLIT_REGEX = /\r?\n/;
const HEADING_PREFIX_REGEX = /^#+\s*/;

function resolveNamespace(input: string | undefined): string | undefined {
  if (!input) {
    return undefined;
  }
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
  const resolvedPath = isAbsolute(path) ? path : resolve(path);
  const codexHome = process.env.CODEX_HOME;
  if (codexHome) {
    const codexSkills = resolve(codexHome, "skills");
    if (
      resolvedPath === codexSkills ||
      resolvedPath.startsWith(`${codexSkills}${sep}`)
    ) {
      return "codex";
    }
  }
  if (resolvedPath.includes(`${sep}.claude${sep}skills${sep}`)) {
    return "claude";
  }
  if (resolvedPath.includes(`${sep}.codex${sep}skills${sep}`)) {
    return "codex";
  }
  if (resolvedPath.includes(`${sep}.github${sep}skills${sep}`)) {
    return "copilot";
  }
  if (resolvedPath.includes(`${sep}.cursor${sep}skills${sep}`)) {
    return "cursor";
  }
  if (resolvedPath.includes(`${sep}.amp${sep}skills${sep}`)) {
    return "amp";
  }
  if (resolvedPath.includes(`${sep}.goose${sep}skills${sep}`)) {
    return "goose";
  }
  return undefined;
}

function filterSkillsByConfig(
  cache: CacheSchema,
  config: ConfigSchema
): Skill[] {
  const ignored = new Set(config.ignore_scopes ?? []);
  const tools = config.tools;
  return Object.values(cache.skills).filter((skill) => {
    const scope = skillScope(skill.skillRef);
    if (scope && ignored.has(scope)) {
      return false;
    }
    if (tools && tools.length > 0) {
      const tool = inferToolFromPath(skill.path);
      if (tool && !tools.includes(tool)) {
        return false;
      }
    }
    return true;
  });
}

function filterSetsByConfig(
  sets: Record<string, SkillSet>,
  config: ConfigSchema
) {
  const ignored = new Set(config.ignore_scopes ?? []);
  return Object.values(sets).filter((set) => {
    const scope = skillScope(set.setRef);
    if (scope && ignored.has(scope)) {
      return false;
    }
    return true;
  });
}

function matchSkillAlias(
  skills: Skill[],
  alias: string,
  fuzzy: boolean
): Skill[] {
  const normalized = normalizeTokenSegment(alias);
  const normalizedLoose = normalized.replace(DASH_REGEX, "");
  return skills.filter((skill) => {
    const parts = normalizeTokenRef(skill.skillRef);
    const partsLoose = parts.replace(DASH_REGEX, "");
    const nameNormalized = normalizeTokenSegment(skill.name);
    const nameLoose = nameNormalized.replace(DASH_REGEX, "");
    const pathLower = skill.path.toLowerCase();

    const nameExact =
      nameNormalized === normalized || nameLoose === normalizedLoose;
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
      nameNormalized.includes(normalized) ||
      nameLoose.includes(normalizedLoose);
    const refMatch = refExact;
    const pathMatch =
      pathLower.includes(normalized) || pathLower.includes(normalizedLoose);
    return nameExact || nameMatch || refMatch || pathMatch;
  });
}

function matchSetAlias(
  sets: SkillSet[],
  alias: string,
  fuzzy: boolean
): SkillSet[] {
  if (sets.length === 0) {
    return [];
  }
  const normalized = normalizeTokenSegment(alias);
  const normalizedLoose = normalized.replace(DASH_REGEX, "");
  return sets.filter((set) => {
    const parts = normalizeTokenRef(set.setRef);
    const partsLoose = parts.replace(DASH_REGEX, "");
    const nameNormalized = normalizeTokenSegment(set.name);
    const nameLoose = nameNormalized.replace(DASH_REGEX, "");

    const nameExact =
      nameNormalized === normalized || nameLoose === normalizedLoose;
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
      nameNormalized.includes(normalized) ||
      nameLoose.includes(normalizedLoose);
    const refMatch = refExact;
    return nameExact || nameMatch || refMatch;
  });
}

function findSkillEntry(
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

function readSkillFromPath(
  path: string,
  aliasKey: string,
  projectRoot: string
): Skill | undefined {
  const resolved = isAbsolute(path) ? path : join(projectRoot, path);
  try {
    const content = readFileSync(resolved, "utf8");
    const lines = content.split(LINE_SPLIT_REGEX);
    const firstHeading = lines.find((line) => line.startsWith("#"));
    const fallbackName = normalizeTokenSegment(aliasKey) || aliasKey;
    const name = firstHeading
      ? firstHeading.replace(HEADING_PREFIX_REGEX, "").trim()
      : fallbackName;
    const description = lines
      .find((line) => line.trim().length > 0 && !line.startsWith("#"))
      ?.trim();
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
  if (!scope) {
    return skills;
  }
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
  if (candidates.length <= 1) {
    return candidates[0];
  }
  const priority = config.resolution?.default_scope_priority ?? [
    "project",
    "user",
    "plugin",
  ];
  for (const scope of priority) {
    const scoped = candidates.filter(
      (skill) => skillScope(skill.skillRef) === scope
    );
    if (scoped.length === 1) {
      return scoped[0];
    }
    if (scoped.length > 1) {
      return undefined;
    }
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
    return resolveStringEntry(
      entry,
      aliasKey,
      config,
      cache,
      skills,
      projectRoot
    );
  }

  return resolveObjectEntry(
    entry,
    aliasKey,
    config,
    cache,
    skills,
    projectRoot
  );
}

function resolveStringEntry(
  entry: string,
  aliasKey: string,
  config: ConfigSchema,
  cache: CacheSchema,
  skills: Skill[],
  projectRoot: string
): { skill?: Skill; candidates?: Skill[] } {
  if (looksLikePath(entry)) {
    const skill = readSkillFromPath(entry, aliasKey, projectRoot);
    return skill ? { skill } : {};
  }

  return resolveByAlias(entry, skills, config, cache);
}

function resolveObjectEntry(
  entry: Exclude<SkillEntry, string>,
  aliasKey: string,
  config: ConfigSchema,
  cache: CacheSchema,
  skills: Skill[],
  projectRoot: string
): { skill?: Skill; candidates?: Skill[] } {
  if (entry.path) {
    const skill = readSkillFromPath(entry.path, aliasKey, projectRoot);
    return skill ? { skill } : {};
  }

  const target = entry.skill ?? aliasKey;
  const filtered = applyScopeFilter(skills, entry.scope);
  return resolveByAlias(target, filtered, config, cache);
}

function resolveByAlias(
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

function resolveAliasToSkill(
  alias: string,
  config: ConfigSchema,
  cache: CacheSchema,
  skills: Skill[],
  projectRoot: string
): Skill | undefined {
  const normalized = normalizeTokenRef(alias);
  const direct = cache.skills[alias] ?? cache.skills[normalized];
  if (direct) {
    return direct;
  }

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
    if (resolved.skill) {
      return resolved.skill;
    }
  }

  return resolveByAlias(alias, skills, config, cache).skill;
}

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

function filterByNamespace<T>(
  items: T[],
  namespace: string,
  getRef: (item: T) => string
): T[] {
  return items.filter((item) => {
    const ref = getRef(item);
    return (
      ref === namespace ||
      ref.startsWith(`${namespace}:`) ||
      ref.startsWith(`${namespace}/`)
    );
  });
}

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

function resolveSetCandidates(
  invocation: InvocationToken,
  candidates: SkillSet[],
  config: ConfigSchema,
  cache: CacheSchema,
  skills: Skill[],
  projectRoot: string
): ResolveResult {
  if (candidates.length === 0) {
    return { invocation, reason: "unmatched" };
  }
  if (candidates.length === 1 && candidates[0]) {
    const set = candidates[0];
    const setSkills = set.skillRefs
      .map((ref) =>
        resolveAliasToSkill(ref, config, cache, skills, projectRoot)
      )
      .filter((skill): skill is Skill => Boolean(skill));
    return { invocation, set, setSkills };
  }

  return { invocation, reason: "ambiguous-set", setCandidates: candidates };
}

function resolveFromConfigMapping(
  token: InvocationToken,
  normalizedAlias: string,
  config: ConfigSchema,
  cache: CacheSchema,
  skills: Skill[],
  projectRoot: string
): ResolveResult | undefined {
  const entryMatch = findSkillEntry(
    config.skills,
    token.alias,
    normalizedAlias
  );
  if (!entryMatch) {
    return undefined;
  }
  const resolved = resolveSkillEntry(
    entryMatch.entry,
    entryMatch.key,
    config,
    cache,
    skills,
    projectRoot
  );
  if (resolved.skill) {
    return { invocation: token, skill: resolved.skill };
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

function resolveTokenByKind(
  token: InvocationToken,
  normalizedAlias: string,
  namespace: string | undefined,
  skills: Skill[],
  sets: SkillSet[],
  config: ConfigSchema,
  cache: CacheSchema,
  projectRoot: string
): ResolveResult | undefined {
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
    return resolveSetCandidates(
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

function resolveTokenBySearch(
  token: InvocationToken,
  normalizedAlias: string,
  namespace: string | undefined,
  skills: Skill[],
  sets: SkillSet[],
  config: ConfigSchema,
  cache: CacheSchema,
  projectRoot: string
): ResolveResult {
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
    return resolveSetCandidates(
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

export async function resolveToken(
  token: InvocationToken,
  config?: ConfigSchema,
  cache?: CacheSchema
): Promise<ResolveResult> {
  const cfg = config ?? (await loadConfig());
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
  const mappingResult = resolveFromConfigMapping(
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
  const kindResult = resolveTokenByKind(
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
  return resolveTokenBySearch(
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

export async function resolveTokens(
  tokens: InvocationToken[],
  config?: ConfigSchema,
  cache?: CacheSchema
): Promise<ResolveResult[]> {
  const cfg = config ?? (await loadConfig());
  const c = cache ?? loadCaches();
  const results: ResolveResult[] = [];
  for (const token of tokens) {
    results.push(await resolveToken(token, cfg, c));
  }
  return results;
}
