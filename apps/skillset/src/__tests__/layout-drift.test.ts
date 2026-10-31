import { expect, test } from "bun:test";

import { join } from "node:path";
import { createTestFixtureRoot } from "../../../../scripts/test-helpers/fixture-root";
import { isLayoutOnlyDifference, layoutOnlyDriftPaths } from "../layout-drift";

const SKILL = [
  "---",
  "name: demo",
  "description: Demo skill.",
  "---",
  "",
  "# Demo",
  "",
  "A paragraph that a formatter might rewrap onto several shorter lines.",
  "",
  "- item one",
  "  - nested item",
  "",
  "```bash",
  "skillset build   --yes",
  "```",
  "",
].join("\n");

test("treats JSON whose tokens match apart from whitespace as layout-only", () => {
  const expected = '{"type":"object","required":["a","b"]}\n';
  const actual = '{\n  "type": "object",\n  "required": [\n    "a",\n    "b"\n  ]\n}\n';
  expect(isLayoutOnlyDifference("assets/schema.json", expected, actual)).toBe(true);
  expect(isLayoutOnlyDifference("assets/schema.json", expected, '{"type":"object","required":["b","a"]}\n')).toBe(false);
  expect(isLayoutOnlyDifference("assets/schema.json", expected, "{not json")).toBe(false);
  expect(isLayoutOnlyDifference(
    "assets/schema.json",
    '{"id":9007199254740992}',
    '{ "id": 9007199254740993 }'
  )).toBe(false);
  expect(isLayoutOnlyDifference(
    "assets/schema.json",
    '{"required":["a"]}',
    '{"required":["b"],"required":["a"]}'
  )).toBe(false);
  expect(isLayoutOnlyDifference("assets/schema.json", '{"a":"x y"}', '{"a":"x  y"}')).toBe(false);
});

test("treats rewrapped Markdown prose and trailing spaces as layout-only", () => {
  const rewrapped = SKILL
    .replace("might rewrap onto several", "might rewrap\nonto several")
    .replace("shorter lines.", "shorter lines. ");
  expect(isLayoutOnlyDifference("SKILL.md", SKILL, rewrapped)).toBe(true);
});

test("keeps Markdown drift that changes words, markers, structure, frontmatter, or code", () => {
  const cases = [
    SKILL.replace("A paragraph", "One paragraph"),
    SKILL.replace("- item one", "* item one"),
    SKILL.replace("  - nested item", "- nested item"),
    SKILL.replace("shorter lines.", "shorter lines.\n\nsplit"),
    SKILL.replace("description: Demo skill.", "description:   Demo skill."),
    SKILL.replace("skillset build   --yes", "skillset build --yes"),
    SKILL.replace("# Demo", "# Demo\nheading"),
    SKILL.replace("A paragraph that", "A paragraph  \nthat"),
    SKILL.replace("A paragraph that a formatter", "    A paragraph that a formatter"),
  ];
  for (const actual of cases) {
    expect(isLayoutOnlyDifference("SKILL.md", SKILL, actual)).toBe(false);
  }
});

test("never treats other file types as layout-only", () => {
  expect(isLayoutOnlyDifference("scripts/run.sh", "echo hi\n", "echo  hi\n")).toBe(false);
});

for (const fence of ["```", "~~~"]) {
  test(`preserves raw whitespace inside ${fence} verbatim regions`, () => {
    for (const [before, after] of [["", " "], ["  ", "   "], ["", "\t"]]) {
      const expected = `${fence}js\nconst value = 1;${before}\n${fence}\n`;
      const actual = `${fence}js\nconst value = 1;${after}\n${fence}\n`;
      expect(isLayoutOnlyDifference("SKILL.md", expected, actual)).toBe(false);
    }
    expect(isLayoutOnlyDifference("SKILL.md", `${fence}\n\n${fence}\n`, `${fence}\n \n${fence}\n`)).toBe(false);
    expect(isLayoutOnlyDifference("SKILL.md", `${fence}\nbody\n${fence}\n`, `${fence}\nbody\n${fence} \n`)).toBe(false);
    expect(isLayoutOnlyDifference("SKILL.md", `${fence}\nunterminated`, `${fence}\nunterminated `)).toBe(false);
  });
}

test("compares frontmatter raw while preserving prose and newline layout rules", () => {
  for (const [expected, actual] of [
    ["---\nname: demo\n---\n", "---\nname: demo \n---\n"],
    ["---\ndescription: |\n  body  \n---\n", "---\ndescription: |\n  body   \n---\n"],
    ["---\nname: demo\n---\n", "--- \nname: demo\n---\n"],
    ["````md\n```\nliteral\n```\n````\n", "````md\n```\nliteral \n```\n````\n"],
  ]) expect(isLayoutOnlyDifference("SKILL.md", expected!, actual!)).toBe(false);
  expect(isLayoutOnlyDifference("SKILL.md", "Prose line  \nnext\n", "Prose line   \nnext\n")).toBe(true);
  expect(isLayoutOnlyDifference("SKILL.md", SKILL, SKILL.replaceAll("\n", "\r\n"))).toBe(true);
});


test("SET-627: layout inspection excludes broken plugin links in repo scope", async () => {
  const root = await createTestFixtureRoot("layout-link-scope-");
  await Bun.write(join(root, "skillset.yaml"), "skillset:\n  name: layout\n");
  await Bun.write(join(root, ".skillset/skills/demo/SKILL.md"), "---\nname: demo\ndescription: Demo.\n---\nBody.\n");
  await Bun.write(join(root, ".skillset/plugins/other/skillset.yaml"), "skillset:\n  name: other\n");
  await Bun.write(join(root, ".skillset/plugins/other/skills/other/SKILL.md"), "---\nname: other\ndescription: Other.\n---\n[missing](absent.md)\n");
  await expect(layoutOnlyDriftPaths(root, [".agents/skills/demo/SKILL.md"], { scopes: ["repo"] })).resolves.toEqual([]);
  await expect(layoutOnlyDriftPaths(root, ["plugins/other/skills/other/SKILL.md"], { scopes: ["plugins"] })).rejects.toThrow("absent.md");
});
