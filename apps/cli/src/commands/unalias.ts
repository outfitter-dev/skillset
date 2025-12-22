/**
 * skillset unalias command
 */

import { getConfigPath, readConfigByScope, writeConfig } from "@skillset/core";
import chalk from "chalk";
import type { Command } from "commander";
import inquirer from "inquirer";
import type { ConfigScope } from "../types";
import { isTTY } from "../utils/tty";

interface UnaliasOptions {
  scope?: string;
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
 * Get all aliases across all scopes
 */
function getAllAliases(): Map<
  string,
  { skillRef: string; scope: ConfigScope }
> {
  const projectConfig = readConfigByScope("project");
  const localConfig = readConfigByScope("local");
  const userConfig = readConfigByScope("user");

  const allAliases = new Map<
    string,
    { skillRef: string; scope: ConfigScope }
  >();

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

  return allAliases;
}

/**
 * Interactive alias selection for removal
 */
async function selectAliasToRemove(): Promise<{
  name: string;
  skillRef: string;
  scope: ConfigScope;
} | null> {
  const allAliases = getAllAliases();

  if (allAliases.size === 0) {
    console.log(chalk.yellow("No aliases defined"));
    return null;
  }

  const choices = Array.from(allAliases.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([name, { skillRef, scope }]) => ({
      name: `${name} → ${skillRef} (${scope})`,
      value: { name, skillRef, scope },
    }));

  const answer = await inquirer.prompt([
    {
      type: "list",
      name: "alias",
      message: "Select alias to remove:",
      choices,
      pageSize: 15,
    },
  ]);

  return answer.alias;
}

/**
 * Remove an alias
 */
function removeAlias(name: string, scope: ConfigScope): void {
  const currentConfig = readConfigByScope(scope);
  const existingMapping = currentConfig.mappings?.[name];

  if (!existingMapping) {
    console.error(chalk.red(`Alias '${name}' not found in ${scope} config`));
    process.exit(1);
  }

  // Remove the alias
  const updatedMappings = { ...currentConfig.mappings };
  delete updatedMappings[name];

  const updatedConfig = {
    ...currentConfig,
    mappings: updatedMappings,
  };

  writeConfig(scope, updatedConfig);

  console.log(
    chalk.green(`Removed alias '${name}' (was → ${existingMapping.skillRef})`)
  );
  console.log(chalk.dim(`Config: ${getConfigPath(scope)}`));
}

/**
 * Handle unalias command
 */
async function handleUnalias(
  name?: string,
  options: UnaliasOptions = {}
): Promise<void> {
  const scope = validateScope(options.scope);

  // No arguments: interactive mode
  if (!name) {
    if (isTTY()) {
      const selected = await selectAliasToRemove();
      if (!selected) {
        return;
      }
      removeAlias(selected.name, selected.scope);
      return;
    }

    // Non-TTY: error
    console.error(chalk.red("Missing argument: <name>"));
    console.error(chalk.yellow("Usage: skillset unalias <name>"));
    console.error(chalk.dim("Or run in a TTY for interactive mode"));
    process.exit(1);
  }

  // Name provided
  removeAlias(name, scope);
}

/**
 * Register the unalias command
 */
export function registerUnaliasCommand(program: Command): void {
  program
    .command("unalias [name]")
    .description("Remove a skill alias")
    .option(
      "-S, --scope <scope>",
      "Config scope: project, local, or user",
      "project"
    )
    .action(async (name?: string, options?: UnaliasOptions) => {
      await handleUnalias(name, options);
    });
}
