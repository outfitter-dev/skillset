import { existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  CACHE_PATHS,
  CONFIG_PATHS,
  loadCaches,
  loadConfig,
  resolveToken,
} from "@skillset/core";
import { getSkillsetPaths } from "@skillset/shared";
import chalk from "chalk";
import { normalizeInvocation } from "./utils/normalize";

/**
 * Run full diagnostic check
 */
export function runFullDiagnostic(): void {
  console.log(chalk.bold("skillset doctor"));
  console.log("─".repeat(40));

  const projectConfigPath = CONFIG_PATHS.project();
  const userConfigPath = CONFIG_PATHS.user();
  const generatedPath = CONFIG_PATHS.generated();

  const projectConfigExists = existsSync(projectConfigPath);
  const userConfigExists = existsSync(userConfigPath);
  const generatedExists = existsSync(generatedPath);

  if (projectConfigExists) {
    console.log(`${chalk.green("✓")} Config: project (${projectConfigPath})`);
  } else {
    console.log(`${chalk.dim("○")} Config: project (not found)`);
  }

  if (userConfigExists) {
    console.log(`${chalk.green("✓")} Config: user (${userConfigPath})`);
  } else {
    console.log(`${chalk.dim("○")} Config: user (not found)`);
  }

  if (generatedExists) {
    console.log(`${chalk.green("✓")} Config: generated (${generatedPath})`);
  } else {
    console.log(`${chalk.dim("○")} Config: generated (not found)`);
  }

  // Check cache
  const projectCacheExists = existsSync(CACHE_PATHS.project);

  try {
    const cache = loadCaches();
    const skillCount = Object.keys(cache.skills).length;

    // Count skills by source
    const sourceCounts = { project: 0, user: 0, plugin: 0 };
    for (const skill of Object.values(cache.skills)) {
      if (skill.skillRef.startsWith("project:")) {
        sourceCounts.project++;
      } else if (skill.skillRef.startsWith("user:")) {
        sourceCounts.user++;
      } else if (skill.skillRef.startsWith("plugin:")) {
        sourceCounts.plugin++;
      }
    }

    // Get cache age
    let cacheAge = "unknown";
    if (projectCacheExists) {
      try {
        const stat = statSync(CACHE_PATHS.project);
        const ageMs = Date.now() - stat.mtimeMs;
        const ageMinutes = Math.floor(ageMs / 60_000);
        if (ageMinutes < 1) {
          cacheAge = "just now";
        } else if (ageMinutes === 1) {
          cacheAge = "1m ago";
        } else if (ageMinutes < 60) {
          cacheAge = `${ageMinutes}m ago`;
        } else {
          const ageHours = Math.floor(ageMinutes / 60);
          cacheAge = ageHours === 1 ? "1h ago" : `${ageHours}h ago`;
        }
      } catch {
        // Ignore stat errors
      }
    }

    console.log(
      `${chalk.green("✓")} Cache: ${skillCount} skills indexed (${cacheAge})`
    );
    console.log(
      `${chalk.green("✓")} Sources: ${sourceCounts.project} project, ${sourceCounts.user} user, ${sourceCounts.plugin} plugin`
    );
  } catch (err) {
    console.log(`${chalk.red("✗")} Cache: Error loading cache`);
    if (err instanceof Error) {
      console.log(`  ${chalk.dim(err.message)}`);
    }
  }

  // Show resolved XDG paths
  const skillsetPaths = getSkillsetPaths();
  console.log();
  console.log(chalk.bold("XDG Paths:"));
  console.log(`  Config: ${skillsetPaths.config}`);
  console.log(`  Data:   ${skillsetPaths.data}`);
  console.log(`  Cache:  ${skillsetPaths.cache}`);
  console.log(`  Logs:   ${skillsetPaths.logs}`);

  // Check for plugins
  const pluginsDir = join(homedir(), ".claude", "plugins");
  if (existsSync(pluginsDir)) {
    console.log(
      `${chalk.green("✓")} Plugins: directory exists (${pluginsDir})`
    );
  } else {
    console.log(`${chalk.dim("○")} Plugins: directory not found`);
  }

  // Hook detection (check if skillset plugin exists)
  const skillsetPluginDir = join(homedir(), ".claude", "plugins", "skillset");
  if (existsSync(skillsetPluginDir)) {
    console.log(
      `${chalk.green("✓")} Hook: Plugin detected (${skillsetPluginDir})`
    );
  } else {
    console.log(`${chalk.yellow("⚠")} Hook: Plugin not detected`);
  }
}

/**
 * Run config-specific diagnostic
 */
export function runConfigDiagnostic(): void {
  console.log(chalk.bold("skillset doctor config"));
  console.log("─".repeat(40));

  const projectConfigPath = CONFIG_PATHS.project();
  const userConfigPath = CONFIG_PATHS.user();
  const generatedPath = CONFIG_PATHS.generated();
  console.log(chalk.bold("\nConfig files:"));

  const projectConfigExists = existsSync(projectConfigPath);
  const userConfigExists = existsSync(userConfigPath);
  const generatedExists = existsSync(generatedPath);

  console.log(
    `  Project: ${projectConfigExists ? chalk.green("exists") : chalk.dim("not found")}`
  );
  console.log(`    ${chalk.dim(projectConfigPath)}`);

  console.log(
    `  User:    ${userConfigExists ? chalk.green("exists") : chalk.dim("not found")}`
  );
  console.log(`    ${chalk.dim(userConfigPath)}`);

  console.log(
    `  Generated: ${generatedExists ? chalk.green("exists") : chalk.dim("not found")}`
  );
  console.log(`    ${chalk.dim(generatedPath)}`);

  // Try to load and validate merged config
  console.log(chalk.bold("\nMerged config:"));
  try {
    const config = loadConfig();
    console.log(JSON.stringify(config, null, 2));

    // Validate config schema
    console.log(chalk.bold("\nValidation:"));
    const errors: string[] = [];

    if (typeof config.version !== "number") {
      errors.push("version must be a number");
    }
    if (
      !config.rules ||
      (config.rules.unresolved !== "ignore" &&
        config.rules.unresolved !== "warn" &&
        config.rules.unresolved !== "error")
    ) {
      errors.push("rules.unresolved must be 'ignore', 'warn', or 'error'");
    }
    if (
      !config.rules ||
      (config.rules.ambiguous !== "ignore" &&
        config.rules.ambiguous !== "warn" &&
        config.rules.ambiguous !== "error")
    ) {
      errors.push("rules.ambiguous must be 'ignore', 'warn', or 'error'");
    }
    if (!config.output || typeof config.output.max_lines !== "number") {
      errors.push("output.max_lines must be a number");
    }
    if (!config.output || typeof config.output.include_layout !== "boolean") {
      errors.push("output.include_layout must be a boolean");
    }
    if (typeof config.skills !== "object") {
      errors.push("skills must be an object");
    }
    if (config.sets && typeof config.sets !== "object") {
      errors.push("sets must be an object");
    }

    if (errors.length === 0) {
      console.log(`${chalk.green("✓")} Config schema is valid`);
    } else {
      console.log(`${chalk.red("✗")} Config schema has errors:`);
      for (const error of errors) {
        console.log(`  ${chalk.red("•")} ${error}`);
      }
    }
  } catch (err) {
    console.log(`${chalk.red("✗")} Error loading config:`);
    if (err instanceof Error) {
      console.log(`  ${err.message}`);
    }
  }
}

/**
 * Run skill-specific diagnostic
 */
export async function runSkillDiagnostic(skillAlias: string): Promise<void> {
  console.log(chalk.bold(`skillset doctor ${skillAlias}`));
  console.log("─".repeat(40));

  const cache = loadCaches();
  const config = loadConfig();

  // Normalize the alias
  const token = normalizeInvocation(skillAlias);

  console.log(chalk.bold("\nResolution:"));
  console.log(`  Input: ${chalk.cyan(skillAlias)}`);
  console.log(`  Token: ${chalk.dim(JSON.stringify(token))}`);

  // Try to resolve
  const result = resolveToken(token, config, cache);

  if (result.skill) {
    console.log(
      `  ${chalk.green("✓")} Resolved to: ${chalk.green(result.skill.skillRef)}`
    );
    console.log();
    console.log(chalk.bold("Skill details:"));
    console.log(`  Name: ${result.skill.name}`);
    console.log(
      `  Description: ${result.skill.description ?? chalk.dim("(none)")}`
    );
    console.log(`  Path: ${result.skill.path}`);
    console.log(`  Lines: ${result.skill.lineCount ?? chalk.dim("unknown")}`);
  } else if (result.reason === "ambiguous" && result.candidates) {
    console.log(`  ${chalk.yellow("⚠")} Ambiguous - multiple matches found:`);
    console.log();
    console.log(chalk.bold("Candidates:"));
    for (const candidate of result.candidates) {
      console.log(`  ${chalk.yellow("•")} ${candidate.skillRef}`);
      console.log(`    ${chalk.dim(candidate.name)}`);
      console.log(`    ${chalk.dim(candidate.path)}`);
    }
    console.log();
    console.log(
      chalk.yellow(
        "Suggestion: Use a more specific alias or add a namespace prefix"
      )
    );
  } else if (result.reason === "unmatched") {
    console.log(`  ${chalk.red("✗")} Not found`);
    console.log();
    console.log(chalk.bold("Suggestions:"));
    console.log(`  • Run ${chalk.cyan("skillset index")} to refresh the cache`);
    console.log(
      `  • Check that the skill exists with ${chalk.cyan("skillset")}`
    );
    console.log("  • Try a different alias or namespace");
  } else {
    console.log(
      `  ${chalk.red("✗")} Resolution failed: ${result.reason ?? "unknown error"}`
    );
  }

  // Show all sources where this skill might exist
  console.log();
  console.log(chalk.bold("All matching skills in cache:"));
  const allMatches = Object.values(cache.skills).filter(
    (s) =>
      s.name.toLowerCase().includes(token.alias.toLowerCase()) ||
      s.skillRef.toLowerCase().includes(token.alias.toLowerCase())
  );

  if (allMatches.length === 0) {
    console.log(`  ${chalk.dim("(none)")}`);
  } else {
    for (const match of allMatches) {
      console.log(`  ${chalk.cyan("•")} ${match.skillRef}`);
      console.log(`    ${chalk.dim(match.name)}`);
    }
  }
}
