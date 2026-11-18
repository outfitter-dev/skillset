import type { TransformEntry } from "../types";

export const subagentInvokeEntry: TransformEntry = {
  description: "Invocation of a named subagent.",
  evidence: [
    {
      note: "Codex subagents are spawned by name in prose; there is no mention syntax.",
      source: "https://developers.openai.com/codex/subagents",
      verified: "2026-06-11",
    },
    {
      note: "In the Codex TUI, @ triggers file search, not agent mentions.",
      source: "https://developers.openai.com/codex/cli/slash-commands",
      verified: "2026-06-11",
    },
  ],
  forms: {
    claude: {
      pattern:
        /(?<=^|\s)@([a-z0-9][a-z0-9-]{2,})\b|(?:[Uu]se|[Rr]un) the Task tool with subagent_type ['"`]?([a-z0-9][a-z0-9-]{2,})/gmu,
    },
    codex: {
      pattern: /\bSpawn the `([a-z0-9][a-z0-9-]{2,})` agent\b/gu,
    },
  },
  intent: "invoke.subagent",
  lowering: "none",
  reason: "A mention or quoted tool invocation does not establish portable agent identity or invocation semantics. Preserve the text for explicit author review.",
};
