import { inferToolFromPath } from "@skillset/shared";
import type { ConfigSchema, Scope, Skill, SkillSet } from "@skillset/types";
import { normalizeTokenSegment } from "../normalize";

/**
 * Namespace shortcuts for common scope aliases.
 */
export const NAMESPACE_SHORTCUTS: Record<string, Scope> = {
  p: "project",
  proj: "project",
  project: "project",
  u: "user",
  g: "user",
  user: "user",
  global: "user",
  plugin: "plugin",
};

/**
 * Resolves a namespace input to a standardized scope value.
 *
 * @param input - The namespace string to resolve
 * @returns The resolved scope or undefined if input is falsy
 */
export function resolveNamespace(
  input: string | undefined
): string | undefined {
  if (!input) {
    return undefined;
  }
  const normalized = normalizeTokenSegment(input);
  return NAMESPACE_SHORTCUTS[normalized] ?? normalized;
}

/**
 * Extracts the scope from a skill reference.
 *
 * @param skillRef - The skill reference to extract scope from
 * @returns The scope if found, undefined otherwise
 */
export function skillScope(skillRef: string): Scope | undefined {
  const prefix = skillRef.split(":")[0];
  if (prefix === "project" || prefix === "user" || prefix === "plugin") {
    return prefix;
  }
  return undefined;
}

/**
 * Filters skills based on configuration rules (ignored scopes and tool filters).
 *
 * @param skills - Record of skills to filter
 * @param config - Configuration containing ignore rules
 * @returns Array of filtered skills
 */
export function filterSkillsByConfig(
  skills: Record<string, Skill>,
  config: ConfigSchema
): Skill[] {
  const ignored = new Set(config.ignore_scopes ?? []);
  const tools = config.tools;
  return Object.values(skills).filter((skill) => {
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

/**
 * Filters skill sets based on configuration rules (ignored scopes).
 *
 * @param sets - Record of skill sets to filter
 * @param config - Configuration containing ignore rules
 * @returns Array of filtered skill sets
 */
export function filterSetsByConfig(
  sets: Record<string, SkillSet>,
  config: ConfigSchema
): SkillSet[] {
  const ignored = new Set(config.ignore_scopes ?? []);
  return Object.values(sets).filter((set) => {
    const scope = skillScope(set.setRef);
    if (scope && ignored.has(scope)) {
      return false;
    }
    return true;
  });
}

/**
 * Filters skills by one or more scopes.
 *
 * @param skills - Array of skills to filter
 * @param scope - Single scope or array of scopes to filter by
 * @returns Array of skills matching the specified scope(s)
 */
export function applyScopeFilter(
  skills: Skill[],
  scope?: Scope | Scope[]
): Skill[] {
  if (!scope) {
    return skills;
  }
  const scopes = Array.isArray(scope) ? scope : [scope];
  return skills.filter((skill) => {
    const skillScopeValue = skillScope(skill.skillRef);
    return skillScopeValue ? scopes.includes(skillScopeValue) : false;
  });
}

/**
 * Selects a single skill from candidates based on scope priority configuration.
 * Returns undefined if multiple candidates have the same priority.
 *
 * @param candidates - Array of candidate skills
 * @param config - Configuration containing scope priority
 * @returns The selected skill or undefined if ambiguous
 */
export function pickByScopePriority(
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

/**
 * Filters items by namespace prefix.
 *
 * @param items - Array of items to filter
 * @param namespace - Namespace to filter by
 * @param getRef - Function to extract reference from item
 * @returns Array of items matching the namespace
 */
export function filterByNamespace<T>(
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
