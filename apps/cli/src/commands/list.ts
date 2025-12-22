/**
 * skillset list command
 */

import { loadCaches, type Skill } from "@skillset/core";
import chalk from "chalk";
import type { Command } from "commander";
import type { GlobalOptions, OutputFormat } from "../types";
import { determineFormat } from "../utils/format";

interface ListOptions extends GlobalOptions {
  skills?: boolean;
  sets?: boolean;
}

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
    // Match exact namespace: "project" → "project:*"
    if (filter === "project" && skillRef.startsWith("project:")) {
      return true;
    }
    if (filter === "user" && skillRef.startsWith("user:")) {
      return true;
    }
    if (filter === "plugin" && skillRef.startsWith("plugin:")) {
      return true;
    }

    // Match specific plugin: "plugin:<name>" → "plugin:<name>/*"
    if (filter.startsWith("plugin:")) {
      const pluginName = filter.slice(7); // Remove "plugin:" prefix
      if (skillRef.startsWith(`plugin:${pluginName}/`)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * List all indexed skills
 */
function listAllSkills(
  sourceFilters: string[] | undefined,
  format: OutputFormat,
  options: ListOptions
): void {
  const cache = loadCaches();
  let skills = Object.values(cache.skills);

  // Filter by --skills or --sets flag
  // TODO: When sets are implemented, filter accordingly
  // For now, we only have skills

  if (skills.length === 0) {
    const message = "No skills indexed. Run 'skillset index' first.";
    if (format === "json") {
      console.log(JSON.stringify({ error: message, skills: [] }, null, 2));
    } else {
      console.log(chalk.yellow(message));
    }
    return;
  }

  // Filter by source if specified
  if (sourceFilters && sourceFilters.length > 0) {
    skills = skills.filter((skill) =>
      matchesSourceFilter(skill.skillRef, sourceFilters)
    );

    if (skills.length === 0) {
      const message = `No skills match source filter(s): ${sourceFilters.join(", ")}`;
      if (format === "json") {
        console.log(
          JSON.stringify(
            { error: message, filters: sourceFilters, skills: [] },
            null,
            2
          )
        );
      } else {
        console.log(chalk.yellow(message));
      }
      return;
    }
  }

  if (format === "json") {
    console.log(JSON.stringify(skills, null, 2));
    return;
  }

  if (format === "raw") {
    // One skill ref per line for piping
    for (const skill of skills.sort((a, b) =>
      a.skillRef.localeCompare(b.skillRef)
    )) {
      console.log(skill.skillRef);
    }
    return;
  }

  // Format: text (default)
  // Group skills by namespace
  const byNamespace = new Map<string, Skill[]>();
  for (const skill of skills) {
    const namespace = skill.skillRef.split(":")[0] ?? "unknown";
    if (!byNamespace.has(namespace)) {
      byNamespace.set(namespace, []);
    }
    byNamespace.get(namespace)?.push(skill);
  }

  // Sort namespaces: project, user, then plugins alphabetically
  const sortedNamespaces = Array.from(byNamespace.keys()).sort((a, b) => {
    if (a === "project") return -1;
    if (b === "project") return 1;
    if (a === "user") return -1;
    if (b === "user") return 1;
    return a.localeCompare(b);
  });

  const filterMsg = sourceFilters
    ? ` (filtered by: ${sourceFilters.join(", ")})`
    : "";
  console.log(chalk.bold(`${skills.length} skills indexed${filterMsg}\n`));

  for (const namespace of sortedNamespaces) {
    const namespaceSkills = byNamespace.get(namespace) ?? [];
    console.log(chalk.bold.cyan(`${namespace}:`));

    for (const skill of namespaceSkills.sort((a, b) =>
      a.name.localeCompare(b.name)
    )) {
      console.log(`  ${chalk.green(skill.name)}`);
      console.log(`    ${chalk.dim(skill.skillRef)}`);
      if (skill.description) {
        console.log(`    ${skill.description}`);
      }
    }
    console.log();
  }
}

/**
 * Register the list command
 */
export function registerListCommand(program: Command): void {
  program
    .command("list")
    .description("List all skills and sets")
    .option("--skills", "Only list skills (no sets)")
    .option("--sets", "Only list sets (no skills)")
    .action((options: ListOptions) => {
      const format = determineFormat(options);
      listAllSkills(options.source, format, options);
    });
}
