import { expect, test } from "bun:test";
import { join } from "node:path";
import { createTestFixtureRoot } from "../../../../scripts/test-helpers/fixture-root";
import { buildSkillsetResult, diffSkillsetResult, verifySkillsetResult } from "../build";

for (const bytes of [1024 * 1024 - 1, 1024 * 1024, 1024 * 1024 + 1]) {
  test(`skill copied-size advisory at ${bytes} bytes`, async () => {
    const root = await createTestFixtureRoot("skill-size-advisory-");
    await Bun.write(join(root, "skillset.yaml"), "compile:\n  targets: [codex]\n  session_start_hook: off\n");
    await Bun.write(join(root, ".skillset/skills/example/SKILL.md"), "---\nname: example\ndescription: Size.\n---\n@{{shared:assets/large.bin}}\n@{{shared:assets/large.bin}}\n");
    await Bun.write(join(root, ".skillset/shared/assets/large.bin"), Buffer.alloc(bytes, 97));
    const result = await buildSkillsetResult(root);
    expect(result.ok).toBe(true);
    const warnings = result.diagnostics.filter(d => d.code === "skill-resource-size");
    expect(warnings).toHaveLength(bytes > 1024 * 1024 ? 1 : 0);
    if (warnings.length) {
      expect(result.renderResults.some(outcome => outcome.diagnostics?.some(diagnostic => diagnostic.code === "skill-resource-size"))).toBe(true);
      expect(warnings[0]?.message).toContain(`${bytes} bytes`);
      expect(warnings[0]?.outputPath).toBe(".agents/skills/example/SKILL.md");
      expect((await diffSkillsetResult(root)).diagnostics.filter(d => d.code === "skill-resource-size")).toHaveLength(1);
      expect((await verifySkillsetResult(root)).diagnostics.filter(d => d.code === "skill-resource-size")).toHaveLength(1);
      expect((await diffSkillsetResult(root, { scopes: ["plugins"] })).diagnostics.filter(d => d.code === "skill-resource-size")).toHaveLength(0);
    }
  });
}

for (const bytes of [256 * 1024 - 1, 256 * 1024, 256 * 1024 + 1]) {
  test(`rule shared-import advisory at ${bytes} dependency bytes`, async () => {
    const root = await createTestFixtureRoot("rule-import-size-");
    await Bun.write(join(root, "skillset.yaml"), "compile:\n  targets: [claude]\n  session_start_hook: off\n");
    await Bun.write(join(root, ".skillset/RULES.md"), "@{{shared:references/large.md}}\n");
    await Bun.write(join(root, ".skillset/shared/references/large.md"), "x".repeat(bytes));
    const result = await buildSkillsetResult(root);
    expect(result.ok).toBe(true);
    const warnings = result.diagnostics.filter(d => d.code === "rule-import-size" && d.outputPath === ".claude/CLAUDE.md");
    expect(warnings).toHaveLength(bytes > 256 * 1024 ? 1 : 0);
    if (warnings.length) expect(warnings[0]?.message).toContain(`${bytes} shared dependency bytes`);
  });
}

test("large rules without shared imports receive no import advisory", async () => {
  const root = await createTestFixtureRoot("rule-no-import-size-");
  await Bun.write(join(root, "skillset.yaml"), "compile:\n  targets: [claude]\n  session_start_hook: off\n");
  await Bun.write(join(root, ".skillset/RULES.md"), "x".repeat(256 * 1024 + 1));
  const result = await buildSkillsetResult(root);
  expect(result.diagnostics.filter(d => d.code === "rule-import-size")).toHaveLength(0);
});
