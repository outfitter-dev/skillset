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

export interface InvocationToken {
  raw: string;
  alias: string;
  namespace: string | undefined;
}

export interface ResolveResult {
  invocation: InvocationToken;
  skill?: Skill;
  reason?: string;
  candidates?: Skill[];
}
