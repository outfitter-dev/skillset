import type { TransformEntry } from "../types";

/**
 * Subagent invocation. Claude has two surface forms: an `@agent-name`
 * mention and the explicit "use/run the Task tool with subagent_type 'name'"
 * phrasing. Codex has no @agent mention syntax (the TUI's @ is file search),
 * so the lowering is one-way prose: "Spawn the `name` agent" for the Task
 * phrasing, "the `name` agent" for bare mentions.
 *
 * Conservative on purpose: @mentions only match after start-of-line or
 * whitespace (which excludes emails, whose @ follows a word character) and
 * names must look like agent slugs (`[a-z0-9][a-z0-9-]{2,}`).
 *
 * Canonical capture: group 1 = mention name, group 2 = Task-phrase name;
 * exactly one is set per match.
 */
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
      render: (match) =>
        match[1] === undefined
          ? `Spawn the \`${match[2] ?? ""}\` agent`
          : `the \`${match[1]}\` agent`,
    },
  },
  intent: "invoke.subagent",
  lowering: "to-codex",
};
