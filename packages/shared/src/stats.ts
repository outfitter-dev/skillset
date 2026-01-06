/**
 * Usage statistics logging
 */

import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getSkillsetPaths } from "./paths";

/**
 * Duration unit multipliers in milliseconds
 */
const DURATION_UNITS: Record<string, number> = {
  d: 24 * 60 * 60 * 1000, // day
  w: 7 * 24 * 60 * 60 * 1000, // week
  m: 30 * 24 * 60 * 60 * 1000, // month (30 days)
};

/**
 * Regex for parsing duration strings (e.g., "7d", "1w", "30d", "1m")
 */
const DURATION_REGEX = /^(\d+)([dwm])$/i;

/**
 * Usage entry schema
 */
export interface UsageEntry {
  timestamp: string; // ISO 8601
  action: "load" | "resolve" | "inject";
  skill: string; // Fully qualified skill ref
  source: "cli" | "hook" | "inject" | "mcp";
  duration_ms?: number; // Optional: operation duration
}

/**
 * Log a usage entry to the JSONL log file
 */
export async function logUsage(
  entry: Omit<UsageEntry, "timestamp">
): Promise<void> {
  try {
    const paths = getSkillsetPaths();
    const logDir = paths.logs;
    const logFile = join(logDir, "usage.jsonl");

    // Ensure log directory exists
    await mkdir(logDir, { recursive: true });

    // Create the log entry
    const record: UsageEntry = {
      timestamp: new Date().toISOString(),
      ...entry,
    };

    // Append to log file
    await appendFile(logFile, `${JSON.stringify(record)}\n`);
  } catch {
    // Silently fail - logging should never break the main flow
  }
}

/**
 * Parse a duration string into milliseconds
 * Supports: "7d" (7 days), "1w" (1 week), "30d" (30 days), "1m" (1 month)
 * @returns milliseconds or undefined if invalid format
 */
export function parseDuration(duration: string): number | undefined {
  const match = duration.match(DURATION_REGEX);
  if (!match) {
    return undefined;
  }

  const value = Number.parseInt(match[1] ?? "0", 10);
  const unit = (match[2] ?? "d").toLowerCase();
  const multiplier = DURATION_UNITS[unit];

  if (multiplier === undefined) {
    return undefined;
  }

  return value * multiplier;
}

/**
 * Get the path to the usage log file
 */
export function getUsageLogPath(): string {
  const paths = getSkillsetPaths();
  return join(paths.logs, "usage.jsonl");
}

/**
 * Read and parse the usage log file
 * @param since Optional: only return entries after this date
 * @returns Array of usage entries, empty array if file doesn't exist
 */
export async function readUsageLog(since?: Date): Promise<UsageEntry[]> {
  const logFile = getUsageLogPath();

  try {
    const content = await readFile(logFile, "utf-8");
    const lines = content.trim().split("\n").filter(Boolean);
    const entries: UsageEntry[] = [];

    for (const line of lines) {
      try {
        const entry = JSON.parse(line) as UsageEntry;
        // Filter by since date if provided
        if (since) {
          const entryDate = new Date(entry.timestamp);
          if (entryDate < since) {
            continue;
          }
        }
        entries.push(entry);
      } catch {
        // Skip malformed lines
      }
    }

    return entries;
  } catch (error) {
    // File doesn't exist or can't be read
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

/**
 * Clear the usage log file
 * @returns true if cleared successfully, false if file didn't exist
 */
export async function clearUsageLog(): Promise<boolean> {
  const logFile = getUsageLogPath();

  try {
    // Use writeFile with empty content to truncate, preserving the file
    await writeFile(logFile, "");
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

/**
 * Get usage statistics aggregated by skill
 * @param entries Array of usage entries
 * @returns Map of skill refs to usage counts
 */
export function aggregateUsageBySkill(
  entries: UsageEntry[]
): Map<string, number> {
  const counts = new Map<string, number>();

  for (const entry of entries) {
    const current = counts.get(entry.skill) ?? 0;
    counts.set(entry.skill, current + 1);
  }

  return counts;
}
