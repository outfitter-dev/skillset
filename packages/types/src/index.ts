/**
 * @skillset/types - Shared type definitions for skillset
 */

// Re-export useful type-fest utilities
export type {
  JsonObject,
  JsonValue,
  PartialDeep,
  RequiredDeep,
  SetOptional,
  SetRequired,
  Simplify,
} from "type-fest";
// Common types
export type { InjectOutcome } from "./common";

// Config types
export type {
  CacheSchema,
  ConfigSchema,
  GeneratedSettingsSchema,
  ProjectIdStrategy,
  ProjectSettings,
  RuleSeverity,
  Scope,
  SetDefinition,
  SkillEntry,
  Tool,
} from "./config";

// Result pattern and errors
export * from "./errors";
export * from "./result";

// Skill types
export type {
  InvocationToken,
  ResolveResult,
  Skill,
  SkillRef,
  SkillRefPrefix,
  SkillSet,
  SkillSource,
} from "./skill";

export { isSkillRef } from "./skill";
