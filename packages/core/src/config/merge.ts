import type { ConfigSchema } from "@skillset/types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function mergeConfigs(
  base: ConfigSchema,
  overlay: Partial<ConfigSchema>
): ConfigSchema {
  const overlayRules = isRecord(overlay.rules) ? overlay.rules : undefined;
  const overlayOutput = isRecord(overlay.output) ? overlay.output : undefined;
  const overlayResolution = isRecord(overlay.resolution)
    ? overlay.resolution
    : undefined;
  const overlaySkills = isRecord(overlay.skills) ? overlay.skills : undefined;

  const baseResolution = isRecord(base.resolution) ? base.resolution : {};
  const mergedResolution =
    overlayResolution || Object.keys(baseResolution).length > 0
      ? { ...baseResolution, ...(overlayResolution ?? {}) }
      : undefined;

  const merged: ConfigSchema = {
    ...base,
    // Scalars: replace
    version: overlay.version ?? base.version,

    // Shallow merge objects
    rules: { ...base.rules, ...(overlayRules ?? {}) },
    output: { ...base.output, ...(overlayOutput ?? {}) },
    resolution: mergedResolution,

    // Maps: key-level merge
    skills: { ...base.skills, ...(overlaySkills ?? {}) },
  };

  if (overlay.ignore_scopes !== undefined) {
    merged.ignore_scopes = overlay.ignore_scopes;
  } else if (base.ignore_scopes !== undefined) {
    merged.ignore_scopes = base.ignore_scopes;
  }

  if (overlay.tools !== undefined) {
    merged.tools = overlay.tools;
  } else if (base.tools !== undefined) {
    merged.tools = base.tools;
  }

  if (overlay.sets !== undefined) {
    merged.sets = { ...(base.sets ?? {}), ...overlay.sets };
  } else if (base.sets !== undefined) {
    merged.sets = base.sets;
  }

  return merged;
}
