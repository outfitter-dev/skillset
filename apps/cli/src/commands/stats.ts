/**
 * skillset stats command
 */

import { loadCaches, loadConfig } from "@skillset/core";
import { inferToolFromPath } from "@skillset/shared";
import chalk from "chalk";
import type { Command } from "commander";
import type { GlobalOptions, OutputFormat } from "../types";
import { determineFormat } from "../utils/format";

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

  const report: StatsReport = {
    totalIndexed: allSkills.length,
    totalVisible: visibleSkills.length,
    scopes,
    tools,
    config: {
      skills: Object.keys(config.skills).length,
      sets: Object.keys(config.sets ?? {}).length,
      tools: config.tools,
    },
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

async function statsCommand(options: GlobalOptions): Promise<void> {
  const format = determineFormat(options);
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
 * Register the stats command
 */
export function registerStatsCommand(program: Command): void {
  program
    .command("stats")
    .description("Show skillset statistics")
    .action(async (options: GlobalOptions) => {
      await statsCommand(options);
    });
}
