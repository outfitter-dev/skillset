import { expect, test } from "bun:test";

import { lowerTransform, recognizeTransforms, registerTransformEntry, transformEntries } from "../index";

test("recognizes claude constructs sorted by index", () => {
  const body = "Read CLAUDE.md, then look in .claude/settings.json and pass $ARGUMENTS.";
  const matches = recognizeTransforms(body, "claude");
  expect(matches.map((match) => [match.intent, match.text])).toEqual([
    ["doc.project-instructions", "CLAUDE.md"],
    ["path.project-config-dir", ".claude/"],
    ["dynamic.arguments", "$ARGUMENTS"],
  ]);
  expect(matches.map((match) => match.index)).toEqual(
    [...matches].sort((a, b) => a.index - b.index).map((match) => match.index)
  );
});

test(".claude/skills/foo yields only the skills-dir match", () => {
  const matches = recognizeTransforms("Skills live in .claude/skills/foo today.", "claude");
  expect(matches.map((match) => match.intent)).toEqual(["path.skills-dir"]);
  expect(matches[0]?.text).toBe(".claude/skills");
});

test("~/.claude/ spans prefer the user entry; ~/.claude/skills the skills entry", () => {
  expect(
    recognizeTransforms("config: ~/.claude/settings.json", "claude").map((m) => m.intent)
  ).toEqual(["path.user-config-dir"]);
  const skills = recognizeTransforms("home skills: ~/.claude/skills/foo", "claude");
  expect(skills.map((match) => [match.intent, match.text])).toEqual([
    ["path.skills-dir", "~/.claude/skills"],
  ]);
});

test("ambiguous subagent-shaped mentions are recognized for reporting", () => {
  const matches = recognizeTransforms("Ask @reviewer to take a pass.", "claude");
  expect(matches.map((match) => [match.intent, match.text])).toEqual([
    ["invoke.subagent", "@reviewer"],
  ]);
  // Emails (word char before @), short names, and uppercase do not match.
  expect(recognizeTransforms("mail me at matt@example.com", "claude")).toEqual([]);
  expect(recognizeTransforms("ping @ab quickly", "claude")).toEqual([]);
  expect(recognizeTransforms("ping @Reviewer quickly", "claude")).toEqual([]);
});

test("@path mentions classify as file references, beating the agent-mention span", () => {
  const matches = recognizeTransforms("Read @src/lib/types.ts and @./notes.md.", "claude");
  expect(matches.map((match) => [match.intent, match.text])).toEqual([
    ["reference.file-mention", "@src/lib/types.ts"],
    ["reference.file-mention", "@./notes.md"],
  ]);
});

test("lowerTransform supports explicit registered semantic mappings", () => {
  const intent = "test.explicit-intent";
  registerTransformEntry({
    intent,
    description: "Synthetic explicit intent for engine contract testing.",
    evidence: [{ source: "test-only protocol", verified: "2026-10-29" }],
    lowering: "to-codex",
    forms: {
      claude: { pattern: /source-intent:([a-z]+)/gu },
      codex: { pattern: /target-intent:([a-z]+)/gu, render: (match) => `target-intent:${match[1]}` },
    },
  });
  try {
    const [match] = recognizeTransforms("source-intent:demo", "claude");
    if (match === undefined) throw new Error("expected explicit intent");
    expect(lowerTransform(match, "codex")).toBe("target-intent:demo");
    expect(lowerTransform(match, "claude")).toBeUndefined();
  } finally {
    transformEntries.delete(intent);
  }
});

test("lowerTransform refuses no-faithful-lowering matches and wrong directions", () => {
  const [argumentsMatch] = recognizeTransforms("pass $ARGUMENTS", "claude");
  if (argumentsMatch === undefined) throw new Error("expected a match");
  expect(argumentsMatch.lowering).toBe("none");
  expect(argumentsMatch.reason).toContain("no templating");
  expect(lowerTransform(argumentsMatch, "codex")).toBeUndefined();
  expect(lowerTransform(argumentsMatch, "claude")).toBeUndefined();

  const [mention] = recognizeTransforms("Ask @reviewer first.", "claude");
  if (mention === undefined) throw new Error("expected a match");
  expect(mention.lowering).toBe("none");
  expect(lowerTransform(mention, "claude")).toBeUndefined();
});

test("no-lowering dynamics are recognized, including inside code fences", () => {
  const body = [
    "```bash",
    "run $1 with ${CLAUDE_PLUGIN_ROOT}/bin/tool",
    "```",
    "  !`git status`",
  ].join("\n");
  const intents = recognizeTransforms(body, "claude").map((match) => match.intent);
  expect(intents).toEqual([
    "dynamic.positional",
    "dynamic.env-substitution",
    "dynamic.pre-resolution",
  ]);
});

test("codex dialect references remain recognizable for reporting", () => {
  const matches = recognizeTransforms(
    "AGENTS.md, .codex/config.toml, ~/.codex/, and .agents/skills/x",
    "codex"
  );
  expect(matches.map((match) => match.intent)).toEqual([
    "doc.project-instructions",
    "path.project-config-dir",
    "path.user-config-dir",
    "path.skills-dir",
  ]);
});
