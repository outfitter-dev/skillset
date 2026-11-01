import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createTestFixtureRoot } from "../../../../scripts/test-helpers/fixture-root";
import { buildSkillsetResult } from "@skillset/core";
import { importSource } from "../import";

for (const disabled of [false, true]) test(`imported nested Markdown keeps the authored opt-out choice (${disabled})`, async () => {
  const root = await createTestFixtureRoot("import-nested-preprocessing-");
  await Bun.write(join(root, "skillset.yaml"), "compile:\n  targets: []\n");
  await Bun.write(join(root, "external/SKILL.md"), "---\nname: imported\ndescription: Imported.\n---\nBody\n");
  const content = `${disabled ? "---\r\nskillset: { preprocess: false }\r\n---\r\n" : ""}{{> intro}}\r\n@{{shared:references/common.md}}\r\n`;
  await Bun.write(join(root, "external/examples/demo.md"), content);
  await Bun.write(join(root, ".skillset/shared/partials/intro.md"), "Intro.\n");
  await Bun.write(join(root, ".skillset/shared/references/common.md"), "Common\n");
  await importSource({ kind: "skill", rootPath: root, sourcePath: join(root, "external") });
  expect(await readFile(join(root, ".skillset/skills/imported/examples/demo.md"), "utf8")).toBe(content);
  expect((await buildSkillsetResult(root)).ok).toBe(true);
  const rendered = await readFile(join(root, ".agents/skills/imported/examples/demo.md"), "utf8");
  if (disabled) expect(rendered).toBe(content);
  else {
    expect(rendered).toContain("Intro.");
    expect(rendered).toContain("@../references/common.md");
  }
  expect(await Bun.file(join(root, ".agents/skills/imported/references/common.md")).exists()).toBe(!disabled);
});
