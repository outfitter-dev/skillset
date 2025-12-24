import type { ConfigSchema } from "@skillset/types";

export function mergeConfigs(
  base: ConfigSchema,
  overlay: Partial<ConfigSchema>
): ConfigSchema {
  return {
    ...base,
    // Scalars: replace
    version: overlay.version ?? base.version,

    // Shallow merge objects
    rules: { ...base.rules, ...overlay.rules },
    output: { ...base.output, ...overlay.output },
    resolution: { ...base.resolution, ...overlay.resolution },

    // Arrays: replace entirely if present
    ignore_scopes: overlay.ignore_scopes ?? base.ignore_scopes,
    tools: overlay.tools ?? base.tools,

    // Maps: key-level merge
    skills: { ...base.skills, ...overlay.skills },
    sets: overlay.sets ? { ...(base.sets ?? {}), ...overlay.sets } : base.sets,
  };
}
