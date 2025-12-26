/**
 * skillset config command
 */

import { spawn } from "node:child_process";
import {
  cleanupGeneratedConfig,
  getConfigPath,
  getConfigValue,
  loadConfig,
  loadGeneratedSettings,
  loadYamlConfigByScope,
  resetGeneratedConfigValue,
  setGeneratedConfigValue,
  writeGeneratedSettings,
} from "@skillset/core";
import { getProjectRoot } from "@skillset/shared";
import chalk from "chalk";
import type { Command } from "commander";
import type { ConfigScope } from "../types";

interface ConfigOptions {
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

function parseValue(valueStr: string): unknown {
  try {
    return JSON.parse(valueStr);
  } catch {
    return valueStr;
  }
}

function showConfig(): void {
  const config = loadConfig();
  console.log(JSON.stringify(config, null, 2));
}

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

async function setConfigCommand(
  key: string,
  valueStr: string,
  scope: ConfigScope
): Promise<void> {
  const value = parseValue(valueStr);
  const projectRoot = scope === "project" ? getProjectRoot() : undefined;

  await setGeneratedConfigValue(key, value, projectRoot);
  const scopeLabel = scope === "project" ? "project" : "user";
  console.log(
    chalk.green(`✓ Set ${key} = ${JSON.stringify(value)} (${scopeLabel})`)
  );
}

async function resetConfigCommand(
  key: string,
  scope: ConfigScope
): Promise<void> {
  const projectRoot = scope === "project" ? getProjectRoot() : undefined;
  await resetGeneratedConfigValue(key, projectRoot);
  const scopeLabel = scope === "project" ? "project" : "user";
  console.log(chalk.green(`✓ Reset ${key} (${scopeLabel})`));
}

function editConfig(scope: ConfigScope): Promise<void> {
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

async function gcConfig(): Promise<void> {
  const projectRoot = getProjectRoot();
  const userYaml = loadYamlConfigByScope("user");
  const projectYaml = loadYamlConfigByScope("project", projectRoot);

  const cleaned = cleanupGeneratedConfig(userYaml, projectYaml, projectRoot);
  await writeGeneratedSettings(cleaned);

  console.log(chalk.green("✓ Cleaned generated config hashes"));
}

function showGenerated(): void {
  const generated = loadGeneratedSettings();
  console.log(JSON.stringify(generated, null, 2));
}

export function registerConfigCommand(program: Command): void {
  const configCommand = program
    .command("config")
    .description("Manage skillset configuration")
    .option("--edit", "Open config in $EDITOR")
    .option("-S, --scope <scope>", "Config scope: project or user");

  configCommand.action(async (options: ConfigOptions & { edit?: boolean }) => {
    const scope = validateScope(options.scope);

    if (options.edit) {
      await editConfig(scope);
      return;
    }

    showConfig();
  });

  configCommand
    .command("show")
    .description("Show merged configuration")
    .action(() => {
      showConfig();
    });

  configCommand
    .command("generated")
    .description("Show generated config overrides")
    .action(() => {
      showGenerated();
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
    .option("-S, --scope <scope>", "Config scope: project or user", "project")
    .action(async (key: string, value: string, options: ConfigOptions) => {
      const scope = validateScope(options.scope);
      await setConfigCommand(key, value, scope);
    });

  configCommand
    .command("reset <key>")
    .description("Remove generated override for a key")
    .option("-S, --scope <scope>", "Config scope: project or user", "project")
    .action(async (key: string, options: ConfigOptions) => {
      const scope = validateScope(options.scope);
      await resetConfigCommand(key, scope);
    });

  configCommand
    .command("gc")
    .description("Garbage-collect stale generated overrides")
    .action(async () => {
      await gcConfig();
    });
}
