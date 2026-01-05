import { z } from "zod";

/**
 * Supported tools for compatibility filtering
 */
export const ToolSchema = z.enum([
  "claude",
  "codex",
  "copilot",
  "cursor",
  "amp",
  "goose",
]);

/**
 * Skill resolution scopes
 */
export const ScopeSchema = z.enum(["project", "user", "plugin"]);

/**
 * Rule severity levels
 */
export const RuleSeveritySchema = z.enum(["ignore", "warn", "error"]);

/**
 * Project ID strategy for generated config
 */
export const ProjectIdStrategySchema = z.enum(["path", "remote"]);

/**
 * Skill entry - string shorthand or object with overrides
 */
export const SkillEntrySchema = z.union([
  z.string(),
  z.object({
    /** Skill name (mutually exclusive with path) */
    skill: z.string().optional(),
    /** Explicit file path (mutually exclusive with skill) */
    path: z.string().optional(),
    /** Resolution scope or priority order */
    scope: z.union([ScopeSchema, z.array(ScopeSchema)]).optional(),
    /** Ignore max_lines, include entire file */
    include_full: z.boolean().optional(),
    /** Override output.include_layout for this skill */
    include_layout: z.boolean().optional(),
  }),
]);

/**
 * Set definition
 */
export const SetDefinitionSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  /** Skill aliases (references keys from skills section) */
  skills: z.array(z.string()),
});

/**
 * Main configuration schema
 */
export const ConfigSchema = z.object({
  version: z.number(),

  /**
   * Rule behaviors for resolution issues
   */
  rules: z.object({
    /** What to do when a $alias cannot be resolved */
    unresolved: RuleSeveritySchema,
    /** What to do when multiple skills match an alias */
    ambiguous: RuleSeveritySchema,
    /** What to do when a set is missing members */
    missing_set_members: RuleSeveritySchema.optional(),
  }),

  /**
   * Skill resolution settings
   */
  resolution: z
    .object({
      /** Enable fuzzy matching when exact match not found (default: true) */
      fuzzy_matching: z.boolean().optional(),
      /** Default scope priority when not specified */
      default_scope_priority: z.array(ScopeSchema).optional(),
    })
    .optional(),

  /**
   * Output formatting settings
   */
  output: z.object({
    /** Maximum lines per skill (default: 500) */
    max_lines: z.number(),
    /** Include layout/structure info (default: false) */
    include_layout: z.boolean(),
  }),

  /**
   * Scopes to ignore at project level
   */
  ignore_scopes: z.array(ScopeSchema).optional(),

  /**
   * Only include skills compatible with these tools
   */
  tools: z.array(ToolSchema).optional(),

  /**
   * Skill alias definitions
   */
  skills: z.record(z.string(), SkillEntrySchema),

  /**
   * Named sets of skills
   */
  sets: z.record(z.string(), SetDefinitionSchema).optional(),
});

/**
 * Per-project settings in generated file
 */
export const ProjectSettingsSchema = z.object({
  _yaml_hashes: z.record(z.string(), z.string()),
  skills: z.record(z.string(), SkillEntrySchema).optional(),
  output: z
    .object({
      max_lines: z.number().optional(),
      include_layout: z.boolean().optional(),
    })
    .optional(),
  rules: z
    .object({
      unresolved: RuleSeveritySchema.optional(),
      ambiguous: RuleSeveritySchema.optional(),
    })
    .optional(),
  ignore_scopes: z.array(ScopeSchema).optional(),
  tools: z.array(ToolSchema).optional(),
});

/**
 * CLI-generated settings file schema
 */
export const GeneratedSettingsSchema = z.object({
  /** Hashes of YAML values when CLI set overrides */
  _yaml_hashes: z.record(z.string(), z.string()),

  /** Global CLI overrides */
  skills: z.record(z.string(), SkillEntrySchema).optional(),
  output: z
    .object({
      max_lines: z.number().optional(),
      include_layout: z.boolean().optional(),
    })
    .optional(),
  rules: z
    .object({
      unresolved: RuleSeveritySchema.optional(),
      ambiguous: RuleSeveritySchema.optional(),
    })
    .optional(),

  /** Project ID strategy */
  project_id_strategy: ProjectIdStrategySchema.optional(),

  /** Per-project CLI overrides, keyed by project id */
  projects: z.record(z.string(), ProjectSettingsSchema),
});
