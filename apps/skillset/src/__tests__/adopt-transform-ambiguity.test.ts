import { expect, test } from "bun:test";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { createOperationalPathContext, ISOLATED_OUT_ROOT, resolveOperationalPath } from "@skillset/core";
import { createTestFixtureRoot } from "../../../../scripts/test-helpers/fixture-root";
import { adoptSkillset } from "../adopt";

test.each([
  "Follow @alice for updates.",
  "```css\n@media screen {}\n```",
  "@decorator()",
  "Install @scope/package",
  "See ~/.claude/plugins/marketplaces/demo and .claude/skills-backup/demo.",
  "Claude uses CLAUDE.md; Codex uses AGENTS.md.",
])("adoption preserves ambiguous text without opting into dialect translation: %s", async (body) => {
  const root = await createTestFixtureRoot("skillset-adopt-ambiguity-");
  const source = join(root, ".claude/skills/demo/SKILL.md");
  await mkdir(join(root, ".claude/skills/demo"), { recursive: true });
  const original = `---\nname: demo\ndescription: Ambiguity fixture.\n---\n\n${body}\n`;
  await Bun.write(source, original);
  const report = await adoptSkillset(root, { write: true });
  expect(report.ok).toBe(true);
  expect(report.buildError).toBeUndefined();
  expect(report.transformPreviews.length).toBeGreaterThan(0);
  expect(report.transformPreviews.every((preview) => !preview.dialectDeclared)).toBe(true);
  const imported = await readFile(join(root, ".skillset/skills/demo/SKILL.md"), "utf8");
  expect(imported).not.toContain("dialect: claude");
  expect(imported).toContain(body);
  const output = resolveOperationalPath(createOperationalPathContext(root), `${ISOLATED_OUT_ROOT}/.agents/skills/demo/SKILL.md`);
  expect(await readFile(output, "utf8")).toContain(body);
  expect(await readFile(source, "utf8")).toBe(original);
});

test("one supported recognition never opts unrelated imported text into a document dialect", async () => {
  const { registerTransformEntry, transformEntries } = await import("@skillset/transforms");
  const intent = "test.explicit-adoption-intent";
  registerTransformEntry({
    intent, description: "Synthetic protocol; engine dispatch proof only.",
    lowering: "to-codex",
    forms: {
      claude: { pattern: /\[\[explicit-source-intent\]\]/gu },
      codex: { pattern: /\[\[explicit-target-intent\]\]/gu, render: () => "[[explicit-target-intent]]" },
    },
    evidence: [{ source: "test:explicit-adoption-intent", verified: "2026-10-29", note: "This fixture defines both protocol forms, not real provider behavior." }],
  });
  try {
    const root = await createTestFixtureRoot("skillset-adopt-single-span-");
    const body = "[[explicit-source-intent]]\n\nAsk @alice about CLAUDE.md and .claude/plugins/marketplaces/demo.\n";
    const original = `---\nname: demo\ndescription: Mixed intent.\n---\n\n${body}`;
    const source = join(root, ".claude/skills/demo/SKILL.md");
    await Bun.write(source, original);
    const report = await adoptSkillset(root, { write: true });
    expect(report.transformPreviews.every((preview) => !preview.dialectDeclared)).toBe(true);
    expect(report.ok).toBe(true);
    expect(report.transformPreviews.some((preview) => preview.matches.some((match) => match.intent === intent))).toBe(true);
    const imported = await readFile(join(root, ".skillset/skills/demo/SKILL.md"), "utf8");
    expect(imported).not.toContain("dialect: claude");
    expect(imported).toContain(body);
    expect(await readFile(source, "utf8")).toBe(original);
  } finally {
    transformEntries.delete(intent);
  }
});
