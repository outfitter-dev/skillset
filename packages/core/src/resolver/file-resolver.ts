import { isAbsolute, join, resolve, sep } from "node:path";
import type { Skill, SkillRef, Tool } from "@skillset/types";
import { normalizeTokenRef, normalizeTokenSegment } from "../normalize";

const LINE_SPLIT_REGEX = /\r?\n/;
const HEADING_PREFIX_REGEX = /^#+\s*/;

/**
 * Infers the tool type from a file path based on conventional directory patterns.
 *
 * @param path - The file path to analyze
 * @returns The inferred tool type or undefined
 */
export function inferToolFromPath(path: string): Tool | undefined {
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
