import { providerProjectConfigDirectory, providerSkillsDirectory } from "@skillset/registry";

import type { TransformEntry } from "../types";

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
    note: "The config root is a provider fact; it does not establish equivalence of arbitrary descendants.",
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

export const projectConfigDirEntry: TransformEntry = {
  description: "Project-level agent config directory prefix.",
  evidence: CONFIG_DIR_EVIDENCE,
  forms: {
    claude: {
      pattern: new RegExp(`${escapePattern(CLAUDE_CONFIG_DIR)}/`, "gu"),
    },
    codex: {
      pattern: new RegExp(`${escapePattern(CODEX_CONFIG_DIR)}/`, "gu"),
    },
  },
  intent: "path.project-config-dir",
  lowering: "none",
  reason: "A provider directory spelling does not establish equivalent descendant paths or author intent. Preserve the reference and review its destination explicitly.",
};

export const userConfigDirEntry: TransformEntry = {
  description: "User-level agent config directory prefix.",
  evidence: CONFIG_DIR_EVIDENCE,
  forms: {
    claude: {
      pattern: new RegExp(`~/${escapePattern(CLAUDE_CONFIG_DIR)}/`, "gu"),
    },
    codex: {
      pattern: new RegExp(`~/${escapePattern(CODEX_CONFIG_DIR)}/`, "gu"),
    },
  },
  intent: "path.user-config-dir",
  lowering: "none",
  reason: "A provider directory spelling does not establish equivalent descendant paths or author intent. Preserve the reference and review its destination explicitly.",
};

export const skillsDirEntry: TransformEntry = {
  description: "Provider skill-directory reference requiring explicit destination review.",
  evidence: SKILLS_DIR_EVIDENCE,
  forms: {
    claude: {
      pattern: new RegExp(`(~/)?${escapePattern(CLAUDE_SKILLS_DIR)}\\b`, "gu"),
    },
    codex: {
      pattern: new RegExp(`(~/)?${escapePattern(CODEX_SKILLS_DIR)}\\b`, "gu"),
    },
  },
  intent: "path.skills-dir",
  lowering: "none",
  reason: "A provider directory spelling does not establish equivalent descendant paths or author intent. Preserve the reference and review its destination explicitly.",
};
