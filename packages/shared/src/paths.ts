/**
 * XDG-compliant path resolution with macOS fallback
 */

import { homedir } from "node:os";
import { isAbsolute, join, resolve, sep } from "node:path";
import type { Tool } from "@skillset/types";

/**
 * Get XDG config directory for skillset
 * On macOS: ~/.skillset
 * On Linux: $XDG_CONFIG_HOME/skillset or ~/.config/skillset
 */
export function getConfigDir(): string {
  if (process.env.XDG_CONFIG_HOME) {
    return join(process.env.XDG_CONFIG_HOME, "skillset");
  }
  if (process.platform === "darwin") {
    return join(homedir(), ".skillset");
  }
  return join(homedir(), ".config", "skillset");
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
  if (process.env.XDG_DATA_HOME) {
    return join(process.env.XDG_DATA_HOME, "skillset");
  }
  if (process.platform === "darwin") {
    return join(homedir(), ".skillset");
  }
  return join(homedir(), ".local", "share", "skillset");
}

/**
 * Get XDG cache directory for skillset
 * On macOS: ~/.skillset/cache
 * On Linux: $XDG_CACHE_HOME/skillset or ~/.cache/skillset
 */
export function getCacheDir(): string {
  if (process.env.XDG_CACHE_HOME) {
    return join(process.env.XDG_CACHE_HOME, "skillset");
  }
  if (process.platform === "darwin") {
    return join(homedir(), ".skillset", "cache");
  }
  return join(homedir(), ".cache", "skillset");
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

function isWithinPath(path: string, root: string): boolean {
  return path === root || path.startsWith(`${root}${sep}`);
}

/**
 * Infer the tool based on a skill path.
 */
export function inferToolFromPath(
  path: string,
  projectRoot?: string
): Tool | undefined {
  const root = projectRoot ?? getProjectRoot();
  const resolvedPath = isAbsolute(path) ? path : resolve(root, path);

  for (const [tool, paths] of Object.entries(SKILL_PATHS)) {
    const projectPath = resolve(paths.project(root));
    if (isWithinPath(resolvedPath, projectPath)) {
      return tool as Tool;
    }
    const userPath = resolve(paths.user());
    if (isWithinPath(resolvedPath, userPath)) {
      return tool as Tool;
    }
  }

  return undefined;
}

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
