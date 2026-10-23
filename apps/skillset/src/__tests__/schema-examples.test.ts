import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";

import { expect, test } from "bun:test";
import { buildSkillset, verifySkillset } from "@skillset/core";
import { skillsetSchemaExamples } from "@skillset/schema";
import { stringify } from "yaml";

import { createTestGitFixtureRoot } from "../../../../scripts/test-helpers/git-remote";

// JSON Schema cannot catch semantic errors such as an unsupported
// distribution shape or a rule provider field the renderer ignores, so the
// published examples must also build and check through the compiler [SET-698].
test("maximal workspace and rule frontmatter examples build and check cleanly", async () => {
  const root = await fixture({
    ".skillset/plugins/outfitter-core/assets/logo.svg": '<svg xmlns="http://www.w3.org/2000/svg"/>',
    ".skillset/plugins/outfitter-core/skillset.yaml": pluginConfig("outfitter-core"),
    ".skillset/plugins/skillset/skillset.yaml": pluginConfig("skillset"),
    ".skillset/plugins/skillset/skills/experimental/SKILL.md": skill("experimental"),
    ".skillset/plugins/skillset/skills/legacy-review/SKILL.md": skill("legacy-review"),
    ".skillset/plugins/skillset/skills/use-skillset/SKILL.md": skill("use-skillset"),
    ".skillset/rules/source.md": `---\n${stringify(example("rule-frontmatter"))}---\n\n# Source rules\n`,
    ".skillset/skills/use-skillset/SKILL.md": skill("use-skillset"),
    "package.json": JSON.stringify({ name: "@acme/api", version: "1.2.0" }),
    "packages/source/index.ts": "export {};\n",
    "skillset.yaml": stringify(example("workspace-config")),
  });

  await buildSkillset(root);
  await expect(verifySkillset(root)).resolves.toBeDefined();

  expect(await Bun.file(join(root, ".claude/rules/source.md")).exists()).toBe(true);
  // The example rule is unscoped (rules/source.md), so its paths: narrow Claude
  // and Cursor while Codex reads it from the root AGENTS.md [SET-557].
  expect(await Bun.file(join(root, "AGENTS.md")).text()).toContain("# Source rules");
  expect(await Bun.file(join(root, ".cursor/rules/source.mdc")).exists()).toBe(false);
});

function example(id: string): Record<string, unknown> {
  const match = skillsetSchemaExamples.find((entry) => entry.id === id);
  if (match === undefined) throw new Error(`missing schema example ${id}`);
  return match.value;
}

function pluginConfig(name: string): string {
  return stringify({ skillset: { description: `Example ${name} plugin.`, name } });
}

function skill(name: string): string {
  return `---\nname: ${name}\ndescription: Example ${name} skill.\n---\n\n# ${name}\n`;
}

async function fixture(files: Record<string, string>): Promise<string> {
  const disposableRoot = await createTestGitFixtureRoot("skillset-schema-examples-");
  const root = await mkdtemp(join(disposableRoot, "repo-"));
  for (const [path, content] of Object.entries(files)) {
    await Bun.write(join(root, path), content);
  }
  return root;
}
