/**
 * CLI option group utilities
 *
 * Provides helpers to apply consistent option groups to commands,
 * ensuring options work in both positions:
 * - `skillset --json sync` (global before subcommand)
 * - `skillset sync --json` (option after subcommand)
 */

import type { Command } from "commander";

/**
 * Add universal output options to a command.
 * These options apply to all commands that produce output.
 */
export function addOutputOptions(cmd: Command): Command {
  return cmd
    .option("--json", "JSON output")
    .option("--raw", "Raw output for piping")
    .option("-q, --quiet", "Suppress non-essential output")
    .option("-v, --verbose", "Extra detail");
}

/**
 * Add filter options for commands that list/search skills.
 */
export function addFilterOptions(cmd: Command): Command {
  return cmd.option("-s, --source <sources...>", "Filter by source(s)");
}
