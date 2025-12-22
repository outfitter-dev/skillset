/**
 * Pino logger setup for skillset
 */

import pino from "pino";
import { getEnv, getEnvBool, SKILLSET_ENV } from "./env";

/**
 * Create a Pino logger instance with optional pretty printing
 */
export function createLogger(
  options: { level?: string; name?: string; pretty?: boolean } = {}
) {
  const {
    level = getEnv(SKILLSET_ENV.LOG_LEVEL, "info"),
    name = "skillset",
    pretty = getEnvBool(SKILLSET_ENV.DEBUG, false),
  } = options;

  const transport =
    pretty && !getEnvBool(SKILLSET_ENV.NO_COLOR, false)
      ? pino.transport({
          target: "pino-pretty",
          options: {
            colorize: true,
            translateTime: "HH:MM:ss",
            ignore: "pid,hostname",
          },
        })
      : undefined;

  return pino(
    {
      name,
      level,
    },
    transport
  );
}

/**
 * Default logger instance
 */
export const logger = createLogger();
