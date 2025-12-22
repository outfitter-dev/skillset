/**
 * @skillset/types - Shared type definitions for skillset
 */

// Re-export useful type-fest utilities
export type {
  JsonValue,
  JsonObject,
  Simplify,
  SetRequired,
  SetOptional,
  PartialDeep,
  RequiredDeep,
} from "type-fest";

// Skill types
export type {
  Skill,
  SkillRef,
  SkillSource,
  InvocationToken,
  ResolveResult,
} from "./skill";

// Config types
export type {
  Mode,
  ConfigSchema,
  MappingEntry,
  CacheSchema,
} from "./config";

// Common types
export type {
  InjectOutcome,
} from "./common";
