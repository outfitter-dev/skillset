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
}

export interface CacheSchema {
  version: number;
  structureTTL: number;
  skills: Record<string, Skill>;
}

// Import Skill type for CacheSchema
import type { Skill } from "./skill";
