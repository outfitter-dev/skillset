import type { TransformEntry } from "../types";

/**
 * Project instructions document name: `CLAUDE.md` <-> `AGENTS.md`.
 * Word-boundary on both sides keeps `MY_CLAUDE.md` and `CLAUDE.mdx` out;
 * path-qualified mentions (`docs/CLAUDE.md`) match the filename alone.
 */
export const projectInstructionsEntry: TransformEntry = {
  description: "Repo-level agent instructions document name.",
  evidence: [
    {
      note: "Codex reads project instructions from AGENTS.md, the role CLAUDE.md plays for Claude.",
      source: "https://developers.openai.com/codex/guides/agents-md",
      verified: "2026-06-11",
    },
  ],
  forms: {
    claude: {
      pattern: /\bCLAUDE\.md\b/gu,
      render: () => "CLAUDE.md",
    },
    codex: {
      pattern: /\bAGENTS\.md\b/gu,
      render: () => "AGENTS.md",
    },
  },
  intent: "doc.project-instructions",
  lowering: "bidirectional",
};
