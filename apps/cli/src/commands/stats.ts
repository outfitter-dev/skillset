/**
 * skillset stats command
 */

import { loadCaches, loadConfig } from "@skillset/core";
import {
  aggregateUsageBySkill,
  clearUsageLog,
  inferToolFromPath,
  parseDuration,
  readUsageLog,
} from "@skillset/shared";
import chalk from "chalk";
import type { Command } from "commander";
import type { GlobalOptions } from "../types";
import { determineFormat } from "../utils/format";
import { addFilterOptions, addOutputOptions } from "../utils/options";

interface UsageOptions {
  top?: number | true;
  unused?: boolean;
  since?: string;
  clear?: boolean;
}

type CountMap = Record<string, number>;

interface StatsReport {
  totalIndexed: number;
  totalVisible: number;
  scopes: CountMap;
  tools: CountMap;
  config: {
    skills: number;
    sets: number;
    tools?: string[];
  };
  filters?: string[];
}

interface UsageStatsReport {
  totalLoads: number;
  uniqueSkills: number;
  topSkills: Array<{ skill: string; count: number }>;
  unusedSkills?: string[];
  period?: string;
}

function matchesSourceFilter(
  skillRef: string,
  sourceFilters: string[] | undefined
): boolean {
  if (!sourceFilters || sourceFilters.length === 0) {
    return true;
  }

  for (const filter of sourceFilters) {
    if (filter === "project" || filter === "user" || filter === "plugin") {
      if (skillRef.startsWith(`${filter}:`)) {
        return true;
      }
      continue;
    }
    if (filter.startsWith("plugin:")) {
      const pluginName = filter.slice(7);
      if (skillRef.startsWith(`plugin:${pluginName}/`)) {
        return true;
      }
    }
  }

  return false;
}

function incrementCount(map: CountMap, key: string): void {
  map[key] = (map[key] ?? 0) + 1;
}

function countScopes(skillRefs: string[]): CountMap {
  const counts: CountMap = {};
  for (const ref of skillRefs) {
    const scope = ref.split(":")[0] ?? "unknown";
    incrementCount(counts, scope);
  }
  return counts;
}

function countTools(paths: string[]): CountMap {
  const counts: CountMap = {};
  for (const path of paths) {
    const tool = inferToolFromPath(path) ?? "unknown";
    incrementCount(counts, tool);
  }
  return counts;
}

async function buildStats(options: GlobalOptions): Promise<StatsReport> {
  const cache = await loadCaches();
  const config = await loadConfig();
  const allSkills = Object.values(cache.skills);
  const visibleSkills = allSkills.filter((skill) =>
    matchesSourceFilter(skill.skillRef, options.source)
  );
  const scopes = countScopes(visibleSkills.map((skill) => skill.skillRef));
  const tools = countTools(visibleSkills.map((skill) => skill.path));

  const configSummary: StatsReport["config"] = {
    skills: Object.keys(config.skills).length,
    sets: Object.keys(config.sets ?? {}).length,
  };
  if (config.tools && config.tools.length > 0) {
    configSummary.tools = config.tools;
  }

  const report: StatsReport = {
    totalIndexed: allSkills.length,
    totalVisible: visibleSkills.length,
    scopes,
    tools,
    config: configSummary,
    ...(options.source && options.source.length > 0
      ? { filters: options.source }
      : {}),
  };

  return report;
}

function printStatsText(report: StatsReport, verbose: boolean): void {
  console.log(chalk.bold("Skillset stats"));
  console.log(chalk.dim(`Total indexed: ${report.totalIndexed}`));
  if (report.filters && report.filters.length > 0) {
    console.log(
      chalk.dim(
        `Visible (filtered): ${report.totalVisible} [${report.filters.join(", ")}]`
      )
    );
  } else {
    console.log(chalk.dim(`Total visible: ${report.totalVisible}`));
  }

  console.log("");
  console.log(chalk.bold("Scopes"));
  for (const [scope, count] of Object.entries(report.scopes)) {
    console.log(`- ${scope}: ${count}`);
  }

  if (verbose) {
    console.log("");
    console.log(chalk.bold("Tools"));
    for (const [tool, count] of Object.entries(report.tools)) {
      console.log(`- ${tool}: ${count}`);
    }
  }

  console.log("");
  console.log(chalk.bold("Config"));
  console.log(`- skills: ${report.config.skills}`);
  console.log(`- sets: ${report.config.sets}`);
  if (report.config.tools && report.config.tools.length > 0) {
    console.log(`- tools: ${report.config.tools.join(", ")}`);
  }
}

function printStatsRaw(report: StatsReport): void {
  console.log(`total_indexed=${report.totalIndexed}`);
  console.log(`total_visible=${report.totalVisible}`);
  for (const [scope, count] of Object.entries(report.scopes)) {
    console.log(`scope.${scope}=${count}`);
  }
  for (const [tool, count] of Object.entries(report.tools)) {
    console.log(`tool.${tool}=${count}`);
  }
  console.log(`config.skills=${report.config.skills}`);
  console.log(`config.sets=${report.config.sets}`);
  if (report.config.tools && report.config.tools.length > 0) {
    console.log(`config.tools=${report.config.tools.join(",")}`);
  }
  if (report.filters && report.filters.length > 0) {
    console.log(`filters=${report.filters.join(",")}`);
  }
}

/**
 * Build usage statistics report
 */
async function buildUsageStats(
  options: UsageOptions & GlobalOptions
): Promise<UsageStatsReport> {
  // Parse --since duration
  let sinceDate: Date | undefined;
  let period: string | undefined;
  if (options.since) {
    const ms = parseDuration(options.since);
    if (ms === undefined) {
      throw new Error(
        `Invalid duration format: "${options.since}". Use format like "7d", "1w", "30d", or "1m".`
      );
    }
    sinceDate = new Date(Date.now() - ms);
    period = options.since;
  }

  // Read usage log
  const entries = await readUsageLog(sinceDate);

  // Filter to only "load" actions (the primary usage metric)
  // Also apply --source filter if provided
  const loadEntries = entries
    .filter((e) => e.action === "load")
    .filter((e) => matchesSourceFilter(e.skill, options.source));

  // Aggregate by skill
  const usageCounts = aggregateUsageBySkill(loadEntries);

  // Sort by count descending
  const sortedSkills = Array.from(usageCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([skill, count]) => ({ skill, count }));

  // Determine how many to show for --top
  let topLimit: number | undefined;
  if (options.top !== undefined) {
    // --top without value = true, show top 10 by default
    topLimit = options.top === true ? 10 : options.top;
  }

  const topSkills = topLimit ? sortedSkills.slice(0, topLimit) : sortedSkills;

  // Find unused skills if requested
  let unusedSkills: string[] | undefined;
  if (options.unused) {
    const cache = await loadCaches();
    const allSkillRefs = Object.keys(cache.skills);
    const usedSkillRefs = new Set(usageCounts.keys());

    unusedSkills = allSkillRefs
      .filter((ref) => !usedSkillRefs.has(ref))
      .filter((ref) => matchesSourceFilter(ref, options.source));
  }

  return {
    totalLoads: loadEntries.length,
    uniqueSkills: usageCounts.size,
    topSkills,
    ...(unusedSkills !== undefined ? { unusedSkills } : {}),
    ...(period ? { period } : {}),
  };
}

/**
 * Print usage stats in text format
 */
function printUsageStatsText(report: UsageStatsReport): void {
  console.log(chalk.bold("Usage Statistics"));

  if (report.period) {
    console.log(chalk.dim(`Period: last ${report.period}`));
  }

  console.log(chalk.dim(`Total loads: ${report.totalLoads}`));
  console.log(chalk.dim(`Unique skills: ${report.uniqueSkills}`));

  if (report.topSkills.length > 0) {
    console.log("");
    console.log(chalk.bold("Top Skills"));
    for (const { skill, count } of report.topSkills) {
      console.log(`  ${count.toString().padStart(4)}  ${skill}`);
    }
  } else {
    console.log("");
    console.log(chalk.dim("No usage data recorded yet."));
  }

  if (report.unusedSkills !== undefined) {
    console.log("");
    console.log(chalk.bold("Unused Skills"));
    if (report.unusedSkills.length > 0) {
      for (const skill of report.unusedSkills) {
        console.log(`  ${skill}`);
      }
    } else {
      console.log(chalk.dim("  All indexed skills have been used."));
    }
  }
}

/**
 * Print usage stats in raw format
 */
function printUsageStatsRaw(report: UsageStatsReport): void {
  console.log(`total_loads=${report.totalLoads}`);
  console.log(`unique_skills=${report.uniqueSkills}`);
  if (report.period) {
    console.log(`period=${report.period}`);
  }
  for (const { skill, count } of report.topSkills) {
    console.log(`usage.${skill}=${count}`);
  }
  if (report.unusedSkills !== undefined) {
    for (const skill of report.unusedSkills) {
      console.log(`unused.${skill}=true`);
    }
  }
}

/**
 * Handle --clear flag
 */
async function handleClearUsage(
  options: GlobalOptions
): Promise<{ cleared: boolean }> {
  const cleared = await clearUsageLog();
  const format = determineFormat(options);

  if (format === "json") {
    console.log(JSON.stringify({ cleared }));
    return { cleared };
  }

  if (format === "raw") {
    console.log(`cleared=${cleared}`);
    return { cleared };
  }

  if (cleared) {
    console.log(chalk.green("Usage log cleared."));
  } else {
    console.log(chalk.dim("No usage log to clear."));
  }

  return { cleared };
}

/**
 * Check if any usage flags are provided
 */
function hasUsageFlags(options: UsageOptions): boolean {
  return (
    options.top !== undefined ||
    options.unused === true ||
    options.since !== undefined
  );
}

async function statsCommand(
  options: GlobalOptions & UsageOptions
): Promise<void> {
  const format = determineFormat(options);

  // Handle --clear first (exclusive operation)
  if (options.clear) {
    await handleClearUsage(options);
    return;
  }

  // If usage flags are provided, show usage stats
  if (hasUsageFlags(options)) {
    const usageReport = await buildUsageStats(options);

    if (format === "json") {
      console.log(JSON.stringify(usageReport, null, 2));
      return;
    }

    if (format === "raw") {
      printUsageStatsRaw(usageReport);
      return;
    }

    printUsageStatsText(usageReport);
    return;
  }

  // Default: show general stats
  const report = await buildStats(options);

  if (format === "json") {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  if (format === "raw") {
    printStatsRaw(report);
    return;
  }

  printStatsText(report, options.verbose ?? false);
}

/**
 * Parse --top option value
 * Returns true if flag is present without value, number if value provided
 */
function parseTopOption(
  value: string | undefined,
  _previous: unknown
): number | true {
  if (value === undefined) {
    return true;
  }
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed < 1) {
    throw new Error(
      `Invalid --top value: "${value}". Must be a positive integer.`
    );
  }
  return parsed;
}

/**
 * Register the stats command
 */
export function registerStatsCommand(program: Command): void {
  const cmd = program
    .command("stats")
    .description("Show skillset statistics and usage analytics");

  addFilterOptions(addOutputOptions(cmd))
    .option(
      "--top [n]",
      "Show top N most loaded skills (default: 10 if no value)",
      parseTopOption
    )
    .option("--unused", "Show indexed skills that have never been loaded")
    .option(
      "--since <duration>",
      "Filter usage by time period (e.g., 7d, 1w, 30d, 1m)"
    )
    .option("--clear", "Clear/reset the usage log")
    .action(async (_localOpts, command: Command) => {
      const options = command.optsWithGlobals() as GlobalOptions & UsageOptions;
      await statsCommand(options);
    });
}
