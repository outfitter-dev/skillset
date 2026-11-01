import { expect, test } from "bun:test";
import { markdownCodeRanges, rewritePreprocessReferences, type PreprocessContext } from "../preprocess";

const tick = String.fromCharCode(96);
const context: PreprocessContext = {
  frontmatter: {},
  rootPath: "/virtual",
  sourceRoot: ".skillset",
  sourcePath: "/virtual/source.md",
};

test("rewrites ordered references around mixed code ranges without changing callback order", async () => {
  const protectedSpan = tick + "{{> hidden}} {{> hidden-again}}" + tick;
  const fence = ["~~~", "{{> fenced}}", "~~~"].join("\r\n");
  const multiline = tick + "{{> multi}}\r\n{{> multi-again}}" + tick;
  const source = [
    "😀 {{> first}}" + protectedSpan + "{{> adjacent}}",
    fence,
    multiline + "{{> after}}",
    tick + "unmatched {{> last}}",
  ].join("\r\n");
  const seen: string[] = [];
  const output = await rewritePreprocessReferences(source, context, ({ specifier }) => {
    seen.push(specifier);
    return "[" + specifier + "]";
  });
  expect(seen).toEqual(["first", "adjacent", "after", "last"]);
  expect(output).toBe(source.replaceAll("\r\n", "\n")
    .replace("{{> first}}", "[first]")
    .replace("{{> adjacent}}", "[adjacent]")
    .replace("{{> after}}", "[after]")
    .replace("{{> last}}", "[last]"));
});

test("code range producer returns ascending disjoint half-open spans and fences", () => {
  const spans = [
    tick + "one" + tick,
    tick + "two\nlines" + tick,
    "~~~\nfenced\n~~~",
    tick + "last" + tick,
  ];
  const source = "😀 " + spans[0] + " " + spans[1] + "\n\n" + spans[2] + "\n" + spans[3];
  const ranges = markdownCodeRanges(source);
  expect(ranges).toHaveLength(spans.length);
  for (const [index, [start, end]] of ranges.entries()) {
    expect(start).toBeLessThan(end);
    expect(source.slice(start, end)).toBe(spans[index]!);
    if (index > 0) expect(start).toBeGreaterThanOrEqual(ranges[index - 1]![1]);
  }
});

test("many earlier ranges preserve protected tokens and rewrite every later reference", async () => {
  const count = 2000;
  const protectedText = Array.from({ length: count }, (_, index) =>
    tick + "{{> hidden-" + index + "}}" + tick).join(" ");
  const activeText = Array.from({ length: count }, (_, index) =>
    "{{> active-" + index + "}}").join(" ");
  const seen: string[] = [];
  expect(await rewritePreprocessReferences(protectedText + "\n\n" + activeText, context, ({ specifier }) => {
    seen.push(specifier);
    return specifier;
  })).toBe(protectedText + "\n\n" + Array.from({ length: count }, (_, index) => "active-" + index).join(" "));
  expect(seen).toEqual(Array.from({ length: count }, (_, index) => "active-" + index));
});

test("each invocation starts a fresh cursor and non-Markdown input has no protected ranges", async () => {
  const source = tick + "{{> first}}" + tick + "{{> second}}";
  for (let invocation = 0; invocation < 2; invocation++) {
    expect(await rewritePreprocessReferences(source, context, ({ specifier }) => specifier))
      .toBe(tick + "{{> first}}" + tick + "second");
  }
  expect(await rewritePreprocessReferences(source, { ...context, sourcePath: "/virtual/source.txt" }, ({ specifier }) => specifier))
    .toBe(tick + "first" + tick + "second");
});
