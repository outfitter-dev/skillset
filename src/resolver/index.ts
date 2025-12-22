import { loadCaches } from "../cache";
import { loadConfig } from "../config";
import type {
  CacheSchema,
  ConfigSchema,
  InvocationToken,
  ResolveResult,
  Skill,
} from "../types";

function pickSkillByRef(cache: CacheSchema, ref: string): Skill | undefined {
  return cache.skills[ref];
}

function matchAlias(cache: CacheSchema, alias: string): Skill[] {
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

function applyNamespaceAlias(
  namespace: string | undefined,
  config: ConfigSchema
): string | undefined {
  if (!namespace) return undefined;
  return config.namespaceAliases[namespace] ?? namespace;
}

export function resolveToken(
  token: InvocationToken,
  config?: ConfigSchema,
  cache?: CacheSchema
): ResolveResult {
  const cfg = config ?? loadConfig();
  const c = cache ?? loadCaches();
  const namespace = applyNamespaceAlias(token.namespace, cfg);

  // 1) explicit mapping
  const mapping = cfg.mappings[token.alias];
  if (mapping) {
    const skill = pickSkillByRef(c, mapping.skillRef);
    if (skill) return { invocation: token, skill };
    return {
      invocation: token,
      reason: `mapping points to missing skillRef ${mapping.skillRef}`,
    };
  }

  // 2) namespace-limited search
  let candidates = matchAlias(c, token.alias);
  if (namespace) {
    candidates = candidates.filter(
      (skill) =>
        skill.skillRef.startsWith(`${namespace}:`) ||
        skill.skillRef.startsWith(`${namespace}/`) ||
        skill.skillRef.startsWith(`${namespace}`)
    );
  }

  if (candidates.length === 0) {
    return { invocation: token, reason: "unmatched" };
  }

  const firstCandidate = candidates[0];
  if (candidates.length === 1 && firstCandidate) {
    return { invocation: token, skill: firstCandidate };
  }

  return { invocation: token, reason: "ambiguous", candidates };
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
