/**
 * Configuration types
 */

import type { Skill, SkillSet } from "./skill";

/**
 * Supported tools for compatibility filtering
 */
export type Tool = "claude" | "codex" | "copilot" | "cursor" | "amp" | "goose";

/**
 * Skill resolution scopes
 */
export type Scope = "project" | "user" | "plugin";

/**
 * Rule severity levels
 */
export type RuleSeverity = "ignore" | "warn" | "error";

/**
 * Project ID strategy for generated config
 */
export type ProjectIdStrategy = "path" | "remote";

/**
 * Skill entry - string shorthand or object with overrides
 */
export type SkillEntry =
  | string
  | {
      /** Skill name (mutually exclusive with path) */
      skill?: string;
      /** Explicit file path (mutually exclusive with skill) */
      path?: string;
      /** Resolution scope or priority order */
      scope?: Scope | Scope[];
      /** Ignore max_lines, include entire file */
      include_full?: boolean;
      /** Override output.include_layout for this skill */
      include_layout?: boolean;
    };

/**
 * Set of skills that can be invoked together
 */
export interface SetDefinition {
  name: string;
  description?: string;
  /** Skill aliases (references keys from skills section) */
  skills: string[];
}

/**
 * Main configuration schema
 */
export interface ConfigSchema {
  version: number;

  /**
   * Rule behaviors for resolution issues
   */
  rules: {
    /** What to do when a $alias cannot be resolved */
    unresolved: RuleSeverity;
    /** What to do when multiple skills match an alias */
    ambiguous: RuleSeverity;
    /** What to do when a set is missing one or more members */
    missing_set_members?: RuleSeverity;
  };

  /**
   * Skill resolution settings
   */
  resolution?: {
    /** Enable fuzzy matching when exact match not found (default: true) */
    fuzzy_matching?: boolean;
    /** Default scope priority when not specified */
    default_scope_priority?: Scope[];
  };

  /**
   * Output formatting settings
   */
  output: {
    /** Maximum lines per skill (default: 500) */
    max_lines: number;
    /** Include layout/structure info (default: false) */
    include_layout: boolean;
  };

  /**
   * Scopes to ignore at project level
   */
  ignore_scopes?: Scope[];

  /**
   * Only include skills compatible with these tools
   */
  tools?: Tool[];

  /**
   * Skill alias definitions
   */
  skills: Record<string, SkillEntry>;

  /**
   * Named sets of skills
   */
  sets?: Record<string, SetDefinition>;
}

/**
 * CLI-generated settings file schema
 */
export interface GeneratedSettingsSchema {
  /** Hashes of YAML values when CLI set overrides */
  _yaml_hashes: Record<string, string>;

  /** Global CLI overrides */
  skills?: Record<string, SkillEntry>;
  output?: Partial<ConfigSchema["output"]>;
  rules?: Partial<ConfigSchema["rules"]>;

  /** Project ID strategy */
  project_id_strategy?: ProjectIdStrategy;

  /** Per-project CLI overrides, keyed by project id */
  projects: Record<string, ProjectSettings>;
}

/**
 * Per-project settings in generated file
 */
export interface ProjectSettings {
  _yaml_hashes: Record<string, string>;
  skills?: Record<string, SkillEntry>;
  output?: Partial<ConfigSchema["output"]>;
  rules?: Partial<ConfigSchema["rules"]>;
  ignore_scopes?: Scope[];
  tools?: Tool[];
}

export interface CacheSchema {
  version: number;
  structureTTL: number;
  skills: Record<string, Skill>;
  sets?: Record<string, SkillSet>;
}
