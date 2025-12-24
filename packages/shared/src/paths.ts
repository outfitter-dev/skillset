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
 * Skill source paths by tool
 */
export const SKILL_PATHS = {
  claude: {
    project: (root: string) => join(root, ".claude", "skills"),
    user: () => join(homedir(), ".claude", "skills"),
  },
  codex: {
    project: (root: string) => join(root, ".codex", "skills"),
    user: () =>
      process.env.CODEX_HOME
        ? join(process.env.CODEX_HOME, "skills")
        : join(homedir(), ".codex", "skills"),
  },
  copilot: {
    project: (root: string) => join(root, ".github", "skills"),
    user: () => join(homedir(), ".github", "skills"),
  },
  cursor: {
    project: (root: string) => join(root, ".cursor", "skills"),
    user: () => join(homedir(), ".cursor", "skills"),
  },
  amp: {
    project: (root: string) => join(root, ".amp", "skills"),
    user: () => join(homedir(), ".amp", "skills"),
  },
  goose: {
    project: (root: string) => join(root, ".goose", "skills"),
    user: () => join(homedir(), ".goose", "skills"),
  },
} as const;

export type ToolName = keyof typeof SKILL_PATHS;

/**
 * Get all skill paths for a given scope
 */
export function getSkillPaths(
  scope: "project" | "user",
  projectRoot?: string
): Record<ToolName, string> {
  const result: Record<string, string> = {};
  for (const [tool, paths] of Object.entries(SKILL_PATHS)) {
    result[tool] =
      scope === "project" && projectRoot
        ? paths.project(projectRoot)
        : paths.user();
  }
  return result as Record<ToolName, string>;
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
