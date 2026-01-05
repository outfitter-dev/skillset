/**
 * skillset sync command
 */

import { indexSkills } from "@skillset/core";
import { SKILL_PATHS } from "@skillset/shared";
import chalk from "chalk";
import type { Command } from "commander";
import { CLIError } from "../errors";
import type { GlobalOptions } from "../types";

interface SyncOptions extends GlobalOptions {
  target?: string;
  dryRun?: boolean;
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
  const invalid = requested.filter(
    (entry) => !VALID_TARGETS.includes(entry)
  );
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
  const targets = parseTargets(options.target);
  const cache = await indexSkills({
    tools: targets ?? undefined,
    writeCache: !options.dryRun,
  });
  const count = Object.keys(cache.skills).length;
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
  program
    .command("sync")
    .description("Sync skills to configured targets")
    .option("--target <name>", "Sync to specific target (claude, codex, etc.)")
    .option("--dry-run", "Show what would be synced without making changes")
    .action(async (options: SyncOptions) => {
      await syncSkills(options);
    });
}
