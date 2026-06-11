import { expect, test } from "bun:test";

import { lowerTransform, recognizeTransforms } from "../index";
import type { TransformDialect, TransformTarget } from "../types";

/**
 * Test-local rewrite helper. The product never rewrites content in this
 * slice; this exists purely to assert the round-trip identity property on
 * whole documents.
 */
function rewrite(body: string, from: TransformDialect, to: TransformTarget): string {
  let out = "";
  let cursor = 0;
  for (const match of recognizeTransforms(body, from)) {
    const lowered = lowerTransform(match, to);
    if (lowered === undefined) continue;
    out += body.slice(cursor, match.index) + lowered;
    cursor = match.index + match.text.length;
  }
  return out + body.slice(cursor);
}

const CLAUDE_SAMPLE = [
  "Project config sits in .claude/settings.json; user config in ~/.claude/config.",
  "Skills live in .claude/skills/review and globally in ~/.claude/skills.",
  "Read CLAUDE.md first, then docs/CLAUDE.md if present.",
  "Commands: .claude/commands/x.md and agents in ~/.claude/agents/.",
].join("\n");

const CODEX_SAMPLE = [
  "Project config sits in .codex/config.toml; user config in ~/.codex/config.",
  "Skills live in .agents/skills/review and globally in ~/.agents/skills.",
  "Read AGENTS.md first, then docs/AGENTS.md if present.",
].join("\n");

test("claude -> intent -> claude is the identity on bidirectional entries", () => {
  expect(rewrite(CLAUDE_SAMPLE, "claude", "claude")).toBe(CLAUDE_SAMPLE);
  for (const match of recognizeTransforms(CLAUDE_SAMPLE, "claude")) {
    expect(lowerTransform(match, "claude")).toBe(match.text);
  }
});

test("claude -> codex -> claude reproduces the input byte-for-byte", () => {
  const codex = rewrite(CLAUDE_SAMPLE, "claude", "codex");
  expect(codex).toBe(
    [
      "Project config sits in .codex/settings.json; user config in ~/.codex/config.",
      "Skills live in .agents/skills/review and globally in ~/.agents/skills.",
      "Read AGENTS.md first, then docs/AGENTS.md if present.",
      "Commands: .codex/commands/x.md and agents in ~/.codex/agents/.",
    ].join("\n")
  );
  expect(rewrite(codex, "codex", "claude")).toBe(CLAUDE_SAMPLE);
});

test("codex -> claude -> codex reproduces the input byte-for-byte", () => {
  const claude = rewrite(CODEX_SAMPLE, "codex", "claude");
  expect(rewrite(claude, "claude", "codex")).toBe(CODEX_SAMPLE);
});

test("subagent invocations render to codex prose (to-codex only)", () => {
  const body = [
    "First ask @code-reviewer for a pass.",
    "Then use the Task tool with subagent_type 'doc-writer' for docs.",
  ].join("\n");
  const matches = recognizeTransforms(body, "claude");
  expect(matches.map((match) => lowerTransform(match, "codex"))).toEqual([
    "the `code-reviewer` agent",
    "Spawn the `doc-writer` agent",
  ]);
  // No reverse path exists: claude is not a valid target for these matches.
  for (const match of matches) {
    expect(lowerTransform(match, "claude")).toBeUndefined();
  }
});
