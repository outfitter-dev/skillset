import { claudeInstructionsFormat, codexAgentsMdFormat } from "@skillset/registry";

import type { TransformEntry } from "../types";

const CLAUDE_INSTRUCTIONS_FILE = claudeInstructionsFormat().fileName;
const CODEX_INSTRUCTIONS_FILE = codexAgentsMdFormat().fileName;

export const projectInstructionsEntry: TransformEntry = {
  description: "Repo-level agent instructions document name.",
  evidence: [
    {
      note: "Claude documents its project instruction filename; recognition does not establish equivalent destinations.",
      source: "https://code.claude.com/docs/en/memory",
      verified: "2026-10-31",
    },
    {
      note: "Codex reads project instructions from AGENTS.md, the role CLAUDE.md plays for Claude.",
      source: "https://developers.openai.com/codex/guides/agents-md",
      verified: "2026-06-11",
    },
  ],
  forms: {
    claude: {
      pattern: new RegExp(`\\b${CLAUDE_INSTRUCTIONS_FILE.replaceAll(".", "\\.")}\\b`, "gu"),
    },
    codex: {
      pattern: new RegExp(`\\b${CODEX_INSTRUCTIONS_FILE.replaceAll(".", "\\.")}\\b`, "gu"),
    },
  },
  intent: "doc.project-instructions",
  lowering: "none",
  reason: "An instruction filename in prose may describe a specific provider or literal file. Preserve it unless author intent establishes an equivalent destination.",
};
