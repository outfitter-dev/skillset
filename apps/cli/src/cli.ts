/**
 * Skillset CLI - Verb-first command structure
 */

import {
  CONFIG_DEFAULTS,
  getConfigPath,
  indexSkills,
  writeYamlConfig,
} from "@skillset/core";
import chalk from "chalk";
import { Command } from "commander";
import ora from "ora";
import { registerAliasCommand } from "./commands/alias";
import { registerCompletionsCommand } from "./commands/completions";
import { registerConfigCommand } from "./commands/config";
import { registerListCommand } from "./commands/list";
import { registerLoadCommand } from "./commands/load";
import { registerSetCommand } from "./commands/set";
import { registerShowCommand } from "./commands/show";
import { registerSkillsCommand } from "./commands/skills";
import { registerSyncCommand } from "./commands/sync";
import { registerUnaliasCommand } from "./commands/unalias";
import {
  runConfigDiagnostic,
  runFullDiagnostic,
  runSkillDiagnostic,
} from "./doctor";
import type { ConfigScope } from "./types";

export function buildCli() {
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
  registerSetCommand(program);
  registerSyncCommand(program);
  registerSkillsCommand(program);
  registerAliasCommand(program);
  registerUnaliasCommand(program);
  registerCompletionsCommand(program);
  registerConfigCommand(program);

  // Index command
  program
    .command("index")
    .description("Scan for SKILL.md files and refresh cache")
    .action(async () => {
      const spinner = ora("Indexing skills...").start();
      const cache = await indexSkills();
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
        await runFullDiagnostic();
      } else if (target === "config") {
        await runConfigDiagnostic();
      } else {
        await runSkillDiagnostic(target);
      }
    });

  program.parse(process.argv);
}

/**
 * Initialize skillset configuration files
 */
async function initConfig(scopeArg: string, force: boolean): Promise<void> {
  const scopes = parseInitScopes(scopeArg);
  let created = 0;
  let skipped = 0;

  for (const scope of scopes) {
    const result = await writeConfigForScope(scope, force);
    if (result === "created") {
      created += 1;
    } else {
      skipped += 1;
    }
  }

  logInitSummary(created, skipped);
}

function parseInitScopes(scopeArg: string): ConfigScope[] {
  const validatedScope = scopeArg.toLowerCase();
  const allowed = ["both", "project", "user"] as const;
  if (!allowed.includes(validatedScope as (typeof allowed)[number])) {
    console.error(
      chalk.red(
        `Invalid scope: ${scopeArg}. Must be 'project', 'user', or 'both'`
      )
    );
    process.exit(1);
  }

  if (validatedScope === "both") {
    return ["project", "user"];
  }
  return [validatedScope as ConfigScope];
}

async function writeConfigForScope(
  scope: ConfigScope,
  force: boolean
): Promise<"created" | "skipped"> {
  const configPath = getConfigPath(scope);
  const exists = await Bun.file(configPath).exists();

  if (exists && !force) {
    console.log(chalk.yellow(`Config already exists: ${configPath}`));
    console.log(chalk.dim("Use --force to overwrite"));
    return "skipped";
  }

  await writeYamlConfig(configPath, CONFIG_DEFAULTS, true);

  if (exists) {
    console.log(chalk.green(`✓ Overwrote config: ${configPath}`));
  } else {
    console.log(chalk.green(`✓ Created config: ${configPath}`));
  }
  return "created";
}

function logInitSummary(created: number, skipped: number): void {
  if (created > 0 && skipped === 0) {
    console.log(
      chalk.green(`\n✓ Successfully initialized ${created} config file(s)`)
    );
    return;
  }

  if (created > 0 && skipped > 0) {
    console.log(
      chalk.yellow(
        `\n✓ Initialized ${created} config file(s), skipped ${skipped}`
      )
    );
    return;
  }

  if (skipped > 0 && created === 0) {
    console.log(chalk.yellow("\nNo configs created (all already exist)"));
  }
}
