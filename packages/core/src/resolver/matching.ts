import type { Skill, SkillSet } from "@skillset/types";
import { normalizeTokenRef, normalizeTokenSegment } from "../normalize";

const DASH_REGEX = /-/g;

/**
 * Matches items by alias using exact and fuzzy matching strategies.
 *
 * @param items - Array of items to search through
 * @param alias - The alias to match against
 * @param fuzzy - Whether to enable fuzzy matching (includes partial matches)
 * @param getRef - Function to extract reference for matching
 * @param getName - Function to extract name for matching
 * @param getPath - Optional function to extract path for matching
 * @returns Array of matching items
 */
function matchAlias<T>(
  items: T[],
  alias: string,
  fuzzy: boolean,
  getRef: (item: T) => string,
  getName: (item: T) => string,
  getPath?: (item: T) => string | undefined
): T[] {
  if (items.length === 0) {
    return [];
  }
  const normalized = normalizeTokenSegment(alias);
  const normalizedLoose = normalized.replace(DASH_REGEX, "");
  return items.filter((item) => {
    const parts = normalizeTokenRef(getRef(item));
    const partsLoose = parts.replace(DASH_REGEX, "");
    const nameNormalized = normalizeTokenSegment(getName(item));
    const nameLoose = nameNormalized.replace(DASH_REGEX, "");
    const pathLower = getPath?.(item)?.toLowerCase();

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
    const pathMatch = pathLower
      ? pathLower.includes(normalized) || pathLower.includes(normalizedLoose)
      : false;
    return nameExact || nameMatch || refMatch || pathMatch;
  });
}

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
  return matchAlias(
    skills,
    alias,
    fuzzy,
    (skill) => skill.skillRef,
    (skill) => skill.name,
    (skill) => skill.path
  );
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
  return matchAlias(
    sets,
    alias,
    fuzzy,
    (set) => set.setRef,
    (set) => set.name
  );
}
