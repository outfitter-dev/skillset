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

test("preserves whitespace inside Markdown code spans", () => {
  const command = 'Run `printf "a  b"` to see both spaces.\n';
  expect(isLayoutOnlyDifference("SKILL.md", command, command.replace("a  b", "a b"))).toBe(false);

  const multiline = 'Run ``printf "a\nb \nc"`` to see the spacing.\n';
  expect(isLayoutOnlyDifference("SKILL.md", multiline, multiline.replace("b \n", "b\n"))).toBe(false);

  const withHeading = `# Demo\n${multiline}`;
  expect(isLayoutOnlyDifference("SKILL.md", withHeading, withHeading.replace("b \n", "b\n"))).toBe(false);
});

test("allows prose to reflow around unchanged Markdown code spans", () => {
  const prose = 'Run `printf "a  b"` to see both spaces.\n';
  expect(isLayoutOnlyDifference("SKILL.md", prose, prose.replace(" to see", "\nto see"))).toBe(true);

  const nested = "Use ``literal `a  b` text`` in this example.\n";
  expect(isLayoutOnlyDifference("SKILL.md", nested, nested.replace(" in this", "\nin this"))).toBe(true);
  expect(isLayoutOnlyDifference("SKILL.md", nested, nested.replace("a  b", "a b"))).toBe(false);
});

test("preserves Markdown code spans even after a list item with a literal backtick", () => {
  const list = '- A literal backtick: `\n- Run `printf "a  b"` to see both spaces.\n';
  expect(isLayoutOnlyDifference("SKILL.md", list, list.replace("a  b", "a b"))).toBe(false);
});

test("does not treat creating a Markdown list by joining lines as reflow", () => {
  const prose = "A plus marker by itself:\n+\nnot part of a list.\n";
  const list = prose.replace("+\n", "+ ");
  expect(isLayoutOnlyDifference("SKILL.md", prose, list)).toBe(false);
});

test("preserves spacing that makes a Markdown list item an indented code block", () => {
  expect(isLayoutOnlyDifference("SKILL.md", "-     echo foo\n", "- echo foo\n")).toBe(false);
  expect(isLayoutOnlyDifference("SKILL.md", "-     echo  foo\n", "-     echo foo\n")).toBe(false);
});

test("allows prose in a Markdown bullet to reflow around an unchanged code span", () => {
  const list = '- Run `printf "a  b"` to see both spaces.\n- Leave this item alone.\n';
  const wrapped = list.replace(" to see", "\n  to see");
  expect(isLayoutOnlyDifference("SKILL.md", list, wrapped)).toBe(true);
  expect(isLayoutOnlyDifference("SKILL.md", list, wrapped.replace("a  b", "a b"))).toBe(false);
});

test("does not pair backticks across a Markdown thematic break", () => {
  const prose = 'A literal backtick: `\n* * *\nRun `printf "a  b"` to see both spaces.\n';
  expect(isLayoutOnlyDifference("SKILL.md", prose, prose.replace("a  b", "a b"))).toBe(false);
});

test("does not treat breaking a Markdown table without leading pipes as reflow", () => {
  const table = "First | Second\n:--- | ---:\na | b\n";
  expect(isLayoutOnlyDifference("SKILL.md", table, table.replace("Second\n", "Second "))).toBe(false);
});

test("keeps single-column Markdown table delimiters line-sensitive", () => {
  const table = "Run `skillset check` |\n:---: |\nReport |\n";
  expect(isLayoutOnlyDifference("SKILL.md", table, table.replace("|\n:---:", "| :---:"))).toBe(false);
});

test("keeps reference link definitions on their own lines", () => {
  const reference = "[guide]: https://example.com\nRead [the guide][guide] before running `skillset check`.\n";
  expect(isLayoutOnlyDifference("SKILL.md", reference, reference.replace(".com\n", ".com "))).toBe(false);
});
