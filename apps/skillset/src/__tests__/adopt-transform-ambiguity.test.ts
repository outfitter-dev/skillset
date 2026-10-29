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
])("adoption preserves ambiguous text without opting into dialect lowering: %s", async (body) => {
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
