/**
 * Configuration types
 */

export type Mode = "warn" | "strict";

export interface MappingEntry {
  skillRef: string;
  pinned?: boolean;
}

export interface ConfigSchema {
  version: number;
  mode: Mode;
  showStructure: boolean;
  maxLines: number;
  mappings: Record<string, MappingEntry>;
  namespaceAliases: Record<string, string>;
  sets?: Record<string, SetDefinition>;
}

export interface SetDefinition {
  name: string;
  description?: string;
  skillRefs: string[];
}

export interface CacheSchema {
  version: number;
  structureTTL: number;
  skills: Record<string, Skill>;
  sets?: Record<string, SkillSet>;
}

// Import Skill and SkillSet types for CacheSchema
import type { Skill, SkillSet } from "./skill";
