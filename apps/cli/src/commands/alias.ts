/**
 * skillset alias command (deprecated; use skills)
 */

import {
  getConfigPath,
  loadCaches,
  loadYamlConfigByScope,
  writeYamlConfig,
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

async function listAliases(): Promise<void> {
  const projectConfig = await loadYamlConfigByScope("project");
  const userConfig = await loadYamlConfigByScope("user");

  const allAliases = new Map<string, { entry: unknown; scope: string }>();

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

  if (allAliases.size === 0) {
    console.log(chalk.yellow("No aliases defined"));
    console.log(
      chalk.dim("Use 'skillset skills add <alias> <skill>' to create one")
    );
    return;
  }

  console.log(chalk.bold("Current aliases:\n"));

  const sortedAliases = Array.from(allAliases.entries()).sort((a, b) =>
    a[0].localeCompare(b[0])
  );

  for (const [name, { entry, scope }] of sortedAliases) {
    const value = typeof entry === "string" ? entry : JSON.stringify(entry);
    console.log(`  ${chalk.green(name)} → ${value} ${chalk.dim(`(${scope})`)}`);
  }
}

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

  return answer.skillRef as string;
}

async function getUserConfirmation(): Promise<boolean> {
  const answer = await inquirer.prompt([
    {
      type: "confirm",
      name: "confirmed",
      message: "Do you want to overwrite this alias?",
      default: false,
    },
  ]);
  return answer.confirmed as boolean;
}

async function addAlias(
  name: string,
  skillRef: string,
  scope: ConfigScope,
  force: boolean
): Promise<void> {
  const currentConfig = await loadYamlConfigByScope(scope);
  const existingMapping = currentConfig.skills?.[name];

  if (existingMapping && !force) {
    console.log(
      chalk.yellow(
        `Alias '${name}' already exists → ${JSON.stringify(existingMapping)} (${scope})`
      )
    );
    const confirmed = await getUserConfirmation();
    if (!confirmed) {
      console.log(chalk.dim("Alias update cancelled"));
      return;
    }
  }

  const updatedConfig = {
    ...currentConfig,
    skills: {
      ...(currentConfig.skills ?? {}),
      [name]: skillRef,
    },
  };

  await writeYamlConfig(getConfigPath(scope), updatedConfig, true);

  const action = existingMapping ? "Updated" : "Added";
  console.log(
    chalk.green(`${action} alias '${name}' → ${skillRef} (${scope})`)
  );
  console.log(chalk.dim(`Config: ${getConfigPath(scope)}`));
}

async function handleAlias(
  name?: string,
  skillRef?: string,
  options: AliasOptions = {}
): Promise<void> {
  const scope = validateScope(options.scope);

  if (!name) {
    await listAliases();
    return;
  }

  if (!skillRef) {
    if (isTTY()) {
      console.log(chalk.dim(`Creating alias '${name}'`));
      const selectedSkillRef = await selectSkill();
      await addAlias(name, selectedSkillRef, scope, options.force ?? false);
      return;
    }

    console.error(chalk.red("Missing argument: <skillRef>"));
    console.error(chalk.yellow("Usage: skillset alias <name> <skillRef>"));
    console.error(chalk.dim("Or run in a TTY for interactive mode"));
    process.exit(1);
  }

  await addAlias(name, skillRef, scope, options.force ?? false);
}

export function registerAliasCommand(program: Command): void {
  program
    .command("alias [name] [skillRef]")
    .description("Add or update a skill alias (deprecated; use skills)")
    .option("-S, --scope <scope>", "Config scope: project or user", "project")
    .option("-f, --force", "Skip confirmation prompt")
    .action(
      async (name?: string, skillRef?: string, options?: AliasOptions) => {
        console.log(
          chalk.dim("Alias is deprecated. Use `skillset skills` instead.")
        );
        await handleAlias(name, skillRef, options);
      }
    );
}
