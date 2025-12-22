/**
 * @skillset/shared - Shared utilities for skillset
 */

// Logger (Pino)
export { logger, createLogger } from "./logger";

// XDG Paths
export {
  getConfigDir,
  getDataDir,
  getCacheDir,
  getSkillsetPaths,
} from "./paths";

// Environment
export {
  getEnv,
  getEnvBool,
  SKILLSET_ENV,
} from "./env";
