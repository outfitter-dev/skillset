/**
 * Output format utilities
 */

import { getSkillsetEnv } from "@skillset/shared";
import type { OutputFormat } from "../types";
import { isTTY } from "./tty";

/**
 * Determine output format from command options and environment
 */
export function determineFormat(options: {
  json?: boolean;
  raw?: boolean;
  quiet?: boolean;
}): OutputFormat {
  // Check environment variables
  const env = getSkillsetEnv();

  // Explicit flags take precedence
  if (options.json) return "json";
  if (options.raw) return "raw";

  // Environment variable
  if (env.output) return env.output;

  // Default: text in TTY, raw otherwise
  return isTTY() ? "text" : "raw";
}
