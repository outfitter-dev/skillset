/**
 * skillset set command - manage skill sets
 */

import {
  loadCaches,
  loadConfig,
  resolveToken,
  type Skill,
  stripFrontmatter,
} from "@skillset/core";
import { logUsage } from "@skillset/shared";
import chalk from "chalk";
import type { Command } from "commander";
import type { GlobalOptions, OutputFormat } from "../types";
import { determineFormat } from "../utils/format";
import { normalizeInvocation } from "../utils/normalize";

/**
 * List all defined sets
 */
async function listSets(format: OutputFormat): Promise<void> {
  const config = await loadConfig();
  const sets = config.sets ?? {};
  const setEntries = Object.entries(sets);

  if (setEntries.length === 0) {
    const message = "No sets defined in configuration.";
    if (format === "json") {
      console.log(JSON.stringify({ message, sets: [] }, null, 2));
    } else {
      console.log(chalk.yellow(message));
      console.log(
        chalk.dim("Define sets in your config file under the 'sets' key.")
      );
    }
    return;
  }

  if (format === "json") {
    const setList = setEntries.map(([key, def]) => ({
      key,
      ...def,
    }));
    console.log(JSON.stringify(setList, null, 2));
    return;
  }

  if (format === "raw") {
    // One set key per line for piping
    for (const [key] of setEntries) {
      console.log(key);
    }
    return;
  }

  // Format: text (default)
  console.log(chalk.bold(`${setEntries.length} sets defined\n`));

  for (const [key, def] of setEntries) {
    console.log(chalk.green(def.name));
    console.log(`  ${chalk.dim(`Key: ${key}`)}`);
    if (def.description) {
      console.log(`  ${def.description}`);
    }
    console.log(`  ${chalk.dim(`Skills: ${def.skills.length}`)}`);
    console.log();
  }
}

async function resolveSetSkills(
  setDef: { skills: string[] },
  config: Awaited<ReturnType<typeof loadConfig>>,
  cache: Awaited<ReturnType<typeof loadCaches>>
): Promise<Array<{ ref: string; skill?: Skill; error?: string }>> {
  const resolved: Array<{ ref: string; skill?: Skill; error?: string }> = [];
  for (const ref of setDef.skills) {
    const token = normalizeInvocation(ref, "skill");
    const result = await resolveToken(token, config, cache);
    if (result.skill) {
      resolved.push({ ref, skill: result.skill });
      continue;
    }
    resolved.push({ ref, error: result.reason ?? "unmatched" });
  }
  return resolved;
}

/**
 * Show a set's metadata and contents
 */
async function showSet(name: string, format: OutputFormat): Promise<void> {
  const config = await loadConfig();
  const cache = await loadCaches();
  const sets = config.sets ?? {};

  const setDef = getSetOrExit(name, sets, format);

  const resolvedSkills = await resolveSetSkills(setDef, config, cache);

  if (format === "json") {
    printSetJson(name, setDef, resolvedSkills);
    return;
  }

  if (format === "raw") {
    printSetRaw(name, setDef, resolvedSkills);
    return;
  }

  printSetText(name, setDef, resolvedSkills);
}

/**
 * Load all skills in a set
 */
async function loadSet(name: string, format: OutputFormat): Promise<void> {
  const config = await loadConfig();
  const cache = await loadCaches();
  const sets = config.sets ?? {};
  const startTime = Date.now();

  const setDef = getSetOrExit(name, sets, format);

  const resolvedSkills = await resolveSetSkills(setDef, config, cache);

  const loadedSkills: Array<{
    ref: string;
    skill?: Skill;
    content?: string;
    error?: string;
  }> = [];

  for (const rs of resolvedSkills) {
    if (!rs.skill) {
      loadedSkills.push({ ref: rs.ref, error: rs.error ?? "Skill not found" });
      continue;
    }

    try {
      const content = await Bun.file(rs.skill.path).text();
      loadedSkills.push({ ref: rs.ref, skill: rs.skill, content });
    } catch {
      loadedSkills.push({
        ref: rs.ref,
        skill: rs.skill,
        error: "Failed to read skill file",
      });
    }
  }

  const duration_ms = Date.now() - startTime;

  // Log usage
  await logUsage({
    action: "load",
    skill: `set:${name}`,
    source: "cli",
    duration_ms,
  });

  if (format === "json") {
    printSetLoadJson(name, setDef, loadedSkills);
    return;
  }

  if (format === "raw") {
    printSetLoadRaw(loadedSkills);
    return;
  }

  printSetLoadText(name, setDef, loadedSkills);
}

/**
 * Register the set command with subcommands
 */
export function registerSetCommand(program: Command): void {
  const setCommand = program
    .command("set")
    .description("Manage skill sets (groups of skills)");

  setCommand
    .command("list")
    .description("List all defined sets")
    .action(async (options: GlobalOptions) => {
      const format = determineFormat(options);
      await listSets(format);
    });

  setCommand
    .command("show <name>")
    .description("Show a set's metadata and contents")
    .action(async (name: string, options: GlobalOptions) => {
      const format = determineFormat(options);
      await showSet(name, format);
    });

  setCommand
    .command("load <name>")
    .description("Load all skills in a set")
    .action(async (name: string, options: GlobalOptions) => {
      const format = determineFormat(options);
      await loadSet(name, format);
    });
}

function getSetOrExit(
  name: string,
  sets: Record<
    string,
    { name: string; description?: string; skills: string[] }
  >,
  format: OutputFormat
) {
  const setDef = sets[name];
  if (setDef) {
    return setDef;
  }

  const message = `Set not found: ${name}`;
  if (format === "json") {
    console.log(
      JSON.stringify(
        {
          error: message,
          name,
          availableSets: Object.keys(sets),
        },
        null,
        2
      )
    );
  } else {
    console.error(chalk.red(message));
    if (Object.keys(sets).length > 0) {
      console.error(chalk.yellow("Available sets:"));
      for (const key of Object.keys(sets)) {
        console.error(chalk.yellow(`  ${key}`));
      }
    }
  }
  process.exit(1);
}

function printSetJson(
  name: string,
  setDef: { name: string; description?: string; skills: string[] },
  resolvedSkills: Array<{ ref: string; skill?: Skill; error?: string }>
): void {
  console.log(
    JSON.stringify(
      {
        key: name,
        name: setDef.name,
        description: setDef.description,
        skills: resolvedSkills.map((rs) => ({
          ref: rs.ref,
          found: !!rs.skill,
          name: rs.skill?.name,
          path: rs.skill?.path,
          error: rs.error,
        })),
      },
      null,
      2
    )
  );
}

function printSetRaw(
  name: string,
  setDef: { name: string; description?: string; skills: string[] },
  resolvedSkills: Array<{ ref: string; skill?: Skill }>
): void {
  console.log(name);
  console.log(setDef.name);
  for (const rs of resolvedSkills) {
    console.log(rs.ref);
  }
}

function printSetText(
  name: string,
  setDef: { name: string; description?: string; skills: string[] },
  resolvedSkills: Array<{ ref: string; skill?: Skill; error?: string }>
): void {
  console.log(chalk.bold(setDef.name));
  console.log(chalk.dim(`Key: ${name}`));
  if (setDef.description) {
    console.log(setDef.description);
  }
  console.log();

  console.log(chalk.bold("Skills:"));
  if (resolvedSkills.length === 0) {
    console.log(chalk.dim("  (none)"));
    return;
  }

  for (const rs of resolvedSkills) {
    if (rs.skill) {
      console.log(`  ${chalk.green("✓")} ${rs.skill.name}`);
      console.log(`    ${chalk.dim(rs.ref)}`);
      if (rs.skill.description) {
        console.log(`    ${rs.skill.description}`);
      }
    } else {
      console.log(`  ${chalk.red("✗")} ${rs.ref}`);
      console.log(`    ${chalk.dim(rs.error ?? "(not found)")}`);
    }
  }
}

function printSetLoadJson(
  name: string,
  setDef: { name: string; description?: string; skills: string[] },
  loadedSkills: Array<{
    ref: string;
    skill?: Skill;
    content?: string;
    error?: string;
  }>
): void {
  console.log(
    JSON.stringify(
      {
        set: name,
        name: setDef.name,
        description: setDef.description,
        skills: loadedSkills.map((ls) => ({
          ref: ls.ref,
          name: ls.skill?.name,
          path: ls.skill?.path,
          content: ls.content,
          error: ls.error,
        })),
      },
      null,
      2
    )
  );
}

function printSetLoadRaw(loadedSkills: Array<{ content?: string }>): void {
  for (const ls of loadedSkills) {
    if (ls.content) {
      console.log(ls.content);
      console.log();
    }
  }
}

function printSetLoadText(
  name: string,
  setDef: { name: string; description?: string; skills: string[] },
  loadedSkills: Array<{
    ref: string;
    skill?: Skill;
    content?: string;
    error?: string;
  }>
): void {
  console.log(chalk.bold(setDef.name));
  console.log(chalk.dim(`Set: ${name}`));
  if (setDef.description) {
    console.log(setDef.description);
  }
  console.log(chalk.dim(`${setDef.skills.length} skills\n`));

  for (const ls of loadedSkills) {
    if (ls.error) {
      console.log(chalk.red(`✗ ${ls.ref}`));
      console.log(chalk.dim(`  ${ls.error}`));
      console.log();
      continue;
    }

    if (!(ls.skill && ls.content)) {
      continue;
    }

    console.log(chalk.bold(ls.skill.name));
    console.log(chalk.dim(ls.ref));
    if (ls.skill.description) {
      console.log(ls.skill.description);
    }
    console.log(chalk.dim(ls.skill.path));
    console.log();

    const strippedContent = stripFrontmatter(ls.content);
    console.log(strippedContent);
    console.log();
    console.log(chalk.dim("─".repeat(80)));
    console.log();
  }
}
