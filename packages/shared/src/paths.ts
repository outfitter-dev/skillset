/**
 * XDG-compliant path resolution with macOS fallback
 */

import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Get XDG config directory for skillset
 * On macOS: ~/.skillset
 * On Linux: $XDG_CONFIG_HOME/skillset or ~/.config/skillset
 */
export function getConfigDir(): string {
  return process.env.XDG_CONFIG_HOME
    ? join(process.env.XDG_CONFIG_HOME, "skillset")
    : process.platform === "darwin"
      ? join(homedir(), ".skillset")
      : join(homedir(), ".config", "skillset");
}

/**
 * Get project root (override with SKILLSET_PROJECT_ROOT)
 */
export function getProjectRoot(): string {
  return process.env.SKILLSET_PROJECT_ROOT ?? process.cwd();
}

/**
 * Get XDG data directory for skillset
 * On macOS: ~/.skillset
 * On Linux: $XDG_DATA_HOME/skillset or ~/.local/share/skillset
 */
export function getDataDir(): string {
  return process.env.XDG_DATA_HOME
    ? join(process.env.XDG_DATA_HOME, "skillset")
    : process.platform === "darwin"
      ? join(homedir(), ".skillset")
      : join(homedir(), ".local", "share", "skillset");
}

/**
 * Get XDG cache directory for skillset
 * On macOS: ~/.skillset/cache
 * On Linux: $XDG_CACHE_HOME/skillset or ~/.cache/skillset
 */
export function getCacheDir(): string {
  return process.env.XDG_CACHE_HOME
    ? join(process.env.XDG_CACHE_HOME, "skillset")
    : process.platform === "darwin"
      ? join(homedir(), ".skillset", "cache")
      : join(homedir(), ".cache", "skillset");
}

/**
 * Get all skillset paths
 */
export function getSkillsetPaths() {
  return {
    config: getConfigDir(),
    data: getDataDir(),
    cache: getCacheDir(),
    logs: join(getDataDir(), "logs"),
  };
}
