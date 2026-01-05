/**
 * Skill-related types
 */

export type SkillSource = "project" | "user" | "plugin";

export type SkillRef = `${SkillSource}:${string}`;

export interface Skill {
  skillRef: string; // stable identifier, e.g., "project:frontend-design"
  path: string; // absolute path to SKILL.md
  name: string;
  description: string | undefined;
  structure: string | undefined;
  lineCount: number | undefined;
  cachedAt: string | undefined;
}

/**
 * A SkillSet is a bundled collection of skills that can be invoked together
 */
export interface SkillSet {
  setRef: string; // stable identifier, e.g., "project:frontend"
  name: string;
  description: string | undefined;
  skillRefs: string[]; // references to skills included in this set
}

export interface InvocationToken {
  raw: string;
  alias: string;
  namespace: string | undefined;
  kind?: "skill" | "set";
}

export interface ResolveResult {
  invocation: InvocationToken;
  skill?: Skill;
  set?: SkillSet;
  setSkills?: Skill[];
  include_full?: boolean;
  include_layout?: boolean;
  missingSkillRefs?: string[];
  reason?: string;
  candidates?: Skill[];
  setCandidates?: SkillSet[];
}
