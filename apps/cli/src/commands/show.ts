/**
 * skillset show command
 */

import { statSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import {
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

interface ShowOptions extends GlobalOptions {
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
  // Check if it's a file/directory path
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
    // Path doesn't exist, continue with other resolution methods
  }

  // Check if it's a namespace reference
  if (isNamespaceRef(input)) {
    return { type: "namespace", namespace: input };
  }

  // Check if it looks like a namespace:name pattern
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

  // Try to resolve as an alias
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
      message: `Alias "${input}" resolved to a set. Use 'skillset set show ${input}' instead.`,
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

/**
 * Resolve a path to a skill
 */
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
 * Show skill metadata
 */
async function showSkill(
  ref: string,
  sourceFilters: string[] | undefined,
  format: OutputFormat,
  kindOverride?: "skill" | "set"
): Promise<void> {
  const cache = loadCaches();
  const config = loadConfig();
  const env = getSkillsetEnv();

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
    if (format === "json") {
      const namespaceSkills = Object.values(cache.skills).filter((s) =>
        s.skillRef.startsWith(`${result.namespace}:`)
      );
      console.log(
        JSON.stringify(
          { namespace: result.namespace, skills: namespaceSkills },
          null,
          2
        )
      );
    } else {
      const tree = await buildNamespaceTree(result.namespace, cache);
      console.log(tree);
    }
    return;
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

  if (format === "json") {
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
    return;
  }

  if (format === "raw") {
    console.log(skill.skillRef);
    console.log(skill.name);
    console.log(skill.path);
    return;
  }

  // Format: text
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

/**
 * Register the show command
 */
export function registerShowCommand(program: Command): void {
  program
    .command("show <ref>")
    .description("Show skill metadata")
    .action(async (ref: string, options: GlobalOptions) => {
      const format = determineFormat(options);
      await showSkill(ref, options.source, format, options.kind);
    });
}
