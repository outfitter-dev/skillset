/**
 * skillset list command
 */

import { loadCaches, loadConfig, type Skill } from "@skillset/core";
import chalk from "chalk";
import type { Command } from "commander";
import type { GlobalOptions } from "../types";
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
    if (filter === "project" || filter === "user" || filter === "plugin") {
      if (skillRef.startsWith(`${filter}:`)) {
        return true;
      }
      continue;
    }

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
function getSkills(sourceFilters: string[] | undefined): Skill[] {
  const cache = loadCaches();
  let skills = Object.values(cache.skills);

  // Filter by source if specified
  if (sourceFilters && sourceFilters.length > 0) {
    skills = skills.filter((skill) =>
      matchesSourceFilter(skill.skillRef, sourceFilters)
    );
  }

  return skills;
}

function getSets() {
  const config = loadConfig();
  const sets = config.sets ?? {};
  return Object.entries(sets).map(([key, def]) => ({
    key,
    ...def,
  }));
}

function printSkills(
  skills: Skill[],
  sourceFilters: string[] | undefined
): void {
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
  const namespaceOrder = new Map<string, number>([
    ["project", 0],
    ["user", 1],
  ]);
  const sortedNamespaces = Array.from(byNamespace.keys()).sort((a, b) => {
    const orderA = namespaceOrder.get(a) ?? 2;
    const orderB = namespaceOrder.get(b) ?? 2;
    if (orderA !== orderB) {
      return orderA - orderB;
    }
    return a.localeCompare(b);
  });

  const filterMsg =
    sourceFilters && sourceFilters.length > 0
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

function printSets(sets: ReturnType<typeof getSets>): void {
  if (sets.length === 0) {
    console.log(chalk.yellow("No sets defined in configuration."));
    console.log(
      chalk.dim("Define sets in your config file under the 'sets' key.")
    );
    return;
  }

  console.log(chalk.bold(`${sets.length} sets defined\n`));
  for (const set of sets) {
    console.log(chalk.green(set.name));
    console.log(`  ${chalk.dim(`Key: ${set.key}`)}`);
    if (set.description) {
      console.log(`  ${set.description}`);
    }
    console.log(`  ${chalk.dim(`Skills: ${set.skills.length}`)}`);
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
      handleListCommand(options);
    });
}

function handleListCommand(options: ListOptions): void {
  const format = determineFormat(options);
  const includeSkills = !options.sets;
  const includeSets = !options.skills;
  const skills = includeSkills ? getSkills(options.source) : [];
  const sets = includeSets ? getSets() : [];

  if (format === "json") {
    printJsonList(skills, sets, includeSkills, includeSets);
    return;
  }

  if (format === "raw") {
    printRawList(skills, sets, includeSkills, includeSets);
    return;
  }

  printTextList(skills, sets, includeSkills, includeSets, options.source);
}

function printJsonList(
  skills: Skill[],
  sets: ReturnType<typeof getSets>,
  includeSkills: boolean,
  includeSets: boolean
): void {
  if (includeSkills && includeSets) {
    console.log(JSON.stringify({ skills, sets }, null, 2));
    return;
  }
  if (includeSets) {
    console.log(JSON.stringify(sets, null, 2));
    return;
  }
  console.log(JSON.stringify(skills, null, 2));
}

function printRawList(
  skills: Skill[],
  sets: ReturnType<typeof getSets>,
  includeSkills: boolean,
  includeSets: boolean
): void {
  if (includeSets && !includeSkills) {
    for (const set of sets) {
      console.log(set.key);
    }
    return;
  }
  for (const skill of skills.sort((a, b) =>
    a.skillRef.localeCompare(b.skillRef)
  )) {
    console.log(skill.skillRef);
  }
}

function printTextList(
  skills: Skill[],
  sets: ReturnType<typeof getSets>,
  includeSkills: boolean,
  includeSets: boolean,
  sourceFilters: string[] | undefined
): void {
  if (includeSkills) {
    if (skills.length === 0) {
      console.log(chalk.yellow(noSkillsMessage(sourceFilters)));
    } else {
      printSkills(skills, sourceFilters);
    }
  }

  if (includeSets) {
    if (includeSkills) {
      console.log(chalk.bold("Sets"));
      console.log();
    }
    printSets(sets);
  }
}

function noSkillsMessage(sourceFilters: string[] | undefined): string {
  if (sourceFilters && sourceFilters.length > 0) {
    return `No skills match source filter(s): ${sourceFilters.join(", ")}`;
  }
  return "No skills indexed. Run 'skillset index' first.";
}
