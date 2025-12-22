/**
 * skillset alias command
 */

import {
  getConfigPath,
  loadCaches,
  readConfigByScope,
  writeConfig,
} from "@skillset/core";
import chalk from "chalk";
import type { Command } from "commander";
import inquirer from "inquirer";
import type { ConfigScope } from "../types";
import { isTTY } from "../utils/tty";

interface AliasOptions {
  scope?: string;
  force?: boolean;
}

/**
 * Validate scope parameter
 */
function validateScope(scope: string | undefined): ConfigScope {
  if (!scope || scope === "project") return "project";
  if (scope === "local") return "local";
  if (scope === "user") return "user";
  console.error(
    chalk.red(`Invalid scope "${scope}". Must be: project, local, or user`)
  );
  process.exit(1);
}

/**
 * List all aliases
 */
function listAliases(): void {
  const projectConfig = readConfigByScope("project");
  const localConfig = readConfigByScope("local");
  const userConfig = readConfigByScope("user");

  const allAliases = new Map<string, { skillRef: string; scope: string }>();

  // Collect aliases from all scopes (user → local → project)
  if (userConfig.mappings) {
    for (const [name, mapping] of Object.entries(userConfig.mappings)) {
      allAliases.set(name, { skillRef: mapping.skillRef, scope: "user" });
    }
  }
  if (localConfig.mappings) {
    for (const [name, mapping] of Object.entries(localConfig.mappings)) {
      allAliases.set(name, { skillRef: mapping.skillRef, scope: "local" });
    }
  }
  if (projectConfig.mappings) {
    for (const [name, mapping] of Object.entries(projectConfig.mappings)) {
      allAliases.set(name, { skillRef: mapping.skillRef, scope: "project" });
    }
  }

  if (allAliases.size === 0) {
    console.log(chalk.yellow("No aliases defined"));
    console.log(chalk.dim("Use 'skillset alias <name> <ref>' to create one"));
    return;
  }

  console.log(chalk.bold("Current aliases:\n"));

  const sortedAliases = Array.from(allAliases.entries()).sort((a, b) =>
    a[0].localeCompare(b[0])
  );

  for (const [name, { skillRef, scope }] of sortedAliases) {
    console.log(
      `  ${chalk.green(name)} → ${skillRef} ${chalk.dim(`(${scope})`)}`
    );
  }
}

/**
 * Interactive skill selection
 */
async function selectSkill(): Promise<string> {
  const cache = loadCaches();
  const skills = Object.values(cache.skills);

  if (skills.length === 0) {
    console.log(chalk.yellow("No skills indexed. Run 'skillset index' first."));
    process.exit(1);
  }

  const answer = await inquirer.prompt([
    {
      type: "list",
      name: "skillRef",
      message: "Select target skill:",
      choices: skills
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((s) => ({
          name: `${s.name} (${s.skillRef})${s.description ? ` - ${s.description}` : ""}`,
          value: s.skillRef,
        })),
      pageSize: 15,
    },
  ]);

  return answer.skillRef;
}

/**
 * Prompt user for confirmation
 */
async function getUserConfirmation(): Promise<boolean> {
  const answer = await inquirer.prompt([
    {
      type: "confirm",
      name: "confirmed",
      message: "Do you want to overwrite this alias?",
      default: false,
    },
  ]);
  return answer.confirmed;
}

/**
 * Add or update an alias
 */
async function addAlias(
  name: string,
  skillRef: string,
  scope: ConfigScope,
  force: boolean
): Promise<void> {
  const currentConfig = readConfigByScope(scope);
  const existingMapping = currentConfig.mappings?.[name];

  // Check if alias exists and prompt for confirmation if needed
  if (existingMapping && !force) {
    console.log(
      chalk.yellow(
        `Alias '${name}' already exists → ${existingMapping.skillRef} (${scope})`
      )
    );
    const confirmed = await getUserConfirmation();
    if (!confirmed) {
      console.log(chalk.dim("Alias update cancelled"));
      return;
    }
  }

  // Update config
  const updatedConfig = {
    ...currentConfig,
    mappings: {
      ...currentConfig.mappings,
      [name]: { skillRef },
    },
  };

  writeConfig(scope, updatedConfig);

  const action = existingMapping ? "Updated" : "Added";
  console.log(
    chalk.green(`${action} alias '${name}' → ${skillRef} (${scope})`)
  );
  console.log(chalk.dim(`Config: ${getConfigPath(scope)}`));
}

/**
 * Handle alias command
 */
async function handleAlias(
  name?: string,
  skillRef?: string,
  options: AliasOptions = {}
): Promise<void> {
  const scope = validateScope(options.scope);

  // No arguments: list all aliases
  if (!name) {
    listAliases();
    return;
  }

  // Name provided, skillRef missing
  if (!skillRef) {
    // Interactive mode: select skill
    if (isTTY()) {
      console.log(chalk.dim(`Creating alias '${name}'`));
      const selectedSkillRef = await selectSkill();
      await addAlias(name, selectedSkillRef, scope, options.force ?? false);
      return;
    }

    // Non-TTY: error
    console.error(chalk.red("Missing argument: <skillRef>"));
    console.error(chalk.yellow("Usage: skillset alias <name> <skillRef>"));
    console.error(chalk.dim("Or run in a TTY for interactive mode"));
    process.exit(1);
  }

  // Both name and skillRef provided
  await addAlias(name, skillRef, scope, options.force ?? false);
}

/**
 * Register the alias command
 */
export function registerAliasCommand(program: Command): void {
  program
    .command("alias [name] [skillRef]")
    .description("Add or update a skill alias")
    .option(
      "-S, --scope <scope>",
      "Config scope: project, local, or user",
      "project"
    )
    .option("-f, --force", "Skip confirmation prompt")
    .action(
      async (name?: string, skillRef?: string, options?: AliasOptions) => {
        await handleAlias(name, skillRef, options);
      }
    );
}
