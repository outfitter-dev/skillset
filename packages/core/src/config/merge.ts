import type { ConfigSchema } from "@skillset/types";

export function mergeConfigs(
  base: ConfigSchema,
  overlay: Partial<ConfigSchema>
): ConfigSchema {
  const merged: ConfigSchema = {
    ...base,
    // Scalars: replace
    version: overlay.version ?? base.version,

    // Shallow merge objects
    rules: { ...base.rules, ...overlay.rules },
    output: { ...base.output, ...overlay.output },
    resolution: { ...base.resolution, ...overlay.resolution },

    // Maps: key-level merge
    skills: { ...base.skills, ...overlay.skills },
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
