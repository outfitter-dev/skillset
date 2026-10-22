import { providerProjectConfigDirectory, providerSkillsDirectory } from "@skillset/registry";

import type { TransformEntry } from "../types";

/** Provider directory facts, read from the registry pins rather than re-typed here. */
const CLAUDE_CONFIG_DIR = requiredConfigDirectory("claude");
const CODEX_CONFIG_DIR = requiredConfigDirectory("codex");
const CLAUDE_SKILLS_DIR = providerSkillsDirectory("claude");
const CODEX_SKILLS_DIR = providerSkillsDirectory("codex");

function requiredConfigDirectory(target: "claude" | "codex"): string {
  const directory = providerProjectConfigDirectory(target);
  if (directory === undefined) throw new Error(`skillset: registry pins no ${target} project config directory`);
  return directory;
}

function escapePattern(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\/]/gu, "\\$&");
}

const CONFIG_DIR_EVIDENCE = [
  {
    note: "Codex's project- and user-level configuration home is .codex/, the structural twin of Claude's .claude/.",
    source: "https://developers.openai.com/codex/config-reference",
    verified: "2026-06-11",
  },
] as const;

const SKILLS_DIR_EVIDENCE = [
  {
    note: "Codex documents the cross-agent .agents/skills convention as the primary skill home.",
    source: "https://developers.openai.com/codex/skills",
    verified: "2026-06-11",
  },
  {
    note: "The skill loader prefers .agents/skills and treats .codex/skills as a legacy location.",
    source: "openai/codex codex-rs/core-skills/src/loader.rs (~L310-377)",
    verified: "2026-06-11",
  },
] as const;

/**
 * Project-level config directory prefix: `.claude/` <-> `.codex/`.
 *
 * `.claude/skills` is deliberately NOT this entry's business — the skills
 * directory lowers to `.agents/skills` (see `path.skills-dir`), and the
 * engine's longest-match-first overlap dedupe guarantees the longer skills
 * match wins over this generic prefix.
 */
export const projectConfigDirEntry: TransformEntry = {
  description: "Project-level agent config directory prefix.",
  evidence: CONFIG_DIR_EVIDENCE,
  forms: {
    claude: {
      pattern: new RegExp(`${escapePattern(CLAUDE_CONFIG_DIR)}/`, "gu"),
      render: () => `${CLAUDE_CONFIG_DIR}/`,
    },
    codex: {
      pattern: new RegExp(`${escapePattern(CODEX_CONFIG_DIR)}/`, "gu"),
      render: () => `${CODEX_CONFIG_DIR}/`,
    },
  },
  intent: "path.project-config-dir",
  lowering: "bidirectional",
};

/**
 * User-level config directory prefix: `~/.claude/` <-> `~/.codex/`.
 * Same skills exception as the project entry; overlap dedupe also keeps this
 * entry ahead of `path.project-config-dir` on `~/.claude/...` spans because
 * its match is longer.
 */
export const userConfigDirEntry: TransformEntry = {
  description: "User-level agent config directory prefix.",
  evidence: CONFIG_DIR_EVIDENCE,
  forms: {
    claude: {
      pattern: new RegExp(`~/${escapePattern(CLAUDE_CONFIG_DIR)}/`, "gu"),
      render: () => `~/${CLAUDE_CONFIG_DIR}/`,
    },
    codex: {
      pattern: new RegExp(`~/${escapePattern(CODEX_CONFIG_DIR)}/`, "gu"),
      render: () => `~/${CODEX_CONFIG_DIR}/`,
    },
  },
  intent: "path.user-config-dir",
  lowering: "bidirectional",
};

/**
 * Skills directory: `.claude/skills` <-> `.agents/skills` and
 * `~/.claude/skills` <-> `~/.agents/skills`. Codex's primary skill home is
 * the cross-agent `.agents` convention, not `.codex/skills` (legacy).
 *
 * Canonical capture: group 1 is the optional `~/` user-home prefix.
 */
export const skillsDirEntry: TransformEntry = {
  description: "Agent skills directory, lowered to the cross-agent .agents convention.",
  evidence: SKILLS_DIR_EVIDENCE,
  forms: {
    claude: {
      pattern: new RegExp(`(~/)?${escapePattern(CLAUDE_SKILLS_DIR)}\\b`, "gu"),
      render: (match) => `${match[1] ?? ""}${CLAUDE_SKILLS_DIR}`,
    },
    codex: {
      pattern: new RegExp(`(~/)?${escapePattern(CODEX_SKILLS_DIR)}\\b`, "gu"),
      render: (match) => `${match[1] ?? ""}${CODEX_SKILLS_DIR}`,
    },
  },
  intent: "path.skills-dir",
  lowering: "bidirectional",
};
