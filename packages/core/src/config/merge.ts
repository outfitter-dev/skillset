import type { ConfigSchema } from "@skillset/types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function recordOrUndefined<T extends Record<string, unknown>>(
  value: T | undefined
): T | undefined {
  return isRecord(value) ? (value as T) : undefined;
}

function pickOptional<T>(
  overlay: T | undefined,
  base: T | undefined
): T | undefined {
  return overlay !== undefined ? overlay : base;
}

function mergeOptionalRecord<T extends Record<string, unknown>>(
  base: T | undefined,
  overlay: T | undefined
): T | undefined {
  if (overlay !== undefined) {
    return { ...(base ?? {}), ...overlay };
  }
  return base;
}

export function mergeConfigs(
  base: ConfigSchema,
  overlay: Partial<ConfigSchema>
): ConfigSchema {
  const overlayRules = recordOrUndefined<ConfigSchema["rules"]>(overlay.rules);
  const overlayOutput = recordOrUndefined<ConfigSchema["output"]>(
    overlay.output
  );
  const overlayResolution = recordOrUndefined<
    NonNullable<ConfigSchema["resolution"]>
  >(overlay.resolution);
  const overlaySkills = recordOrUndefined<ConfigSchema["skills"]>(
    overlay.skills
  );

  const baseResolution =
    recordOrUndefined<NonNullable<ConfigSchema["resolution"]>>(
      base.resolution
    ) ?? {};
  const mergedResolution =
    overlayResolution || Object.keys(baseResolution).length > 0
      ? { ...baseResolution, ...(overlayResolution ?? {}) }
      : undefined;

  const mergedIgnoreScopes = pickOptional(
    overlay.ignore_scopes,
    base.ignore_scopes
  );
  const mergedTools = pickOptional(overlay.tools, base.tools);
  const mergedSets = mergeOptionalRecord(base.sets, overlay.sets);

  const merged: ConfigSchema = {
    ...base,
    // Scalars: replace
    version: overlay.version ?? base.version,

    // Shallow merge objects
    rules: { ...base.rules, ...(overlayRules ?? {}) },
    output: { ...base.output, ...(overlayOutput ?? {}) },

    // Maps: key-level merge
    skills: { ...base.skills, ...(overlaySkills ?? {}) },
    ...(mergedResolution ? { resolution: mergedResolution } : {}),
    ...(mergedIgnoreScopes !== undefined
      ? { ignore_scopes: mergedIgnoreScopes }
      : {}),
    ...(mergedTools !== undefined ? { tools: mergedTools } : {}),
    ...(mergedSets !== undefined ? { sets: mergedSets } : {}),
  };

  return merged;
}
