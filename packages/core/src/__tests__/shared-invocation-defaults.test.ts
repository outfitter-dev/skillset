import { expect, test } from "bun:test";
import { join } from "node:path";
import { buildSkillsetResult } from "../build";
import { createTestFixtureRoot } from "../../../../scripts/test-helpers/fixture-root";

async function fixture(policy: string, targets = "[claude, cursor]") {
  const root = await createTestFixtureRoot("skillset-shared-invocation-default-");
  await Bun.write(join(root, "skillset.yaml"), `compile:\n  targets: ${targets}\n`);
  await Bun.write(join(root, ".skillset/plugins/demo/skillset.yaml"), "skillset:\n  name: demo\n");
  await Bun.write(join(root, ".skillset/plugins/demo/skills/test/SKILL.md"), `---\nname: test\ndescription: Invocation.\n${policy}\n---\nBody.\n`);
  return root;
}

for (const provider of ["claude", "cursor"]) {
  test(`shared output rejects ${provider}-only native invocation restrictions`, async () => {
    const root = await fixture(`${provider}:\n  frontmatter:\n    disable-model-invocation: true`);
    await expect(buildSkillsetResult(root)).rejects.toThrow("conflicts at disable-model-invocation");
    expect(await Bun.file(join(root, "plugins/demo/skills/test/SKILL.md")).exists()).toBe(false);
  });
}

test("shared output rejects a canonical single-provider restriction against another provider default", async () => {
  const root = await fixture("implicit_invocation:\n  cursor: false");
  await expect(buildSkillsetResult(root)).rejects.toThrow("conflicts at disable-model-invocation");
});

test("explicit false matches the native default, while one actual consumer may use true", async () => {
  const same = await fixture("claude:\n  frontmatter:\n    disable-model-invocation: false");
  expect((await buildSkillsetResult(same)).ok).toBe(true);
  const single = await fixture("claude:\n  frontmatter:\n    disable-model-invocation: true", "[claude, codex]");
  expect((await buildSkillsetResult(single)).ok).toBe(true);
});
