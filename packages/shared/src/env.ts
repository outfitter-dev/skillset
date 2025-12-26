/**
 * Environment variable helpers
 */

/**
 * Skillset environment variables
 */
export const SKILLSET_ENV = {
  DEBUG: "SKILLSET_DEBUG",
  LOG_LEVEL: "SKILLSET_LOG_LEVEL",
  NO_COLOR: "NO_COLOR",
  SOURCE: "SKILLSET_SOURCE",
  OUTPUT: "SKILLSET_OUTPUT",
  CONFIG: "SKILLSET_CONFIG",
  KIND: "SKILLSET_KIND",
  PROJECT_ROOT: "SKILLSET_PROJECT_ROOT",
} as const;

/**
 * Get environment variable with fallback
 */
export function getEnv(key: string, fallback = ""): string {
  return process.env[key] ?? fallback;
}

/**
 * Get boolean environment variable
 */
export function getEnvBool(key: string, fallback = false): boolean {
  const value = process.env[key];
  if (value === undefined) {
    return fallback;
  }
  return value === "true" || value === "1" || value === "yes";
}

/**
 * Parsed CLI environment variables for easy access
 */
export interface SkillsetEnvConfig {
  source?: string;
  output?: "json" | "raw" | "text";
  config?: string;
  kind?: "skill" | "set";
  projectRoot?: string;
  noColor: boolean;
}

/**
 * Get parsed skillset environment configuration
 */
export function getSkillsetEnv(): SkillsetEnvConfig {
  const output = process.env.SKILLSET_OUTPUT;
  const kind = process.env.SKILLSET_KIND;

  return {
    source: process.env.SKILLSET_SOURCE,
    output:
      output === "json" || output === "raw" || output === "text"
        ? output
        : undefined,
    config: process.env.SKILLSET_CONFIG,
    kind: kind === "skill" || kind === "set" ? kind : undefined,
    projectRoot: process.env.SKILLSET_PROJECT_ROOT,
    noColor: process.env.NO_COLOR === "1",
  };
}
