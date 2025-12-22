/**
 * skillset set command - manage skill sets
 */

import {
  loadCaches,
  loadConfig,
  type Skill,
  stripFrontmatter,
} from "@skillset/core";
import { logUsage } from "@skillset/shared";
import chalk from "chalk";
import type { Command } from "commander";
import type { GlobalOptions, OutputFormat } from "../types";
import { determineFormat } from "../utils/format";

interface SetDefinition {
  name: string;
  description?: string;
  skillRefs: string[];
}

interface SetListOptions extends GlobalOptions {}

interface SetShowOptions extends GlobalOptions {}

interface SetLoadOptions extends GlobalOptions {}

/**
 * List all defined sets
 */
function listSets(format: OutputFormat, options: SetListOptions): void {
  const config = loadConfig();
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
    console.log(`  ${chalk.dim(`Skills: ${def.skillRefs.length}`)}`);
    console.log();
  }
}

/**
 * Show a set's metadata and contents
 */
function showSet(name: string, format: OutputFormat): void {
  const config = loadConfig();
  const cache = loadCaches();
  const sets = config.sets ?? {};

  const setDef = sets[name];
  if (!setDef) {
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

  // Resolve skill references to actual skills
  const resolvedSkills: Array<{ ref: string; skill: Skill | undefined }> = [];
  for (const skillRef of setDef.skillRefs) {
    const skill = cache.skills[skillRef];
    resolvedSkills.push({ ref: skillRef, skill: skill ?? undefined });
  }

  if (format === "json") {
    console.log(
      JSON.stringify(
        {
          key: name,
          name: setDef.name,
          description: setDef.description,
          skillRefs: setDef.skillRefs,
          skills: resolvedSkills.map((rs) => ({
            ref: rs.ref,
            found: !!rs.skill,
            name: rs.skill?.name,
            path: rs.skill?.path,
          })),
        },
        null,
        2
      )
    );
    return;
  }

  if (format === "raw") {
    console.log(name);
    console.log(setDef.name);
    for (const rs of resolvedSkills) {
      console.log(rs.ref);
    }
    return;
  }

  // Format: text
  console.log(chalk.bold(setDef.name));
  console.log(chalk.dim(`Key: ${name}`));
  if (setDef.description) {
    console.log(setDef.description);
  }
  console.log();

  console.log(chalk.bold("Skills:"));
  if (resolvedSkills.length === 0) {
    console.log(chalk.dim("  (none)"));
  } else {
    for (const rs of resolvedSkills) {
      if (rs.skill) {
        console.log(`  ${chalk.green("✓")} ${rs.skill.name}`);
        console.log(`    ${chalk.dim(rs.ref)}`);
        if (rs.skill.description) {
          console.log(`    ${rs.skill.description}`);
        }
      } else {
        console.log(`  ${chalk.red("✗")} ${rs.ref}`);
        console.log(`    ${chalk.dim("(not found in cache)")}`);
      }
    }
  }
}

/**
 * Load all skills in a set
 */
async function loadSet(name: string, format: OutputFormat): Promise<void> {
  const config = loadConfig();
  const cache = loadCaches();
  const sets = config.sets ?? {};
  const startTime = Date.now();

  const setDef = sets[name];
  if (!setDef) {
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

  // Resolve and load all skills
  const loadedSkills: Array<{
    ref: string;
    skill?: Skill;
    content?: string;
    error?: string;
  }> = [];

  for (const skillRef of setDef.skillRefs) {
    const skill = cache.skills[skillRef];
    if (!skill) {
      loadedSkills.push({
        ref: skillRef,
        error: "Skill not found in cache",
      });
      continue;
    }

    try {
      const content = await Bun.file(skill.path).text();
      loadedSkills.push({ ref: skillRef, skill, content });
    } catch {
      loadedSkills.push({
        ref: skillRef,
        skill,
        error: "Failed to read skill file",
      });
    }
  }

  const duration_ms = Date.now() - startTime;

  // Log usage
  logUsage({
    action: "load",
    skill: `set:${name}`,
    source: "cli",
    duration_ms,
  });

  if (format === "json") {
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
    return;
  }

  if (format === "raw") {
    // Output all skill contents concatenated
    for (const ls of loadedSkills) {
      if (ls.content) {
        console.log(ls.content);
        console.log(); // Blank line between skills
      }
    }
    return;
  }

  // Format: text
  console.log(chalk.bold(setDef.name));
  console.log(chalk.dim(`Set: ${name}`));
  if (setDef.description) {
    console.log(setDef.description);
  }
  console.log(chalk.dim(`${setDef.skillRefs.length} skills\n`));

  for (const ls of loadedSkills) {
    if (ls.error) {
      console.log(chalk.red(`✗ ${ls.ref}`));
      console.log(chalk.dim(`  ${ls.error}`));
      console.log();
      continue;
    }

    if (!(ls.skill && ls.content)) continue;

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
    .action((options: GlobalOptions) => {
      const format = determineFormat(options);
      listSets(format, options);
    });

  setCommand
    .command("show <name>")
    .description("Show a set's metadata and contents")
    .action((name: string, options: GlobalOptions) => {
      const format = determineFormat(options);
      showSet(name, format);
    });

  setCommand
    .command("load <name>")
    .description("Load all skills in a set")
    .action(async (name: string, options: GlobalOptions) => {
      const format = determineFormat(options);
      await loadSet(name, format);
    });
}
