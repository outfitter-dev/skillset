import { expect, test } from "bun:test";
import { normalizeSkillsetFixtureFiles } from "../../../../scripts/test-helpers/skillset-config";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildSkillset } from "@skillset/core";
import { parseMarkdown } from "@skillset/core/internal/yaml";

const SKILL_BODY = [
  "Skills live in .claude/skills/x and config in ~/.claude/foo.",
  "",
  "Read CLAUDE.md first, then ask @helper to verify.",
  "",
  "Use $ARGUMENTS verbatim.",
].join("\n");

const DIALECT_FIXTURE: Record<string, string> = {
  "skillset.yaml": `
skillset:
  name: dialect-root
claude: true
codex: true
`,
  ".skillset/skills/x/SKILL.md": `---
name: x
description: Claude-dialect skill.
dialect: claude
---

${SKILL_BODY}
`,
  ".skillset/skills/y/SKILL.md": `---
name: y
description: Portable skill with the same body.
---

${SKILL_BODY}
`,
};

const TRANSLATED_BODY = [
  "Skills live in .agents/skills/x and config in ~/.codex/foo.",
  "",
  "Read AGENTS.md first, then ask the `helper` agent to verify.",
  "",
  "Use $ARGUMENTS verbatim.",
].join("\n");

test("dialect: claude lowers the codex skill projection and only that projection", async () => {
  const root = await fixture(DIALECT_FIXTURE);
  await buildSkillset(root);

  // Codex projection: transformable constructs lowered, $ARGUMENTS untouched.
  const codex = await readFile(join(root, ".agents/skills/x/SKILL.md"), "utf8");
  expect(parseMarkdown(codex, "codex skill").body.trim()).toBe(TRANSLATED_BODY);

  // Claude projection: byte-identical to the source body.
  const claude = await readFile(join(root, ".claude/skills/x/SKILL.md"), "utf8");
  expect(parseMarkdown(claude, "claude skill").body.trim()).toBe(SKILL_BODY);
  expect(claude).toContain(".claude/skills/x");
  expect(claude).not.toContain(".agents/skills/x");

  // The source-only dialect key never reaches generated frontmatter.
  expect(codex).not.toContain("dialect: claude");
  expect(claude).not.toContain("dialect: claude");

  // Codex lock entry records applied transforms, sorted by intent.
  const codexLock = JSON.parse(
    await readFile(join(root, ".agents/skills/skillset.lock"), "utf8")
  ) as { items: readonly { name: string; transforms?: readonly unknown[] }[] };
  const codexItem = codexLock.items.find((item) => item.name === "x");
  expect(codexItem?.transforms).toEqual([
    { count: 1, intent: "doc.project-instructions" },
    { count: 1, intent: "invoke.subagent" },
    { count: 1, intent: "path.skills-dir" },
    { count: 1, intent: "path.user-config-dir" },
  ]);

  // Claude lock entry carries no transforms; neither does the untranslated skill.
  const claudeLock = JSON.parse(
    await readFile(join(root, ".claude/skills/skillset.lock"), "utf8")
  ) as { items: readonly { name: string; transforms?: readonly unknown[] }[] };
  expect(claudeLock.items.find((item) => item.name === "x")?.transforms).toBeUndefined();
  expect(codexLock.items.find((item) => item.name === "y")?.transforms).toBeUndefined();

  // No declaration, no translation: the portable skill keeps its body as-is.
  const portableCodex = await readFile(join(root, ".agents/skills/y/SKILL.md"), "utf8");
  expect(parseMarkdown(portableCodex, "portable codex skill").body.trim()).toBe(SKILL_BODY);
});

test("unknown dialect values fail the build loudly", async () => {
  const root = await fixture({
    "skillset.yaml": "skillset:\n  name: dialect-bad\nclaude: true\n",
    ".skillset/skills/x/SKILL.md": `---
name: x
description: Bad dialect.
dialect: codex
---

Body.
`,
  });

  await expect(buildSkillset(root)).rejects.toThrow(
    'declares unsupported dialect "codex"; only "claude" is supported'
  );
});

test("dialect: claude instructions translate AGENTS.md but not .claude/rules", async () => {
  const root = await fixture({
    "skillset.yaml": `
skillset:
  name: dialect-rules
claude: true
codex: true
`,
    ".skillset/rules/conventions.md": `---
dialect: claude
---

Keep CLAUDE.md current; agents live under .claude/agents.
`,
  });
  await buildSkillset(root);

  const agents = await readFile(join(root, "AGENTS.md"), "utf8");
  expect(agents).toContain("Keep AGENTS.md current; agents live under .codex/agents.");
  expect(agents).not.toContain("CLAUDE.md current");

  const rule = await readFile(join(root, ".claude/rules/conventions.md"), "utf8");
  expect(rule).toBe("Keep CLAUDE.md current; agents live under .claude/agents.\n");

  const workspaceLock = JSON.parse(await readFile(join(root, "skillset.lock"), "utf8")) as {
    items: readonly { name: string; transforms?: readonly unknown[] }[];
  };
  expect(workspaceLock.items.find((item) => item.name === "AGENTS.md")?.transforms).toEqual([
    { count: 1, intent: "doc.project-instructions" },
    { count: 1, intent: "path.project-config-dir" },
  ]);

  const rulesLock = JSON.parse(
    await readFile(join(root, ".claude/rules/skillset.lock"), "utf8")
  ) as { items: readonly { transforms?: readonly unknown[] }[] };
  expect(rulesLock.items.every((item) => item.transforms === undefined)).toBe(true);
});

async function fixture(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "skillset-dialect-"));
  for (const [path, content] of Object.entries(normalizeSkillsetFixtureFiles(files))) {
    await Bun.write(join(root, path), content);
  }
  return root;
}
