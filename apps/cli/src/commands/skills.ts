/**
 * skillset skills command
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
import { CLIError } from "../errors";
import type { ConfigScope } from "../types";
import { isTTY } from "../utils/tty";

interface SkillsOptions {
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
  throw new CLIError(`Invalid scope "${scope}". Must be: project or user`);
}

async function listSkills(): Promise<void> {
  const projectConfig = await loadYamlConfigByScope("project");
  const userConfig = await loadYamlConfigByScope("user");

  const allSkills = new Map<string, { entry: unknown; scope: string }>();

  if (userConfig.skills) {
    for (const [name, entry] of Object.entries(userConfig.skills)) {
      allSkills.set(name, { entry, scope: "user" });
    }
  }
  if (projectConfig.skills) {
    for (const [name, entry] of Object.entries(projectConfig.skills)) {
      allSkills.set(name, { entry, scope: "project" });
    }
  }

  if (allSkills.size === 0) {
    console.log(chalk.yellow("No skills defined"));
    console.log(
      chalk.dim("Use 'skillset skills add <alias> <skill>' to add one")
    );
    return;
  }

  console.log(chalk.bold("Current skills:\n"));

  const sorted = Array.from(allSkills.entries()).sort((a, b) =>
    a[0].localeCompare(b[0])
  );

  for (const [name, { entry, scope }] of sorted) {
    const value = typeof entry === "string" ? entry : JSON.stringify(entry);
    console.log(`  ${chalk.green(name)} → ${value} ${chalk.dim(`(${scope})`)}`);
  }
}

async function selectSkill(): Promise<string> {
  const cache = await loadCaches();
  const skills = Object.values(cache.skills);

  if (skills.length === 0) {
    throw new CLIError("No skills indexed. Run 'skillset index' first.");
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
      message: "Do you want to overwrite this skill mapping?",
      default: false,
    },
  ]);
  return answer.confirmed as boolean;
}

async function addSkill(
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
        `Skill '${name}' already exists → ${JSON.stringify(existingMapping)} (${scope})`
      )
    );
    const confirmed = await getUserConfirmation();
    if (!confirmed) {
      console.log(chalk.dim("Skill update cancelled"));
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
    chalk.green(`${action} skill '${name}' → ${skillRef} (${scope})`)
  );
  console.log(chalk.dim(`Config: ${getConfigPath(scope)}`));
}

async function removeSkill(name: string, scope: ConfigScope): Promise<void> {
  const currentConfig = await loadYamlConfigByScope(scope);
  const existingMapping = currentConfig.skills?.[name];

  if (!existingMapping) {
    throw new CLIError(`Skill '${name}' not found in ${scope} config`);
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
      `Removed skill '${name}' (was → ${JSON.stringify(existingMapping)})`
    )
  );
  console.log(chalk.dim(`Config: ${getConfigPath(scope)}`));
}

export function registerSkillsCommand(program: Command): void {
  const skillsCommand = program
    .command("skills")
    .description("Manage skill mappings")
    .option("-S, --scope <scope>", "Config scope: project or user", "project");

  skillsCommand
    .command("list")
    .description("List all skill mappings")
    .action(async () => {
      await listSkills();
    });

  skillsCommand
    .command("add <alias> [skillRef]")
    .description("Add or update a skill mapping")
    .option("-S, --scope <scope>", "Config scope: project or user", "project")
    .option("-f, --force", "Skip confirmation prompt")
    .action(
      async (
        alias: string,
        skillRef: string | undefined,
        options: SkillsOptions
      ) => {
        const scope = validateScope(options.scope);

        if (!skillRef) {
          if (isTTY()) {
            console.log(chalk.dim(`Creating skill mapping '${alias}'`));
            const selectedSkillRef = await selectSkill();
            await addSkill(
              alias,
              selectedSkillRef,
              scope,
              options.force ?? false
            );
            return;
          }

          console.error(chalk.red("Missing argument: <skillRef>"));
          console.error(
            chalk.yellow("Usage: skillset skills add <alias> <skillRef>")
          );
          console.error(chalk.dim("Or run in a TTY for interactive mode"));
          throw new CLIError("Missing argument: <skillRef>", {
            alreadyLogged: true,
          });
        }

        await addSkill(alias, skillRef, scope, options.force ?? false);
      }
    );

  skillsCommand
    .command("remove <alias>")
    .description("Remove a skill mapping")
    .option("-S, --scope <scope>", "Config scope: project or user", "project")
    .action(async (alias: string, options: SkillsOptions) => {
      const scope = validateScope(options.scope);
      await removeSkill(alias, scope);
    });

  skillsCommand.action(() => {
    listSkills();
  });
}
