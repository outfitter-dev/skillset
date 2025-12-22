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
import { normalizeTokenRef, normalizeTokenSegment } from "../normalize";

function pickSkillByRef(cache: CacheSchema, ref: string): Skill | undefined {
  return cache.skills[ref];
}

function pickSetByRef(cache: CacheSchema, ref: string): SkillSet | undefined {
  return cache.sets?.[ref];
}

function matchSkillAlias(cache: CacheSchema, alias: string): Skill[] {
  const normalized = alias.toLowerCase();
  return Object.values(cache.skills).filter((skill) => {
    const parts = skill.skillRef.toLowerCase();
    const nameMatch =
      skill.name.toLowerCase() === normalized ||
      skill.name.toLowerCase().includes(normalized);
    const refMatch =
      parts.endsWith(`/${normalized}`) ||
      parts.endsWith(`:${normalized}`) ||
      parts === normalized;
    const pathMatch = skill.path.toLowerCase().includes(normalized);
    return nameMatch || refMatch || pathMatch;
  });
}

function matchSetAlias(cache: CacheSchema, alias: string): SkillSet[] {
  if (!cache.sets) return [];
  const normalized = alias.toLowerCase();
  return Object.values(cache.sets).filter((set) => {
    const parts = set.setRef.toLowerCase();
    const nameMatch = set.name.toLowerCase() === normalized;
    const refMatch =
      parts.endsWith(`/${normalized}`) ||
      parts.endsWith(`:${normalized}`) ||
      parts === normalized;
    return nameMatch || refMatch;
  });
}

function applyNamespaceAlias(
  namespace: string | undefined,
  config: ConfigSchema
): string | undefined {
  if (!namespace) return undefined;
  const normalized = normalizeTokenSegment(namespace);
  return (
    config.namespaceAliases[normalized] ??
    config.namespaceAliases[namespace] ??
    normalized
  );
}

function findMapping(
  mappings: Record<string, { skillRef: string }>,
  alias: string,
  normalizedAlias: string
): { skillRef: string } | undefined {
  if (mappings[alias]) return mappings[alias];
  if (normalizedAlias && mappings[normalizedAlias]) {
    return mappings[normalizedAlias];
  }
  const lower = alias.toLowerCase();
  for (const [key, value] of Object.entries(mappings)) {
    if (key.toLowerCase() === lower) return value;
    if (normalizeTokenRef(key) === normalizedAlias) return value;
  }
  return undefined;
}

export function resolveToken(
  token: InvocationToken,
  config?: ConfigSchema,
  cache?: CacheSchema
): ResolveResult {
  const cfg = config ?? loadConfig();
  const c = cache ?? loadCaches();
  const normalizedAlias = normalizeTokenRef(token.alias);
  if (!normalizedAlias) {
    return { invocation: token, reason: "unmatched" };
  }
  const namespace = applyNamespaceAlias(token.namespace, cfg);

  // 1) explicit mapping
  const mapping = findMapping(cfg.mappings, token.alias, normalizedAlias);
  if (mapping) {
    // Try skill first, then set
    const normalizedRef = normalizeTokenRef(mapping.skillRef);
    const skill =
      pickSkillByRef(c, mapping.skillRef) ?? pickSkillByRef(c, normalizedRef);
    if (skill) return { invocation: token, skill };

    const set = pickSetByRef(c, mapping.skillRef);
    if (set) return { invocation: token, set };

    return {
      invocation: token,
      reason: `mapping points to missing ref ${mapping.skillRef}`,
    };
  }

  // 2) If kind is explicitly specified, only search that type
  if (token.kind === "skill") {
    let skillCandidates = matchSkillAlias(c, normalizedAlias);
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
    return {
      invocation: token,
      reason: "ambiguous",
      candidates: skillCandidates,
    };
  }

  if (token.kind === "set") {
    let setCandidates = matchSetAlias(c, normalizedAlias);
    if (namespace) {
      setCandidates = filterByNamespace(
        setCandidates,
        namespace,
        (s) => s.setRef
      );
    }

    if (setCandidates.length === 0) {
      return { invocation: token, reason: "unmatched" };
    }
    if (setCandidates.length === 1 && setCandidates[0]) {
      return { invocation: token, set: setCandidates[0] };
    }
    return { invocation: token, reason: "ambiguous-set", setCandidates };
  }

  // 3) No kind specified - search both skills and sets
  let skillCandidates = matchSkillAlias(c, normalizedAlias);
  let setCandidates = matchSetAlias(c, normalizedAlias);

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
    if (skillCandidates.length === 1 && skillCandidates[0]) {
      return { invocation: token, skill: skillCandidates[0] };
    }
    return {
      invocation: token,
      reason: "ambiguous",
      candidates: skillCandidates,
    };
  }

  // Only set matches
  if (setCandidates.length > 0) {
    if (setCandidates.length === 1 && setCandidates[0]) {
      return { invocation: token, set: setCandidates[0] };
    }
    return { invocation: token, reason: "ambiguous-set", setCandidates };
  }

  // No matches
  return { invocation: token, reason: "unmatched" };
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

export function resolveTokens(
  tokens: InvocationToken[],
  config?: ConfigSchema,
  cache?: CacheSchema
): ResolveResult[] {
  const cfg = config ?? loadConfig();
  const c = cache ?? loadCaches();
  return tokens.map((token) => resolveToken(token, cfg, c));
}
