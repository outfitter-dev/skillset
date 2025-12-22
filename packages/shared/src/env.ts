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
  if (value === undefined) return fallback;
  return value === "true" || value === "1" || value === "yes";
}
