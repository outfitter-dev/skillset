import { expect, test } from "bun:test";
import { dirname, join } from "node:path";
import { createTestFixtureRoot } from "../../../../scripts/test-helpers/fixture-root";
import { explainPath } from "../authoring";
import { buildSkillsetResult } from "../build";

for (const isolated of [false, true]) {
  test(`skill locks retain primary identity with nested SKILL.md resources (isolated=${isolated})`, async () => {
    const root = await createTestFixtureRoot("skill-lock-primary-");
    const sourcePaths = [
      ".skillset/skills/(group)/different-folder/SKILL.md",
      ".skillset/plugins/acme/skills/(group)/different-folder/SKILL.md",
    ];
    await Bun.write(join(root, "skillset.yaml"), "skillset:\n  name: anchors\ncompile:\n  targets: [claude, codex]\nplugins:\n  internal_use:\n    skills:\n      acme: true\n");
    await Bun.write(join(root, ".skillset/plugins/acme/skillset.yaml"), "skillset:\n  name: acme\n");
    for (const sourcePath of sourcePaths) {
      await Bun.write(join(root, sourcePath), "---\nname: demo\ndescription: Demonstrate anchors.\n---\n\nPrimary body.\n");
      for (const resource of ["AAA/SKILL.md", "references/SKILL.md"]) {
        await Bun.write(join(root, dirname(sourcePath), resource), `Resource ${resource}\n`);
      }
    }
    const result = await buildSkillsetResult(root, { isolated });
    expect(result.ok).toBe(true);
    let checked = 0;
    for (const file of result.data.filter((file) => file.path.endsWith("skillset.lock"))) {
      const lock = JSON.parse(new TextDecoder().decode(file.content));
      for (const item of lock.items.filter((item: { sourcePath: string; files: string[] }) => sourcePaths.includes(item.sourcePath) && item.files.some((path) => path.endsWith("SKILL.md")))) {
        const expectedName = !file.path.includes("plugins/skillset.lock") && item.sourcePath === sourcePaths[1] ? "acme-demo" : "demo";
        const output = file.path.includes("plugins/skillset.lock") ? `acme/skills/${expectedName}/SKILL.md` : `${expectedName}/SKILL.md`;
        expect(item.outputPath).toBe(output);
        expect(item.files).toEqual(expect.arrayContaining([output, `${dirname(output)}/AAA/SKILL.md`, `${dirname(output)}/references/SKILL.md`]));
        for (const resource of ["AAA/SKILL.md", "references/SKILL.md"]) {
          const resourcePath = join(dirname(file.path), dirname(output), resource);
          const rendered = result.data.find((candidate) => candidate.path === resourcePath);
          expect(rendered).toBeDefined();
          expect(new TextDecoder().decode(rendered!.content)).toBe(`Resource ${resource}\n`);
          if (!isolated) expect(await Bun.file(join(root, resourcePath)).text()).toBe(`Resource ${resource}\n`);
        }
        checked++;
      }
    }
    expect(checked).toBe(5);
    expect(await explainPath(root, "plugins/acme/skills/demo/SKILL.md")).toMatchObject({
      kind: "generated", entries: [expect.objectContaining({ outputPath: "plugins/acme/skills/demo/SKILL.md", sourcePath: sourcePaths[1] })],
    });
  });
}
