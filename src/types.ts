export type Mode = "warn" | "strict";

export interface Skill {
  skillRef: string; // stable identifier, e.g., "project:frontend-design"
  path: string; // absolute path to SKILL.md
  name: string;
  description: string | undefined;
  structure: string | undefined;
  lineCount: number | undefined;
  cachedAt: string | undefined;
}

export interface CacheSchema {
  version: number;
  structureTTL: number;
  skills: Record<string, Skill>;
}

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

export interface ResolveResult {
  invocation: InvocationToken;
  skill?: Skill;
  reason?: string;
  candidates?: Skill[];
}

export interface InvocationToken {
  raw: string;
  alias: string;
  namespace: string | undefined;
}

export interface InjectOutcome {
  resolved: ResolveResult[];
  warnings: string[];
  context: string;
}
