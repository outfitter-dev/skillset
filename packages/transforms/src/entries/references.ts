import type { TransformEntry } from "../types";

/**
 * Claude `@<path>` file mention. Conservative recognizer: the @ must follow
 * start-of-line or whitespace (excluding emails, whose @ follows a word
 * character) and the target must look like a path — it starts with `/`,
 * `./`, `../`, or `~/`, or it contains a `/`. Quotes, backticks, and
 * brackets terminate the path, and trailing sentence punctuation backtracks
 * out of the match.
 */
export const fileMentionEntry: TransformEntry = {
  description: "Claude @<path> file mention.",
  evidence: [
    {
      note: "Codex has no file-mention syntax in skill or instruction bodies; OpenAI's Claude importer rejects mentions as unsupported template features.",
      source: "https://developers.openai.com/codex/skills",
      verified: "2026-06-11",
    },
    {
      note: "Importer rejection path for Claude dynamic constructs.",
      source: "https://github.com/openai/codex codex-rs/external-agent-migration/src/lib.rs (~L1181)",
      verified: "2026-06-11",
    },
  ],
  forms: {
    claude: {
      pattern:
        /(?<=^|\s)@((?:\.{1,2}\/|\/|~\/)[^\s`'"()[\]]+(?<![.,;:!?])|[\w.-]+\/[^\s`'"()[\]]+(?<![.,;:!?]))/gmu,
    },
  },
  intent: "reference.file-mention",
  lowering: "none",
  reason:
    "Claude file mentions have no Codex equivalent — the reference passes through as literal text, " +
    "and OpenAI's Claude importer rejects skills that use them.",
};
