/**
 * @skillset/shared - Shared utilities for skillset
 */

// Environment
export {
  getEnv,
  getEnvBool,
  getSkillsetEnv,
  SKILLSET_ENV,
  type SkillsetEnvConfig,
} from "./env";
// Logger (Pino)
export { createLogger, logger } from "./logger";
// Migration
export {
  detectLegacyPaths,
  type LegacyPaths,
  migrateLegacyProjectPaths,
  migrateLegacyUserPaths,
  removeLegacyPaths,
} from "./migration";
// XDG Paths
export {
  getCacheDir,
  getConfigDir,
  getDataDir,
  getProjectRoot,
  getSkillsetPaths,
} from "./paths";
// Usage Statistics
export {
  logUsage,
  type UsageEntry,
} from "./stats";
