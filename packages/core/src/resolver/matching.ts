import type { Skill, SkillSet } from "@skillset/types";
import { normalizeTokenRef, normalizeTokenSegment } from "../normalize";

const DASH_REGEX = /-/g;

/**
 * Matches skills by alias using exact and fuzzy matching strategies.
 *
 * @param skills - Array of skills to search through
 * @param alias - The alias to match against
 * @param fuzzy - Whether to enable fuzzy matching (includes partial matches)
 * @returns Array of matching skills
 */
export function matchSkillAlias(
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

/**
 * Matches skill sets by alias using exact and fuzzy matching strategies.
 *
 * @param sets - Array of skill sets to search through
 * @param alias - The alias to match against
 * @param fuzzy - Whether to enable fuzzy matching (includes partial matches)
 * @returns Array of matching skill sets
 */
export function matchSetAlias(
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
