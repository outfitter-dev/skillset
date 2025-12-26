/**
 * skillset unalias command (deprecated; use skills remove)
 */

import {
  getConfigPath,
  loadYamlConfigByScope,
  writeYamlConfig,
} from "@skillset/core";
import chalk from "chalk";
import type { Command } from "commander";
import inquirer from "inquirer";
import type { ConfigScope } from "../types";
import { isTTY } from "../utils/tty";

interface UnaliasOptions {
  scope?: string;
}

function validateScope(scope: string | undefined): ConfigScope {
  if (!scope || scope === "project") {
    return "project";
  }
  if (scope === "user") {
    return "user";
  }
  console.error(
    chalk.red(`Invalid scope "${scope}". Must be: project or user`)
  );
  process.exit(1);
}

async function getAllAliases(): Promise<
  Map<string, { entry: unknown; scope: ConfigScope }>
> {
  const projectConfig = await loadYamlConfigByScope("project");
  const userConfig = await loadYamlConfigByScope("user");

  const allAliases = new Map<string, { entry: unknown; scope: ConfigScope }>();

  if (userConfig.skills) {
    for (const [name, entry] of Object.entries(userConfig.skills)) {
      allAliases.set(name, { entry, scope: "user" });
    }
  }
  if (projectConfig.skills) {
    for (const [name, entry] of Object.entries(projectConfig.skills)) {
      allAliases.set(name, { entry, scope: "project" });
    }
  }

  return allAliases;
}

async function selectAliasToRemove(): Promise<{
  name: string;
  scope: ConfigScope;
} | null> {
  const allAliases = await getAllAliases();

  if (allAliases.size === 0) {
    console.log(chalk.yellow("No aliases defined"));
    return null;
  }

  const choices = Array.from(allAliases.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([name, { entry, scope }]) => ({
      name: `${name} → ${typeof entry === "string" ? entry : JSON.stringify(entry)} (${scope})`,
      value: { name, scope },
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

  return answer.alias as { name: string; scope: ConfigScope };
}

async function removeAlias(name: string, scope: ConfigScope): Promise<void> {
  const currentConfig = await loadYamlConfigByScope(scope);
  const existingMapping = currentConfig.skills?.[name];

  if (!existingMapping) {
    console.error(chalk.red(`Alias '${name}' not found in ${scope} config`));
    process.exit(1);
  }

  const updatedSkills = { ...(currentConfig.skills ?? {}) };
  delete updatedSkills[name];

  const updatedConfig = {
    ...currentConfig,
    skills: updatedSkills,
  };

  await writeYamlConfig(getConfigPath(scope), updatedConfig, true);

  console.log(
    chalk.green(
      `Removed alias '${name}' (was → ${JSON.stringify(existingMapping)})`
    )
  );
  console.log(chalk.dim(`Config: ${getConfigPath(scope)}`));
}

async function handleUnalias(
  name?: string,
  options: UnaliasOptions = {}
): Promise<void> {
  const scope = validateScope(options.scope);

  if (!name) {
    if (isTTY()) {
      const selected = await selectAliasToRemove();
      if (!selected) {
        return;
      }
      await removeAlias(selected.name, selected.scope);
      return;
    }

    console.error(chalk.red("Missing argument: <name>"));
    console.error(chalk.yellow("Usage: skillset unalias <name>"));
    console.error(chalk.dim("Or run in a TTY for interactive mode"));
    process.exit(1);
  }

  await removeAlias(name, scope);
}

export function registerUnaliasCommand(program: Command): void {
  program
    .command("unalias [name]")
    .description("Remove a skill alias (deprecated; use skills remove)")
    .option("-S, --scope <scope>", "Config scope: project or user", "project")
    .action(async (name?: string, options?: UnaliasOptions) => {
      console.log(
        chalk.dim("Unalias is deprecated. Use `skillset skills` instead.")
      );
      await handleUnalias(name, options);
    });
}
