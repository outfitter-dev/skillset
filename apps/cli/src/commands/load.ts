/**
 * skillset load command
 */

import { statSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import {
  isNamespaceRef,
  loadCaches,
  loadConfig,
  resolveToken,
  type Skill,
  stripFrontmatter,
} from "@skillset/core";
import { getSkillsetEnv, logUsage } from "@skillset/shared";
import chalk from "chalk";
import type { Command } from "commander";
import type { GlobalOptions, OutputFormat } from "../types";
import { determineFormat } from "../utils/format";
import { normalizeInvocation } from "../utils/normalize";

const FRONTMATTER_REGEX = /^---\n([\s\S]*?)\n---/;
const FRONTMATTER_NAME_REGEX = /^name:\s*(.+)$/m;
const FRONTMATTER_DESC_REGEX = /^description:\s*(.+)$/m;
const HEADING_REGEX = /^#\s+(.+)$/m;

type ResolveInputResult =
  | { type: "skill"; skill: Skill }
  | { type: "namespace"; namespace: string }
  | { type: "path"; path: string }
  | { type: "error"; message: string; candidates?: Skill[] };

/**
 * Check if a skill's skillRef matches any of the source filters
 */
function matchesSourceFilter(
  skillRef: string,
  sourceFilters: string[] | undefined
): boolean {
  if (!sourceFilters || sourceFilters.length === 0) {
    return true;
  }

  for (const filter of sourceFilters) {
    if (filter === "project" || filter === "user" || filter === "plugin") {
      if (skillRef.startsWith(`${filter}:`)) {
        return true;
      }
      continue;
    }
    if (filter.startsWith("plugin:")) {
      const pluginName = filter.slice(7);
      if (skillRef.startsWith(`plugin:${pluginName}/`)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Resolve input to a skill, namespace, or path
 */
async function resolveInput(
  input: string,
  cache: ReturnType<typeof loadCaches>,
  config: ReturnType<typeof loadConfig>,
  sourceFilters?: string[],
  kindOverride?: "skill" | "set"
): Promise<ResolveInputResult> {
  const pathResult = await resolvePathInput(input);
  if (pathResult) {
    return pathResult;
  }

  if (isNamespaceRef(input)) {
    return { type: "namespace", namespace: input };
  }

  const explicitNamespaceResult = resolveExplicitNamespaceSkill(
    input,
    cache,
    sourceFilters
  );
  if (explicitNamespaceResult) {
    return explicitNamespaceResult;
  }

  const tokenResult = resolveTokenInput(
    input,
    cache,
    config,
    sourceFilters,
    kindOverride
  );
  return tokenResult;
}

async function resolvePathInput(
  input: string
): Promise<ResolveInputResult | undefined> {
  const resolvedPath = isAbsolute(input)
    ? input
    : resolve(process.cwd(), input);
  try {
    const stat = statSync(resolvedPath);
    if (stat.isFile() && resolvedPath.endsWith("SKILL.md")) {
      return { type: "path", path: resolvedPath };
    }
    if (stat.isDirectory()) {
      const skillPath = join(resolvedPath, "SKILL.md");
      if (await Bun.file(skillPath).exists()) {
        return { type: "path", path: skillPath };
      }
      return { type: "path", path: resolvedPath };
    }
  } catch {
    // Path doesn't exist, continue
  }
  return undefined;
}

function resolveExplicitNamespaceSkill(
  input: string,
  cache: ReturnType<typeof loadCaches>,
  sourceFilters: string[] | undefined
): ResolveInputResult | undefined {
  if (!input.includes(":") || input.includes("/")) {
    return undefined;
  }

  const [namespace] = input.split(":");
  if (!namespace) {
    return undefined;
  }
  if (!isNamespaceRef(namespace)) {
    return undefined;
  }

  let matchingSkills = Object.values(cache.skills).filter(
    (s) => s.skillRef === input || s.skillRef.startsWith(`${input}/`)
  );

  if (sourceFilters && sourceFilters.length > 0) {
    matchingSkills = matchingSkills.filter((s) =>
      matchesSourceFilter(s.skillRef, sourceFilters)
    );
  }

  if (matchingSkills.length === 1 && matchingSkills[0]) {
    return { type: "skill", skill: matchingSkills[0] };
  }
  if (matchingSkills.length > 1) {
    return { type: "namespace", namespace: input };
  }

  return undefined;
}

function resolveTokenInput(
  input: string,
  cache: ReturnType<typeof loadCaches>,
  config: ReturnType<typeof loadConfig>,
  sourceFilters: string[] | undefined,
  kindOverride?: "skill" | "set"
): ResolveInputResult {
  const token = normalizeInvocation(input, kindOverride);
  const result = resolveToken(token, config, cache);

  if (result.skill) {
    if (
      sourceFilters &&
      sourceFilters.length > 0 &&
      !matchesSourceFilter(result.skill.skillRef, sourceFilters)
    ) {
      return {
        type: "error",
        message: `Skill "${input}" resolved to ${result.skill.skillRef}, which doesn't match source filter(s): ${sourceFilters.join(", ")}`,
      };
    }
    return { type: "skill", skill: result.skill };
  }

  if (result.set) {
    return {
      type: "error",
      message: `Alias "${input}" resolved to a set. Use 'skillset set load ${input}' instead.`,
    };
  }

  if (result.reason === "ambiguous" && result.candidates) {
    return resolveAmbiguousResult(input, result.candidates, sourceFilters);
  }

  if (result.reason === "ambiguous-set") {
    return {
      type: "error",
      message: `Ambiguous set "${input}". Use $set: or a more specific name.`,
    };
  }

  if (result.reason === "skill-set-collision") {
    return {
      type: "error",
      message: `Alias "${input}" matches both a skill and a set. Use $skill:, $set:, or --kind to disambiguate.`,
    };
  }

  return { type: "error", message: `Could not resolve "${input}"` };
}

function resolveAmbiguousResult(
  input: string,
  candidates: Skill[],
  sourceFilters: string[] | undefined
): ResolveInputResult {
  if (sourceFilters && sourceFilters.length > 0) {
    const filteredCandidates = candidates.filter((c) =>
      matchesSourceFilter(c.skillRef, sourceFilters)
    );

    if (filteredCandidates.length === 1 && filteredCandidates[0]) {
      return { type: "skill", skill: filteredCandidates[0] };
    }

    if (filteredCandidates.length > 1) {
      return {
        type: "error",
        message: `Ambiguous alias "${input}" (after filtering by source: ${sourceFilters.join(", ")})`,
        candidates: filteredCandidates,
      };
    }

    return {
      type: "error",
      message: `No matches for "${input}" with source filter(s): ${sourceFilters.join(", ")}`,
      candidates,
    };
  }

  return {
    type: "error",
    message: `Ambiguous alias "${input}"`,
    candidates,
  };
}

async function resolvePathToSkill(path: string): Promise<Skill | undefined> {
  const skillPath = path.endsWith("SKILL.md") ? path : join(path, "SKILL.md");
  const file = Bun.file(skillPath);

  if (!(await file.exists())) {
    return undefined;
  }

  try {
    const content = await file.text();
    const name =
      extractSkillName(content) ??
      dirname(skillPath).split("/").pop() ??
      "unknown";
    const description = extractSkillDescription(content);

    return {
      skillRef: `path:${skillPath}`,
      path: skillPath,
      name,
      description,
      structure: undefined,
      lineCount: content.split("\n").length,
      cachedAt: undefined,
    };
  } catch {
    return undefined;
  }
}

function extractSkillName(content: string): string | undefined {
  const frontmatterMatch = content.match(FRONTMATTER_REGEX);
  if (frontmatterMatch?.[1]) {
    const nameMatch = frontmatterMatch[1].match(FRONTMATTER_NAME_REGEX);
    if (nameMatch?.[1]) {
      return nameMatch[1].trim();
    }
  }
  const headingMatch = content.match(HEADING_REGEX);
  return headingMatch?.[1]?.trim();
}

function extractSkillDescription(content: string): string | undefined {
  const frontmatterMatch = content.match(FRONTMATTER_REGEX);
  if (frontmatterMatch?.[1]) {
    const descMatch = frontmatterMatch[1].match(FRONTMATTER_DESC_REGEX);
    if (descMatch?.[1]) {
      return descMatch[1].trim();
    }
  }
  return undefined;
}

/**
 * Load and output skill content
 */
async function loadSkill(
  ref: string,
  sourceFilters: string[] | undefined,
  format: OutputFormat,
  kindOverride?: "skill" | "set"
): Promise<void> {
  const cache = loadCaches();
  const config = loadConfig();
  const env = getSkillsetEnv();
  const startTime = Date.now();

  const result = await resolveInput(
    ref,
    cache,
    config,
    sourceFilters,
    kindOverride ?? env.kind
  );

  if (result.type === "error") {
    reportLoadError(format, ref, result.message, result.candidates);
  }

  if (result.type === "namespace") {
    const message = `Cannot load namespace "${result.namespace}". Use a specific skill reference.`;
    reportLoadError(format, ref, message);
  }

  const skill =
    result.type === "skill"
      ? result.skill
      : await resolvePathToSkill(result.path);

  if (!skill) {
    const message = `Could not resolve skill: ${ref}`;
    reportLoadError(format, ref, message);
  }

  // Read skill content
  try {
    const content = await Bun.file(skill.path).text();
    const duration_ms = Date.now() - startTime;

    // Log usage
    logUsage({
      action: "load",
      skill: skill.skillRef,
      source: "cli",
      duration_ms,
    });

    if (format === "json") {
      printJsonSkill(skill, content);
      return;
    }

    if (format === "raw") {
      console.log(content);
      return;
    }

    printTextSkill(skill, content);
  } catch {
    const message = `Could not read skill content: ${skill.path}`;
    reportLoadError(format, ref, message, undefined, skill.path);
  }
}

function reportLoadError(
  format: OutputFormat,
  ref: string,
  message: string,
  candidates?: Skill[],
  path?: string
): never {
  if (format === "json") {
    console.log(
      JSON.stringify(
        {
          error: message,
          ref,
          path,
          candidates: candidates?.map((c) => c.skillRef) ?? [],
        },
        null,
        2
      )
    );
  } else {
    console.error(chalk.red(message));
    if (candidates && candidates.length > 0) {
      console.error(chalk.yellow("Did you mean:"));
      for (const c of candidates) {
        console.error(chalk.yellow(`  ${c.skillRef}`));
      }
    }
  }
  process.exit(1);
}

function printJsonSkill(skill: Skill, content: string): void {
  console.log(
    JSON.stringify(
      {
        skillRef: skill.skillRef,
        name: skill.name,
        description: skill.description,
        path: skill.path,
        content,
        lineCount: skill.lineCount,
      },
      null,
      2
    )
  );
}

function printTextSkill(skill: Skill, content: string): void {
  console.log(chalk.bold(skill.name));
  console.log(chalk.dim(skill.skillRef));
  if (skill.description) {
    console.log(skill.description);
  }
  console.log(chalk.dim(skill.path));
  console.log();

  const strippedContent = stripFrontmatter(content);
  console.log(strippedContent);
}

/**
 * Register the load command
 */
export function registerLoadCommand(program: Command): void {
  program
    .command("load <ref>")
    .description("Load and output skill content")
    .action(async (ref: string, options: GlobalOptions) => {
      const format = determineFormat(options);
      await loadSkill(ref, options.source, format, options.kind);
    });
}
