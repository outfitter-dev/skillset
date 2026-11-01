import { expect, test } from "bun:test";
import { checkWorkbenchSyntax, workbenchDiagnosticsFromMarkdownTemplatePlaceholders } from "../index";

const tick = String.fromCharCode(96);
const path = ".skillset/skills/context/SKILL.md";
const placeholders = (content: string) => checkWorkbenchSyntax({ content, path }).filter((d) => d.ruleId === "markdown/template-placeholder");

for (const [name, content] of [
  ["list fence", "-   item\n\n    ~~~\n    {   } []\n    ~~~"],
  ["quote fence", "> ~~~\n> {   } []\n> ~~~"],
  ["multiline span", tick + "before\n{   } []\nafter" + tick],
  ["unequal internal run", tick.repeat(2) + "before " + tick + " {   } [] after" + tick.repeat(2)],
] as const) {
  test("placeholder warnings ignore shared code context: " + name, () => {
    expect(placeholders(content)).toEqual([]);
  });
}

test("same-line active placeholders retain exact UTF-16 coordinates", () => {
  const content = "😀 {   } " + tick + "{   }" + tick + " []";
  expect(placeholders(content).map((d) => d.location)).toEqual([
    { path, line: 1, endLine: 1, column: 4, endColumn: 8 },
    { path, line: 1, endLine: 1, column: content.lastIndexOf("[]") + 1, endColumn: content.length },
  ]);
});

test("container exit and unmatched code leave active placeholders visible", () => {
  for (const content of ["> ~~~\n> {   }\n\n{   }", tick + "unclosed\n{   }"]) {
    const result = placeholders(content);
    expect(result).toHaveLength(1);
    expect(result[0]?.location?.line).toBe(content.split("\n").length);
  }
});

test("raw HTML with backticks keeps placeholder diagnostics active", () => {
  const content = "<div>\n" + tick + "{   }" + tick + "\n</div>";
  expect(placeholders(content).map((d) => d.location)).toEqual([{path, line: 2, endLine: 2, column: 2, endColumn: 6}]);
});

test("body offsets and normalized newlines survive multiline code masking", () => {
  const body = [tick + "before", "{   }", "after" + tick, "😀 {   }"].join("\r\n");
  expect(workbenchDiagnosticsFromMarkdownTemplatePlaceholders({content: body, path, startLine: 7}).map((d) => d.location))
    .toEqual([{path, line: 10, endLine: 10, column: 4, endColumn: 8}]);
  expect(placeholders("---\nname: context\ndescription: Context\n---\n" + body).map((d) => d.location))
    .toEqual([{path, line: 8, endLine: 8, column: 4, endColumn: 8}]);
});

test("task markers and the separate nested-fence diagnostic remain intact", () => {
  expect(placeholders("- [ ] task\n1. [ ] next")).toEqual([]);
  const content = [tick.repeat(3) + "markdown", "example", tick.repeat(3) + "ts", "const n = 1", tick.repeat(3), tick.repeat(3)].join("\n");
  expect(checkWorkbenchSyntax({content, path}).some((d) => d.ruleId === "markdown/code-fence-nesting")).toBe(true);
});

test("invalid backtick fence info leaves following placeholders active", () => {
  const content = [tick.repeat(3) + "js" + tick, "{   }", tick.repeat(3)].join("\n");
  expect(placeholders(content).map((d) => d.location)).toEqual([{path, line: 2, endLine: 2, column: 1, endColumn: 5}]);
  expect(placeholders(["~~~js" + tick, "{   }", "~~~"].join("\n"))).toEqual([]);
});
