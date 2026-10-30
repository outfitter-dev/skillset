import { afterEach, expect, test } from "bun:test";
import { mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";

import { createTestFixtureRoot } from "../../../../scripts/test-helpers/fixture-root";
import { targetNames } from "../targets";
import {
  evaluateSkillsetTestWorkspace,
  loadSkillsetTestDeclaration,
  stageSkillsetTestWorkspace,
} from "../test-evaluation";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});
const skill = (name: string) =>
  `---\nname: ${name}\ndescription: Selected source.\n---\n\nBody for ${name}.\n`;
async function fixture(files: Record<string, string>, select: string) {
  const root = await createTestFixtureRoot("test-source-selection-");
  roots.push(root);
  const input = join(root, "input");
  const staged = join(root, "staged");
  await mkdir(staged);
  for (const [path, content] of Object.entries({
    "skillset.yaml": "compile:\n  targets: [claude]\n",
    ".skillset/tests.yaml": `slice:\n${select}  checks:\n    projection: true\n`,
    ...files,
  }))
    await Bun.write(join(input, path), content);
  const { graph, declaration } = await loadSkillsetTestDeclaration(
    input,
    "slice"
  );
  await stageSkillsetTestWorkspace(input, graph, declaration, staged);
  return {
    input,
    staged,
    evaluate: () =>
      evaluateSkillsetTestWorkspace(staged, graph, declaration, {}),
  };
}
for (const directory of ["demo", "(group)/demo", "(group)/different-folder"]) {
  test(`standalone selected identity survives ${directory}`, async () => {
    const path = `.skillset/skills/${directory}`;
    const { input, staged, evaluate } = await fixture(
      {
        [`${path}/SKILL.md`]: skill("demo"),
        [`${path}/assets/deep/data.txt`]: "exact resource\r\n",
        ".skillset/skills/(group)/other/SKILL.md": skill("other"),
      },
      "  select:\n    skills:\n      primary: [demo]\n"
    );
    expect(await Bun.file(join(staged, `${path}/SKILL.md`)).exists()).toBe(
      true
    );
    expect(
      await readFile(join(staged, `${path}/assets/deep/data.txt`), "utf8")
    ).toBe("exact resource\r\n");
    expect(
      await Bun.file(
        join(staged, ".skillset/skills/(group)/other/SKILL.md")
      ).exists()
    ).toBe(false);
    expect((await evaluate()).ok).toBe(true);
    expect(
      await readFile(join(staged, ".claude/skills/demo/SKILL.md"), "utf8")
    ).toContain("Body for demo.");
    expect(
      await Bun.file(
        join(input, ".skillset/skills/(group)/other/SKILL.md")
      ).exists()
    ).toBe(true);
  });
}
for (const whole of [false, true]) {
  test(`plugin selection preserves resolved child and whole=${whole} boundary`, async () => {
    const prefix = ".skillset/plugins/tools";
    const { staged, evaluate } = await fixture(
      {
        [`${prefix}/skillset.yaml`]: "skillset:\n  name: tools\n",
        [`${prefix}/skills/(group)/folder/SKILL.md`]: skill("demo"),
        [`${prefix}/skills/(group)/other/SKILL.md`]: skill("other"),
        [`${prefix}/shared/data.txt`]: "shared bytes",
        [`${prefix}/commands/helper.md`]:
          "---\ndescription: Helper.\n---\nHelp.\n",
        ".skillset/plugins/excluded/skillset.yaml":
          "skillset:\n  name: excluded\n",
        ".skillset/plugins/excluded/skills/demo/SKILL.md": skill("demo"),
      },
      whole
        ? "  select:\n    plugins: [tools]\n"
        : "  select:\n    skills:\n      plugin:\n        tools: [demo]\n"
    );
    expect(
      await Bun.file(
        join(staged, `${prefix}/skills/(group)/folder/SKILL.md`)
      ).exists()
    ).toBe(true);
    expect(
      await Bun.file(
        join(staged, `${prefix}/skills/(group)/other/SKILL.md`)
      ).exists()
    ).toBe(whole);
    expect(
      await Bun.file(join(staged, `${prefix}/commands/helper.md`)).exists()
    ).toBe(whole);
    expect(
      await readFile(join(staged, `${prefix}/shared/data.txt`), "utf8")
    ).toBe("shared bytes");
    expect(
      await Bun.file(
        join(staged, ".skillset/plugins/excluded/skills/demo/SKILL.md")
      ).exists()
    ).toBe(false);
    expect((await evaluate()).ok).toBe(true);
    expect(
      await readFile(join(staged, "plugins/tools/skills/demo/SKILL.md"), "utf8")
    ).toContain("Body for demo.");
  });
}
test("selection prunes canonical subagents and all provider source islands", async () => {
  const islands = Object.fromEntries(
    targetNames().map((target) => [
      `.skillset/_${target}/native.txt`,
      skill("native"),
    ])
  );
  const { staged, evaluate } = await fixture(
    {
      ...islands,
      ".skillset/subagents/original.md": skill("selected"),
      ".skillset/subagents/other.md": skill("other"),
    },
    "  select:\n    agents: [selected]\n"
  );
  expect(
    await Bun.file(join(staged, ".skillset/subagents/original.md")).exists()
  ).toBe(true);
  expect(
    await Bun.file(join(staged, ".skillset/subagents/other.md")).exists()
  ).toBe(false);
  for (const target of targetNames())
    expect(
      await Bun.file(join(staged, `.skillset/_${target}/native.txt`)).exists()
    ).toBe(false);
  expect((await evaluate()).ok).toBe(true);
  expect(
    await readFile(join(staged, ".claude/agents/selected.md"), "utf8")
  ).toContain("Body for selected.");
});

test("unfiltered staging preserves all sources and provider islands", async () => {
  const islands = Object.fromEntries(
    targetNames().map((target) => [
      `.skillset/_${target}/native.txt`,
      skill("native"),
    ])
  );
  const { staged, evaluate } = await fixture(
    {
      ...islands,
      ".skillset/skills/(group)/folder/SKILL.md": skill("demo"),
      ".skillset/subagents/other.md": skill("other"),
    },
    ""
  );
  for (const target of targetNames())
    expect(
      await Bun.file(join(staged, `.skillset/_${target}/native.txt`)).exists()
    ).toBe(true);
  expect(
    await Bun.file(join(staged, ".skillset/subagents/other.md")).exists()
  ).toBe(true);
  expect((await evaluate()).ok).toBe(true);
});

test("all-skills selection preserves multiple grouped units and excludes drafts", async () => {
  const { staged, evaluate } = await fixture(
    {
      ".skillset/skills/(group)/one/SKILL.md": skill("first"),
      ".skillset/skills/(group)/two/SKILL.md": skill("second"),
      ".skillset/skills/_drafts/draft/SKILL.md": skill("draft"),
    },
    "  select:\n    skills: true\n"
  );
  expect(
    await Bun.file(
      join(staged, ".skillset/skills/_drafts/draft/SKILL.md")
    ).exists()
  ).toBe(false);
  expect((await evaluate()).ok).toBe(true);
  for (const name of ["first", "second"])
    expect(
      await readFile(join(staged, `.claude/skills/${name}/SKILL.md`), "utf8")
    ).toContain(`Body for ${name}.`);
});

test("excluded configured drafts remain an explicit configuration error", async () => {
  const config = "drafts: [skill:draft]\ncompile:\n  targets: [claude]\n";
  const { input, staged, evaluate } = await fixture(
    {
      "skillset.yaml": config,
      ".skillset/skills/demo/SKILL.md": skill("demo"),
      ".skillset/skills/draft/SKILL.md": skill("draft"),
    },
    "  select:\n    skills:\n      primary: [demo]\n"
  );
  expect(await readFile(join(staged, "skillset.yaml"), "utf8")).toBe(config);
  expect(await readFile(join(input, "skillset.yaml"), "utf8")).toBe(config);
  const result = await evaluate();
  expect(result.ok).toBe(false);
  expect(result.buildError).toContain("drafts names absent unit");
});
