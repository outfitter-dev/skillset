import { existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ConfigSchema } from "@skillset/core";
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
export async function runFullDiagnostic(): Promise<void> {
  console.log(chalk.bold("skillset doctor"));
  console.log("─".repeat(40));

  printConfigStatus();
  await printCacheStatus();
  printXdgPaths();
  printPluginStatus();
}

/**
 * Run config-specific diagnostic
 */
export async function runConfigDiagnostic(): Promise<void> {
  console.log(chalk.bold("skillset doctor config"));
  console.log("─".repeat(40));

  printConfigFiles();
  await printConfigValidation();
}

/**
 * Run skill-specific diagnostic
 */
export async function runSkillDiagnostic(skillAlias: string): Promise<void> {
  console.log(chalk.bold(`skillset doctor ${skillAlias}`));
  console.log("─".repeat(40));

  const cache = await loadCaches();
  const config = await loadConfig();

  // Normalize the alias
  const token = normalizeInvocation(skillAlias);

  console.log(chalk.bold("\nResolution:"));
  console.log(`  Input: ${chalk.cyan(skillAlias)}`);
  console.log(`  Token: ${chalk.dim(JSON.stringify(token))}`);

  // Try to resolve
  const result = await resolveToken(token, config, cache);

  if (result.skill) {
    printResolvedSkill(result.skill);
  } else if (result.reason === "ambiguous" && result.candidates) {
    printAmbiguousSkill(result.candidates);
  } else if (result.reason === "unmatched") {
    printUnmatchedSkill();
  } else {
    printResolutionError(result.reason);
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

function printConfigStatus(): void {
  const projectConfigPath = CONFIG_PATHS.project();
  const userConfigPath = CONFIG_PATHS.user();
  const generatedPath = CONFIG_PATHS.generated();

  logConfigStatus("project", projectConfigPath);
  logConfigStatus("user", userConfigPath);
  logConfigStatus("generated", generatedPath);
}

function logConfigStatus(label: string, path: string): void {
  if (existsSync(path)) {
    console.log(`${chalk.green("✓")} Config: ${label} (${path})`);
  } else {
    console.log(`${chalk.dim("○")} Config: ${label} (not found)`);
  }
}

async function printCacheStatus(): Promise<void> {
  const projectCacheExists = existsSync(CACHE_PATHS.project);

  try {
    const cache = await loadCaches();
    const skillCount = Object.keys(cache.skills).length;
    const sourceCounts = countSources(cache.skills);
    const cacheAge = projectCacheExists ? getCacheAge() : "unknown";

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
}

function countSources(skills: Record<string, { skillRef: string }>) {
  const sourceCounts = { project: 0, user: 0, plugin: 0 };
  for (const skill of Object.values(skills)) {
    if (skill.skillRef.startsWith("project:")) {
      sourceCounts.project++;
      continue;
    }
    if (skill.skillRef.startsWith("user:")) {
      sourceCounts.user++;
      continue;
    }
    if (skill.skillRef.startsWith("plugin:")) {
      sourceCounts.plugin++;
    }
  }
  return sourceCounts;
}

function getCacheAge(): string {
  try {
    const stat = statSync(CACHE_PATHS.project);
    const ageMs = Date.now() - stat.mtimeMs;
    const ageMinutes = Math.floor(ageMs / 60_000);
    if (ageMinutes < 1) {
      return "just now";
    }
    if (ageMinutes === 1) {
      return "1m ago";
    }
    if (ageMinutes < 60) {
      return `${ageMinutes}m ago`;
    }
    const ageHours = Math.floor(ageMinutes / 60);
    return ageHours === 1 ? "1h ago" : `${ageHours}h ago`;
  } catch {
    return "unknown";
  }
}

function printXdgPaths(): void {
  const skillsetPaths = getSkillsetPaths();
  console.log();
  console.log(chalk.bold("XDG Paths:"));
  console.log(`  Config: ${skillsetPaths.config}`);
  console.log(`  Data:   ${skillsetPaths.data}`);
  console.log(`  Cache:  ${skillsetPaths.cache}`);
  console.log(`  Logs:   ${skillsetPaths.logs}`);
}

function printPluginStatus(): void {
  const pluginsDir = join(homedir(), ".claude", "plugins");
  if (existsSync(pluginsDir)) {
    console.log(
      `${chalk.green("✓")} Plugins: directory exists (${pluginsDir})`
    );
  } else {
    console.log(`${chalk.dim("○")} Plugins: directory not found`);
  }

  const skillsetPluginDir = join(homedir(), ".claude", "plugins", "skillset");
  if (existsSync(skillsetPluginDir)) {
    console.log(
      `${chalk.green("✓")} Hook: Plugin detected (${skillsetPluginDir})`
    );
  } else {
    console.log(`${chalk.yellow("⚠")} Hook: Plugin not detected`);
  }
}

function printConfigFiles(): void {
  const projectConfigPath = CONFIG_PATHS.project();
  const userConfigPath = CONFIG_PATHS.user();
  const generatedPath = CONFIG_PATHS.generated();
  console.log(chalk.bold("\nConfig files:"));

  console.log(
    `  Project: ${existsSync(projectConfigPath) ? chalk.green("exists") : chalk.dim("not found")}`
  );
  console.log(`    ${chalk.dim(projectConfigPath)}`);

  console.log(
    `  User:    ${existsSync(userConfigPath) ? chalk.green("exists") : chalk.dim("not found")}`
  );
  console.log(`    ${chalk.dim(userConfigPath)}`);

  console.log(
    `  Generated: ${existsSync(generatedPath) ? chalk.green("exists") : chalk.dim("not found")}`
  );
  console.log(`    ${chalk.dim(generatedPath)}`);
}

async function printConfigValidation(): Promise<void> {
  console.log(chalk.bold("\nMerged config:"));
  try {
    const config = await loadConfig();
    console.log(JSON.stringify(config, null, 2));
    console.log(chalk.bold("\nValidation:"));

    const errors = validateConfig(config);
    if (errors.length === 0) {
      console.log(`${chalk.green("✓")} Config schema is valid`);
      return;
    }

    console.log(`${chalk.red("✗")} Config schema has errors:`);
    for (const error of errors) {
      console.log(`  ${chalk.red("•")} ${error}`);
    }
  } catch (err) {
    console.log(`${chalk.red("✗")} Error loading config:`);
    if (err instanceof Error) {
      console.log(`  ${err.message}`);
    }
  }
}

function validateConfig(config: ConfigSchema): string[] {
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

  return errors;
}

function printResolvedSkill(skill: import("@skillset/core").Skill): void {
  console.log(
    `  ${chalk.green("✓")} Resolved to: ${chalk.green(skill.skillRef)}`
  );
  console.log();
  console.log(chalk.bold("Skill details:"));
  console.log(`  Name: ${skill.name}`);
  console.log(`  Description: ${skill.description ?? chalk.dim("(none)")}`);
  console.log(`  Path: ${skill.path}`);
  console.log(`  Lines: ${skill.lineCount ?? chalk.dim("unknown")}`);
}

function printAmbiguousSkill(
  candidates: Array<{ skillRef: string; name: string; path: string }>
): void {
  console.log(`  ${chalk.yellow("⚠")} Ambiguous - multiple matches found:`);
  console.log();
  console.log(chalk.bold("Candidates:"));
  for (const candidate of candidates) {
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
}

function printUnmatchedSkill(): void {
  console.log(`  ${chalk.red("✗")} Not found`);
  console.log();
  console.log(chalk.bold("Suggestions:"));
  console.log(`  • Run ${chalk.cyan("skillset index")} to refresh the cache`);
  console.log(`  • Check that the skill exists with ${chalk.cyan("skillset")}`);
  console.log("  • Try a different alias or namespace");
}

function printResolutionError(reason?: string): void {
  console.log(
    `  ${chalk.red("✗")} Resolution failed: ${reason ?? "unknown error"}`
  );
}
