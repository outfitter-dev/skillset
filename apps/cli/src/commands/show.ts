/**
 * skillset show command
 */

import { statSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import {
  buildDirectoryTreeLines,
  buildNamespaceTree,
  isNamespaceRef,
  loadCaches,
  loadConfig,
  resolveToken,
  type Skill,
} from "@skillset/core";
import { getSkillsetEnv } from "@skillset/shared";
import chalk from "chalk";
import type { Command } from "commander";
import type { GlobalOptions, OutputFormat } from "../types";
import { determineFormat } from "../utils/format";
import { normalizeInvocation } from "../utils/normalize";

const FRONTMATTER_REGEX = /^---\n([\s\S]*?)\n---/;
const FRONTMATTER_NAME_REGEX = /^name:\s*(.+)$/m;
const FRONTMATTER_DESC_REGEX = /^description:\s*(.+)$/m;
const HEADING_REGEX = /^#\s+(.+)$/m;

interface ShowOptions extends GlobalOptions {
  ref: string;
  tree?: boolean;
}

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
  config: Awaited<ReturnType<typeof loadConfig>>,
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

  return await resolveTokenInput(
    input,
    cache,
    config,
    sourceFilters,
    kindOverride
  );
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

async function resolveTokenInput(
  input: string,
  cache: ReturnType<typeof loadCaches>,
  config: Awaited<ReturnType<typeof loadConfig>>,
  sourceFilters: string[] | undefined,
  kindOverride?: "skill" | "set"
): Promise<ResolveInputResult> {
  const token = normalizeInvocation(input, kindOverride);
  const result = await resolveToken(token, config, cache);

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
      message: `Alias "${input}" resolved to a set. Use 'skillset set show ${input}' instead.`,
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

/**
 * Resolve a path to a skill
 */
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
 * Show skill metadata
 */
async function showSkill(
  ref: string,
  sourceFilters: string[] | undefined,
  format: OutputFormat,
  kindOverride?: "skill" | "set",
  showTree = false
): Promise<void> {
  const cache = loadCaches();
  const config = await loadConfig();
  const env = getSkillsetEnv();

  const result = await resolveInput(
    ref,
    cache,
    config,
    sourceFilters,
    kindOverride ?? env.kind
  );

  if (result.type === "error") {
    reportShowError(format, ref, result.message, result.candidates);
  }

  if (result.type === "namespace") {
    await printNamespace(result.namespace, cache, format);
    return;
  }

  if (showTree) {
    const treeRoot = resolveTreeRoot(result);
    const treeLines = buildDirectoryTreeLines(treeRoot, {
      maxDepth: 6,
      maxLines: config.output.max_lines,
    });
    const treeText = treeLines.join("\n");
    if (format === "json") {
      console.log(JSON.stringify({ tree: treeText }, null, 2));
    } else {
      console.log(treeText);
    }
    return;
  }

  const skill =
    result.type === "skill"
      ? result.skill
      : await resolvePathToSkill(result.path);

  if (!skill) {
    const message = `Could not resolve skill: ${ref}`;
    reportShowError(format, ref, message);
  }

  if (format === "json") {
    printSkillJson(skill);
    return;
  }

  if (format === "raw") {
    printSkillRaw(skill);
    return;
  }

  printSkillText(skill);
}

/**
 * Register the show command
 */
export function registerShowCommand(program: Command): void {
  program
    .command("show <ref>")
    .description("Show skill metadata")
    .option("--tree", "Show a directory tree for the resolved skill")
    .action(async (ref: string, options: ShowOptions) => {
      const format = determineFormat(options);
      await showSkill(ref, options.source, format, options.kind, options.tree);
    });
}

function resolveTreeRoot(
  result: Extract<ResolveInputResult, { type: "skill" } | { type: "path" }>
): string {
  if (result.type === "path") {
    if (result.path.endsWith("SKILL.md")) {
      return dirname(result.path);
    }
    return result.path;
  }
  return dirname(result.skill.path);
}

async function printNamespace(
  namespace: string,
  cache: ReturnType<typeof loadCaches>,
  format: OutputFormat
): Promise<void> {
  if (format === "json") {
    const namespaceSkills = Object.values(cache.skills).filter((s) =>
      s.skillRef.startsWith(`${namespace}:`)
    );
    console.log(
      JSON.stringify({ namespace, skills: namespaceSkills }, null, 2)
    );
    return;
  }
  const tree = await buildNamespaceTree(namespace, cache);
  console.log(tree);
}

function reportShowError(
  format: OutputFormat,
  ref: string,
  message: string,
  candidates?: Skill[]
): never {
  if (format === "json") {
    console.log(
      JSON.stringify(
        {
          error: message,
          ref,
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

function printSkillJson(skill: Skill): void {
  console.log(
    JSON.stringify(
      {
        skillRef: skill.skillRef,
        name: skill.name,
        description: skill.description,
        path: skill.path,
        lineCount: skill.lineCount,
      },
      null,
      2
    )
  );
}

function printSkillRaw(skill: Skill): void {
  console.log(skill.skillRef);
  console.log(skill.name);
  console.log(skill.path);
}

function printSkillText(skill: Skill): void {
  console.log(chalk.bold(skill.name));
  console.log(chalk.dim(skill.skillRef));
  if (skill.description) {
    console.log(skill.description);
  }
  console.log(chalk.dim(skill.path));
  if (skill.lineCount) {
    console.log(chalk.dim(`${skill.lineCount} lines`));
  }
}
