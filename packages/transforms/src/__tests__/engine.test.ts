import { expect, test } from "bun:test";

import { lowerTransform, recognizeTransforms } from "../index";

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

test("subagent mentions are conservative", () => {
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

test("lowerTransform produces codex forms for transformable matches", () => {
  const lower = (body: string): ReadonlyArray<string | undefined> =>
    recognizeTransforms(body, "claude").map((match) => lowerTransform(match, "codex"));

  expect(lower(".claude/commands and ~/.claude/agents")).toEqual([".codex/", "~/.codex/"]);
  expect(lower(".claude/skills/x and ~/.claude/skills")).toEqual([
    ".agents/skills",
    "~/.agents/skills",
  ]);
  expect(lower("see CLAUDE.md")).toEqual(["AGENTS.md"]);
  expect(lower("Ask @reviewer first.")).toEqual(["the `reviewer` agent"]);
  expect(lower("Use the Task tool with subagent_type 'code-reviewer' here.")).toEqual([
    "Spawn the `code-reviewer` agent",
  ]);
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
  expect(mention.lowering).toBe("to-codex");
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

test("codex dialect recognition works for the bidirectional entries", () => {
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
