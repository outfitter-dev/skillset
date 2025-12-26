/**
 * Usage statistics logging
 */

import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { getSkillsetPaths } from "./paths";

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
export function logUsage(entry: Omit<UsageEntry, "timestamp">): void {
  try {
    const paths = getSkillsetPaths();
    const logDir = paths.logs;
    const logFile = join(logDir, "usage.jsonl");

    // Ensure log directory exists
    if (!existsSync(logDir)) {
      mkdirSync(logDir, { recursive: true });
    }

    // Create the log entry
    const record: UsageEntry = {
      timestamp: new Date().toISOString(),
      ...entry,
    };

    // Append to log file
    appendFileSync(logFile, `${JSON.stringify(record)}\n`);
  } catch {
    // Silently fail - logging should never break the main flow
  }
}
