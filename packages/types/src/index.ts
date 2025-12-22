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
  MappingEntry,
  Mode,
  SetDefinition,
} from "./config";
// Skill types
export type {
  InvocationToken,
  ResolveResult,
  Skill,
  SkillRef,
  SkillSet,
  SkillSource,
} from "./skill";
