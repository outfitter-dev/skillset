/**
 * Skillset CLI - Verb-first command structure
 */

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  CONFIG_PATHS,
  getConfigPath,
  getConfigValue,
  indexSkills,
  loadConfig,
  readConfigByScope,
  setConfigValue,
  writeConfig,
} from "@skillset/core";
import {
  detectLegacyPaths,
  getSkillsetEnv,
  getSkillsetPaths,
  migrateLegacyProjectPaths,
  migrateLegacyUserPaths,
  removeLegacyPaths,
} from "@skillset/shared";
import chalk from "chalk";
import { Command } from "commander";
import inquirer from "inquirer";
import ora from "ora";
import { registerAliasCommand } from "./commands/alias";
import { registerCompletionsCommand } from "./commands/completions";
import { registerListCommand } from "./commands/list";
import { registerLoadCommand } from "./commands/load";
import { registerShowCommand } from "./commands/show";
import { registerSyncCommand } from "./commands/sync";
import { registerUnaliasCommand } from "./commands/unalias";
import {
  runConfigDiagnostic,
  runFullDiagnostic,
  runSkillDiagnostic,
} from "./doctor";
import type { ConfigScope } from "./types";

export function buildCli() {
  const env = getSkillsetEnv();
  const program = new Command();

  program
    .name("skillset")
    .description(
      "Deterministic skill invocation for AI coding agents via $skill syntax"
    )
    .version("0.1.0");

  // Global options
  program
    .option("-s, --source <sources...>", "Filter by source(s)")
    .option("--json", "JSON output")
    .option("--raw", "Raw output for piping")
    .option("-q, --quiet", "Suppress non-essential output")
    .option("-v, --verbose", "Extra detail")
    .option("--kind <type>", "Disambiguate skill vs set (skill|set)");

  // Register commands
  registerListCommand(program);
  registerShowCommand(program);
  registerLoadCommand(program);
  registerSyncCommand(program);
  registerAliasCommand(program);
  registerUnaliasCommand(program);
  registerCompletionsCommand(program);

  // Index command
  program
    .command("index")
    .description("Scan for SKILL.md files and refresh cache")
    .action(() => {
      const spinner = ora("Indexing skills...").start();
      const cache = indexSkills();
      spinner.succeed(`Indexed ${Object.keys(cache.skills).length} skills`);
    });

  // Init command
  program
    .command("init")
    .description("Scaffold config files with sensible defaults")
    .option(
      "-S, --scope <scope>",
      "Target scope (project, user, or both)",
      "both"
    )
    .option("-f, --force", "Overwrite existing config files", false)
    .action(async (options: { scope: string; force: boolean }) => {
      await initConfig(options.scope, options.force);
    });

  // Config command with subcommands
  const configCommand = program
    .command("config")
    .description("Manage skillset configuration")
    .option("--edit", "Open config in $EDITOR")
    .option("-S, --scope <scope>", "Config scope: project, local, or user");

  configCommand.action(async (options: { edit?: boolean; scope?: string }) => {
    const scope = validateScope(options.scope);

    if (options.edit) {
      await editConfig(scope);
      return;
    }

    showConfig();
  });

  configCommand
    .command("get <key>")
    .description("Get a config value using dot notation")
    .action((key: string) => {
      getConfigCommand(key);
    });

  configCommand
    .command("set <key> <value>")
    .description("Set a config value using dot notation")
    .option("-S, --scope <scope>", "Config scope: project, local, or user")
    .action((key: string, value: string, options: { scope?: string }) => {
      const scope = validateScope(options.scope);
      setConfigCommand(key, value, scope);
    });

  // Doctor command
  program
    .command("doctor")
    .description("Check skillset installation and configuration")
    .argument(
      "[target]",
      "What to diagnose (config, skill name, or omit for full check)"
    )
    .action(async (target?: string) => {
      if (!target) {
        runFullDiagnostic();
      } else if (target === "config") {
        runConfigDiagnostic();
      } else {
        await runSkillDiagnostic(target);
      }
    });

  program.parse(process.argv);
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
 * Show the current merged configuration
 */
function showConfig(): void {
  const config = loadConfig();
  console.log(JSON.stringify(config, null, 2));
}

/**
 * Get a config value using dot notation
 */
function getConfigCommand(key: string): void {
  const config = loadConfig();
  const value = getConfigValue(config, key);

  if (value === undefined) {
    console.error(chalk.red(`Config key not found: ${key}`));
    process.exit(1);
  }

  if (typeof value === "object") {
    console.log(JSON.stringify(value, null, 2));
  } else {
    console.log(value);
  }
}

/**
 * Set a config value using dot notation
 */
function setConfigCommand(
  key: string,
  valueStr: string,
  scope: ConfigScope
): void {
  let value: unknown;
  try {
    value = JSON.parse(valueStr);
  } catch {
    value = valueStr;
  }

  const currentConfig = readConfigByScope(scope);
  const updatedConfig = setConfigValue(currentConfig, key, value);

  writeConfig(scope, updatedConfig);

  const scopeLabel =
    scope === "local" ? "local" : scope === "user" ? "user" : "project";
  console.log(
    chalk.green(`✓ Set ${key} = ${JSON.stringify(value)} (${scopeLabel})`)
  );
}

/**
 * Open config file in editor
 */
async function editConfig(scope: ConfigScope): Promise<void> {
  const configPath = getConfigPath(scope);
  const editor = process.env.EDITOR || process.env.VISUAL || "vim";

  return new Promise((resolve, reject) => {
    const child = spawn(editor, [configPath], {
      stdio: "inherit",
      shell: true,
    });

    child.on("exit", (code) => {
      if (code === 0) {
        console.log(chalk.green(`✓ Config edited: ${configPath}`));
        resolve();
      } else {
        console.error(chalk.red(`Editor exited with code ${code}`));
        reject(new Error(`Editor exited with code ${code}`));
      }
    });

    child.on("error", (err) => {
      console.error(chalk.red(`Failed to open editor: ${err.message}`));
      reject(err);
    });
  });
}

/**
 * Initialize skillset configuration files
 */
async function initConfig(scopeArg: string, force: boolean): Promise<void> {
  // Check for legacy paths first
  const legacy = detectLegacyPaths();
  const hasLegacy = legacy.hasLegacyUser || legacy.hasLegacyProject;

  if (hasLegacy) {
    console.log(chalk.bold("\nDetected legacy paths:"));
    if (legacy.hasLegacyUser && legacy.userPath) {
      console.log(chalk.yellow(`  User: ${legacy.userPath}`));
      const xdgPaths = getSkillsetPaths();
      console.log(chalk.dim(`    → ${xdgPaths.config}/`));
    }
    if (legacy.hasLegacyProject && legacy.projectPath) {
      console.log(chalk.yellow(`  Project: ${legacy.projectPath}`));
      console.log(chalk.dim(`    → ${process.cwd()}/.skillset/`));
    }

    const answer = await inquirer.prompt([
      {
        type: "confirm",
        name: "migrate",
        message: "Migrate legacy paths to new locations?",
        default: true,
      },
    ]);

    if (answer.migrate) {
      let migrationSuccess = true;

      // Migrate user paths
      if (legacy.hasLegacyUser && legacy.userPath) {
        const result = migrateLegacyUserPaths(legacy.userPath);
        if (result.success) {
          console.log(chalk.green("✓ Migrated user-level paths"));
        } else {
          console.log(
            chalk.red(`✗ Failed to migrate user paths: ${result.error}`)
          );
          migrationSuccess = false;
        }
      }

      // Migrate project paths
      if (legacy.hasLegacyProject && legacy.projectPath) {
        const result = migrateLegacyProjectPaths(legacy.projectPath);
        if (result.success) {
          console.log(chalk.green("✓ Migrated project-level paths"));
        } else {
          console.log(
            chalk.red(`✗ Failed to migrate project paths: ${result.error}`)
          );
          migrationSuccess = false;
        }
      }

      // Remove legacy paths if migration succeeded
      if (migrationSuccess) {
        const removeAnswer = await inquirer.prompt([
          {
            type: "confirm",
            name: "removeLegacy",
            message: "Remove legacy directories after migration?",
            default: true,
          },
        ]);

        if (removeAnswer.removeLegacy) {
          const result = removeLegacyPaths({
            user: legacy.hasLegacyUser ? legacy.userPath : undefined,
            project: legacy.hasLegacyProject ? legacy.projectPath : undefined,
          });
          if (result.success) {
            console.log(chalk.green("✓ Removed legacy directories"));
          } else {
            console.log(
              chalk.yellow(`⚠ Could not remove legacy paths: ${result.error}`)
            );
            console.log(chalk.dim("You can manually remove them later"));
          }
        }
      }
      console.log();
    }
  }

  const defaultConfig = {
    version: 1,
    mode: "warn" as const,
    showStructure: false,
    maxLines: 500,
    mappings: {},
    namespaceAliases: {},
  };

  const validatedScope = scopeArg.toLowerCase();
  if (
    validatedScope !== "both" &&
    validatedScope !== "project" &&
    validatedScope !== "user"
  ) {
    console.error(
      chalk.red(
        `Invalid scope: ${scopeArg}. Must be 'project', 'user', or 'both'`
      )
    );
    process.exit(1);
  }

  const scopes: Array<"project" | "user"> = [];
  if (validatedScope === "both") {
    scopes.push("project", "user");
  } else {
    scopes.push(validatedScope as "project" | "user");
  }

  let created = 0;
  let skipped = 0;

  for (const scope of scopes) {
    const configPath = CONFIG_PATHS[scope];
    const exists = existsSync(configPath);

    if (exists && !force) {
      console.log(chalk.yellow(`Config already exists: ${configPath}`));
      console.log(chalk.dim("Use --force to overwrite"));
      skipped++;
      continue;
    }

    const dir = dirname(configPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    writeFileSync(
      configPath,
      JSON.stringify(defaultConfig, null, 2) + "\n",
      "utf8"
    );

    if (exists) {
      console.log(chalk.green(`✓ Overwrote config: ${configPath}`));
    } else {
      console.log(chalk.green(`✓ Created config: ${configPath}`));
    }
    created++;
  }

  if (created > 0 && skipped === 0) {
    console.log(
      chalk.green(`\n✓ Successfully initialized ${created} config file(s)`)
    );
  } else if (created > 0 && skipped > 0) {
    console.log(
      chalk.yellow(
        `\n✓ Initialized ${created} config file(s), skipped ${skipped}`
      )
    );
  } else if (skipped > 0 && created === 0) {
    console.log(chalk.yellow("\nNo configs created (all already exist)"));
  }
}
