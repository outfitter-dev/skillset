/**
 * Legacy path detection and migration utilities
 */

import { existsSync, mkdirSync, cpSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { getConfigDir, getDataDir, getCacheDir } from "./paths";

export interface LegacyPaths {
  hasLegacyUser: boolean;
  hasLegacyProject: boolean;
  userPath?: string;
  projectPath?: string;
}

/**
 * Detect legacy .claude/wskill paths
 */
export function detectLegacyPaths(): LegacyPaths {
  const home = homedir();
  const cwd = process.cwd();

  const legacy = {
    user: join(home, ".claude", "wskill"),
    project: join(cwd, ".claude", "wskill"),
  };

  return {
    hasLegacyUser: existsSync(legacy.user),
    hasLegacyProject: existsSync(legacy.project),
    userPath: legacy.user,
    projectPath: legacy.project,
  };
}

/**
 * Migrate legacy user-level paths to XDG-compliant locations
 */
export function migrateLegacyUserPaths(legacyPath: string): {
  success: boolean;
  error?: string;
} {
  try {
    const configDir = getConfigDir();
    const dataDir = getDataDir();
    const cacheDir = getCacheDir();

    // Create target directories
    mkdirSync(configDir, { recursive: true });
    mkdirSync(dataDir, { recursive: true });
    mkdirSync(cacheDir, { recursive: true });

    // Migrate config.json
    const legacyConfig = join(legacyPath, "config.json");
    if (existsSync(legacyConfig)) {
      cpSync(legacyConfig, join(configDir, "config.json"), { force: false });
    }

    // Migrate cache.json
    const legacyCache = join(legacyPath, "cache.json");
    if (existsSync(legacyCache)) {
      cpSync(legacyCache, join(cacheDir, "cache.json"), { force: false });
    }

    // Migrate logs/ directory
    const legacyLogs = join(legacyPath, "logs");
    if (existsSync(legacyLogs)) {
      cpSync(legacyLogs, join(dataDir, "logs"), { recursive: true, force: false });
    }

    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Migrate legacy project-level paths to .skillset/
 */
export function migrateLegacyProjectPaths(legacyPath: string): {
  success: boolean;
  error?: string;
} {
  try {
    const targetPath = join(process.cwd(), ".skillset");

    // Create target directory
    mkdirSync(targetPath, { recursive: true });

    // Migrate config.json
    const legacyConfig = join(legacyPath, "config.json");
    if (existsSync(legacyConfig)) {
      cpSync(legacyConfig, join(targetPath, "config.json"), { force: false });
    }

    // Migrate config.local.json
    const legacyLocalConfig = join(legacyPath, "config.local.json");
    if (existsSync(legacyLocalConfig)) {
      cpSync(legacyLocalConfig, join(targetPath, "config.local.json"), {
        force: false,
      });
    }

    // Migrate cache.json
    const legacyCache = join(legacyPath, "cache.json");
    if (existsSync(legacyCache)) {
      cpSync(legacyCache, join(targetPath, "cache.json"), { force: false });
    }

    // Migrate logs/ directory if present
    const legacyLogs = join(legacyPath, "logs");
    if (existsSync(legacyLogs)) {
      cpSync(legacyLogs, join(targetPath, "logs"), {
        recursive: true,
        force: false,
      });
    }

    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Remove legacy paths after successful migration
 */
export function removeLegacyPaths(paths: { user?: string; project?: string }): {
  success: boolean;
  error?: string;
} {
  try {
    if (paths.user && existsSync(paths.user)) {
      rmSync(paths.user, { recursive: true, force: true });
    }
    if (paths.project && existsSync(paths.project)) {
      rmSync(paths.project, { recursive: true, force: true });
    }
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
