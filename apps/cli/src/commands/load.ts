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

interface LoadOptions extends GlobalOptions {
  ref: string;
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
    if (filter === "project" && skillRef.startsWith("project:")) {
      return true;
    }
    if (filter === "user" && skillRef.startsWith("user:")) {
      return true;
    }
    if (filter === "plugin" && skillRef.startsWith("plugin:")) {
      return true;
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

  if (isNamespaceRef(input)) {
    return { type: "namespace", namespace: input };
  }

  if (input.includes(":") && !input.includes("/")) {
    const [ns, name] = input.split(":");
    if (ns && name && isNamespaceRef(ns)) {
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
    }
  }

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
    const candidates = result.candidates;

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

async function resolvePathToSkill(path: string): Promise<Skill | undefined> {
  const skillPath = path.endsWith("SKILL.md") ? path : join(path, "SKILL.md");
  const file = Bun.file(skillPath);

  if (!(await file.exists())) return undefined;

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
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (frontmatterMatch?.[1]) {
    const nameMatch = frontmatterMatch[1].match(/^name:\s*(.+)$/m);
    if (nameMatch?.[1]) {
      return nameMatch[1].trim();
    }
  }
  const headingMatch = content.match(/^#\s+(.+)$/m);
  return headingMatch?.[1]?.trim();
}

function extractSkillDescription(content: string): string | undefined {
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (frontmatterMatch?.[1]) {
    const descMatch = frontmatterMatch[1].match(/^description:\s*(.+)$/m);
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
    if (format === "json") {
      console.log(
        JSON.stringify(
          {
            error: result.message,
            ref,
            candidates: result.candidates?.map((c) => c.skillRef) ?? [],
          },
          null,
          2
        )
      );
    } else {
      console.error(chalk.red(result.message));
      if (result.candidates && result.candidates.length > 0) {
        console.error(chalk.yellow("Did you mean:"));
        for (const c of result.candidates) {
          console.error(chalk.yellow(`  ${c.skillRef}`));
        }
      }
    }
    process.exit(1);
  }

  if (result.type === "namespace") {
    const message = `Cannot load namespace "${result.namespace}". Use a specific skill reference.`;
    if (format === "json") {
      console.log(JSON.stringify({ error: message }, null, 2));
    } else {
      console.error(chalk.red(message));
    }
    process.exit(1);
  }

  const skill =
    result.type === "skill"
      ? result.skill
      : await resolvePathToSkill(result.path);

  if (!skill) {
    const message = `Could not resolve skill: ${ref}`;
    if (format === "json") {
      console.log(JSON.stringify({ error: message, ref }, null, 2));
    } else {
      console.error(chalk.red(message));
    }
    process.exit(1);
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
      return;
    }

    if (format === "raw") {
      console.log(content);
      return;
    }

    // Format: text (with metadata header and frontmatter stripped)
    console.log(chalk.bold(skill.name));
    console.log(chalk.dim(skill.skillRef));
    if (skill.description) {
      console.log(skill.description);
    }
    console.log(chalk.dim(skill.path));
    console.log();

    const strippedContent = stripFrontmatter(content);
    console.log(strippedContent);
  } catch {
    const message = `Could not read skill content: ${skill.path}`;
    if (format === "json") {
      console.log(
        JSON.stringify({ error: message, ref, path: skill.path }, null, 2)
      );
    } else {
      console.error(chalk.red(message));
    }
    process.exit(1);
  }
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
