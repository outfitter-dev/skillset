import { expect, test } from "bun:test";

import { lowerTransform, recognizeTransforms } from "../index";

const literals = [
  "Follow @alice for updates.",
  "@media screen { color: red; }",
  "@decorator()",
  "Install @scope/package",
  "```css\n@media screen {}\n```",
  "Claude uses CLAUDE.md; Codex uses AGENTS.md.",
  "Read CLAUDE.md.backup",
  "See ~/.claude/plugins/marketplaces/demo",
  "See .claude/skills-backup/demo",
  "The .claude/skills/demo path belongs to Claude.",
  "Example: Use the Task tool with subagent_type reviewer",
];

test.each(literals)("ambiguous authored text is reported without lowering: %s", (body) => {
  const matches = recognizeTransforms(body, "claude");
  expect(matches.length).toBeGreaterThan(0);
  for (const match of matches) {
    expect(match.lowering).toBe("none");
    expect(match.reason).toBeDefined();
    expect(lowerTransform(match, "codex")).toBeUndefined();
  }
});
