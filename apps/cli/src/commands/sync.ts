/**
 * skillset sync command
 */

import { indexSkills } from "@skillset/core";
import { SKILL_PATHS } from "@skillset/shared";
import chalk from "chalk";
import type { Command } from "commander";
import { CLIError } from "../errors";
import type { GlobalOptions } from "../types";
import { determineFormat } from "../utils/format";
import { addOutputOptions } from "../utils/options";

interface SyncOptions extends GlobalOptions {
  target?: string;
  dryRun?: boolean;
}

interface SyncResult {
  skillCount: number;
  targets: string[] | null;
  dryRun: boolean;
}

/**
 * Sync skills to configured targets
 * TODO: Full implementation deferred to later phase
 */
const VALID_TARGETS = Object.keys(SKILL_PATHS);

function parseTargets(target?: string): Array<keyof typeof SKILL_PATHS> | null {
  if (!target) {
    return null;
  }
  const requested = target
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  const invalid = requested.filter((entry) => !VALID_TARGETS.includes(entry));
  if (invalid.length > 0) {
    console.error(chalk.red(`Unknown target(s): ${invalid.join(", ")}`));
    console.error(
      chalk.yellow(`Supported targets: ${VALID_TARGETS.join(", ")}`)
    );
    throw new CLIError(`Unknown target(s): ${invalid.join(", ")}`, {
      alreadyLogged: true,
    });
  }
  return requested as Array<keyof typeof SKILL_PATHS>;
}

async function syncSkills(options: SyncOptions): Promise<void> {
  const format = determineFormat(options);
  const targets = parseTargets(options.target);
  const indexOptions: Parameters<typeof indexSkills>[0] = {
    writeCache: !options.dryRun,
  };
  if (targets) {
    indexOptions.tools = targets;
  }
  const cache = await indexSkills(indexOptions);
  const count = Object.keys(cache.skills).length;

  const result: SyncResult = {
    skillCount: count,
    targets,
    dryRun: options.dryRun ?? false,
  };

  if (format === "json") {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (format === "raw") {
    console.log(`skillCount=${count}`);
    if (targets) {
      console.log(`targets=${targets.join(",")}`);
    }
    console.log(`dryRun=${result.dryRun}`);
    return;
  }

  const targetLabel = targets ? ` (${targets.join(", ")})` : "";
  console.log(chalk.green(`Synced ${count} skills${targetLabel}`));
  if (options.dryRun) {
    console.log(chalk.dim("Dry run: cache was not updated"));
  }
}

/**
 * Register the sync command
 */
export function registerSyncCommand(program: Command): void {
  const cmd = program
    .command("sync")
    .description("Sync skills to configured targets")
    .option("--target <name>", "Sync to specific target (claude, codex, etc.)")
    .option("--dry-run", "Show what would be synced without making changes");

  addOutputOptions(cmd).action(async (_localOpts, command: Command) => {
    const options = command.optsWithGlobals() as SyncOptions;
    await syncSkills(options);
  });
}
