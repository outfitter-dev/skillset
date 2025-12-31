import type { Result } from "@skillset/types";
import { ConfigError, err, ok } from "@skillset/types";
import type { z } from "zod";
import {
  ConfigSchema,
  GeneratedSettingsSchema,
  ProjectSettingsSchema,
} from "./schema";

/**
 * Validate config data against the ConfigSchema
 */
export function validateConfig(
  data: unknown
): Result<z.infer<typeof ConfigSchema>, ConfigError> {
  const result = ConfigSchema.safeParse(data);

  if (result.success) {
    return ok(result.data);
  }

  const issues = result.error.issues
    .map((i) => `${i.path.join(".")}: ${i.message}`)
    .join("; ");

  return err(
    new ConfigError(`Invalid config: ${issues}`, {
      issues: result.error.issues,
    })
  );
}

/**
 * Validate generated settings data
 */
export function validateGeneratedSettings(
  data: unknown
): Result<z.infer<typeof GeneratedSettingsSchema>, ConfigError> {
  const result = GeneratedSettingsSchema.safeParse(data);

  if (result.success) {
    return ok(result.data);
  }

  const issues = result.error.issues
    .map((i) => `${i.path.join(".")}: ${i.message}`)
    .join("; ");

  return err(
    new ConfigError(`Invalid generated settings: ${issues}`, {
      issues: result.error.issues,
    })
  );
}

/**
 * Validate project settings data
 */
export function validateProjectSettings(
  data: unknown
): Result<z.infer<typeof ProjectSettingsSchema>, ConfigError> {
  const result = ProjectSettingsSchema.safeParse(data);

  if (result.success) {
    return ok(result.data);
  }

  const issues = result.error.issues
    .map((i) => `${i.path.join(".")}: ${i.message}`)
    .join("; ");

  return err(
    new ConfigError(`Invalid project settings: ${issues}`, {
      issues: result.error.issues,
    })
  );
}
