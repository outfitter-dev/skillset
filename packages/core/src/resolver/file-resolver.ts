import { isAbsolute, join } from "node:path";
import type { Skill, SkillRef } from "@skillset/types";
import { normalizeTokenRef, normalizeTokenSegment } from "../normalize";

const LINE_SPLIT_REGEX = /\r?\n/;
const HEADING_PREFIX_REGEX = /^#+\s*/;

/**
 * Reads a skill from a file path and constructs a Skill object.
 *
 * @param path - The file path (absolute or relative)
 * @param aliasKey - The alias key for the skill
 * @param projectRoot - The project root directory
 * @returns A Skill object or undefined if file cannot be read
 */
export async function readSkillFromPath(
  path: string,
  aliasKey: string,
  projectRoot: string
): Promise<Skill | undefined> {
  const resolved = isAbsolute(path) ? path : join(projectRoot, path);
  try {
    const content = await Bun.file(resolved).text();
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
      skillRef: `project:${normalizeTokenRef(aliasKey)}` as SkillRef,
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

/**
 * Checks if a value looks like a file path.
 *
 * @param value - The value to check
 * @returns True if the value appears to be a file path
 */
export function looksLikePath(value: string): boolean {
  return value.includes("/") || value.includes("\\") || value.endsWith(".md");
}
