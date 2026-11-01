import { expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { buildSkillsetResult, diffSkillsetResult } from "@skillset/core";
import { createTestFixtureRoot } from "../../../../scripts/test-helpers/fixture-root";
import { normalizeSkillsetFixtureFiles } from "../../../../scripts/test-helpers/skillset-config";

async function fixture(presentation: Record<string, unknown>): Promise<string> {
  const root = await createTestFixtureRoot("skillset-presentation-");
  const files = normalizeSkillsetFixtureFiles({
    "skillset.yaml": "skillset:\n  name: presentation-test\ncompile:\n  targets: [codex]\n",
    ".skillset/plugins/tools/skillset.yaml": JSON.stringify({
      skillset: { name: "tools", presentation },
    }),
    ".skillset/plugins/tools/skills/helper/SKILL.md": "---\ndescription: Help with tasks.\n---\nHelp.\n",
  });
  for (const [path, content] of Object.entries(files)) await Bun.write(join(root, path), content);
  return root;
}

it("rejects malformed known presentation fields in public build and diff before output writes", async () => {
  for (const operation of [buildSkillsetResult, diffSkillsetResult]) {
    const root = await fixture({ displayName: 42 });
    await expect(operation(root)).rejects.toThrow(".skillset/plugins/tools/skillset.yaml.skillset.presentation.displayName must be a string");
    expect(existsSync(join(root, "plugins"))).toBe(false);
  }
});

it("builds valid legacy presentation and retains the migration warning", async () => {
  const root = await fixture({ displayName: "Legacy tools", custom: { arbitrary: true } });
  const result = await buildSkillsetResult(root);
  expect(result.diagnostics.some((warning) => warning.message.includes("presentation is retained for compatibility"))).toBe(true);
  const manifest = await Bun.file(join(root, "plugins/tools/plugin.json")).json();
  expect(manifest.extensions["com.openai"].interface.displayName).toBe("Legacy tools");
});
