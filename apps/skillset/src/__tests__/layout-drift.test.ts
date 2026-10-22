import { expect, test } from "bun:test";

import { isLayoutOnlyDifference } from "../layout-drift";

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
