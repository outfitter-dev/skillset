import { expect, test } from "bun:test";
import { join } from "node:path";
import { createTestFixtureRoot } from "../../../../scripts/test-helpers/fixture-root";
import { markdownCodeRanges, preprocessText, rewritePreprocessReferences, type PreprocessContext } from "../preprocess";

import { markdownLinkIsActive } from "../markdown-link-context";
import { rebaseRuleLinks } from "../rule-links";

const tick = String.fromCharCode(96);
const token = "@{{shared:references/a.md}}";
const context: PreprocessContext = {
  frontmatter: {}, rootPath: "/virtual", sourceRoot: ".skillset", sourcePath: "/virtual/source.md",
};

for (const [name, open, close] of [
  ["script", "<script>", "</script>"],
  ["style", "<style>", "</style>"],
  ["pre", "<pre>", "</pre>"],
  ["textarea", "<textarea>", "</textarea>"],
  ["comment", "<!--", "-->"],
  ["processing", "<?pi", "?>"],
  ["declaration", "<!DOCTYPE", ">"],
  ["cdata", "<![CDATA[", "]]>"],
  ["block tag", "<div>", "</div>"],
  ["complete tag", '<widget attr="value">', "</widget>"],
]) {
  test("HTML " + name + " backticks do not hide a marked reference", async () => {
    const source = [open, tick + "open", token + tick, close].join("\n");
    const seen: string[] = [];
    expect(await rewritePreprocessReferences(source, context, ({ specifier }) => {
      seen.push(specifier);
      return "resolved";
    })).toBe(source.replace(token, "resolved"));
    expect(seen).toEqual(["shared:references/a.md"]);
    expect(markdownCodeRanges(source)).toEqual([]);
  });
}

test("HTML block lines containing apparent fences remain active", async () => {
  for (const fence of ["~~~", tick.repeat(3)]) {
    const source = ["<div>", fence, token, fence, "</div>"].join("\n");
    expect(await rewritePreprocessReferences(source, context, () => "resolved"))
      .toBe(source.replace(token, "resolved"));
    expect(markdownCodeRanges(source)).toEqual([]);
  }
});

test("HTML boundaries prevent backtick pairing across either side", async () => {
  for (const source of [
    [tick + "before " + token, "<div>", "inside" + tick, "</div>"].join("\n"),
    ["<div>", tick + "inside " + token, "</div>", "", "after" + tick].join("\n"),
    [tick + "before " + token, "<div>", "inside", "</div>", "", "after" + tick].join("\n"),
  ]) {
    expect(markdownCodeRanges(source)).toEqual([]);
    expect(await rewritePreprocessReferences(source, context, () => "resolved"))
      .toBe(source.replace(token, "resolved"));
  }
});

test("a closing block tag does not end the block before a blank line", async () => {
  const active = ["<div>", "</div>", tick + token + tick].join("\n");
  const protectedSpan = tick + token + tick;
  expect(await rewritePreprocessReferences(active + "\n\n" + protectedSpan, context, () => "resolved"))
    .toBe(active.replace(token, "resolved") + "\n\n" + protectedSpan);
  expect(markdownCodeRanges(active + "\n\n" + protectedSpan))
    .toEqual([[active.length + 2, active.length + 2 + protectedSpan.length]]);
});

test("nested container HTML retains following list-paragraph code spans", async () => {
  for (const [prefix, continuation] of [["- ", "  "], ["-\t", "    "], ["> ", "> "]]) {
    const source = [prefix + "<div>", continuation + tick + token + tick, continuation + "</div>", ""].join("\n");
    expect(await rewritePreprocessReferences(source, context, () => "resolved"))
      .toBe(source.replace(token, "resolved"));
  }
  const html = ["- <div>", "  " + tick + token + tick, "  </div>", ""].join("\n");
  const span = tick + "first\n  " + token + tick;
  const source = html + "\n  " + span;
  expect(await rewritePreprocessReferences(source, context, () => "resolved"))
    .toBe(source.replace(token, "resolved"));
  expect(markdownCodeRanges(source)).toEqual([[source.indexOf(span), source.length]]);
});

test("raw offsets remain UTF-16 half-open across CRLF and CR HTML blocks", () => {
  for (const newline of ["\n", "\r\n", "\r"]) {
    const span = tick + "real" + tick;
    const source = ["😀", "", "<div>", tick + token + tick, "</div>", "", span].join(newline);
    expect(markdownCodeRanges(source)).toEqual([[source.indexOf(span), source.length]]);
  }
});

test("real code and inline HTML retain code-span protection", async () => {
  const sources = [
    tick + "<div>\n" + token + tick,
    ["~~~", "<div>", tick + token + tick, "</div>", "~~~"].join("\n"),
    [tick.repeat(3), "<div>", token, tick.repeat(3)].join("\n"),
    "ordinary <span> " + tick + token + tick + " </span>",
    "ordinary\n<widget> " + tick + token + tick + "\n</widget>",
    "    <div> " + tick + token + tick,
  ];
  for (const source of sources) {
    expect(await rewritePreprocessReferences(source, context, () => "unexpected")).toBe(source);
  }
});

test("table-cell inline HTML does not remove real cell code protection", async () => {
  const source = ["a | b", "--- | ---", "<span> " + tick + token + tick + " | value"].join("\n");
  expect(await rewritePreprocessReferences(source, context, () => "unexpected")).toBe(source);
});

test("real preprocessing expands a named partial inside an HTML block only", async () => {
  const rootPath = await createTestFixtureRoot("skillset-html-preprocess-");
  await Bun.write(join(rootPath, ".skillset/shared/partials/intro.md"), "Included.");
  const source = ["<div>", tick + "{{> intro}}" + tick, "</div>", "", tick + "{{> intro}}" + tick].join("\n");
  expect(await preprocessText(source, { ...context, rootPath, sourcePath: join(rootPath, "source.md") }))
    .toBe(source.replace("{{> intro}}", "Included."));
});


test("HTML comment links stay inactive without hiding following real links", () => {
  const hidden = "[hidden](docs/hidden.md)";
  const active = "[active](docs/active.md)";
  const source = [tick + "unmatched", "<!-- " + tick + hidden + " -->", "", active].join("\n");
  const isActive = markdownLinkIsActive(source);
  expect(isActive(hidden, source.indexOf(hidden))).toBe(false);
  expect(isActive(active, source.indexOf(active))).toBe(true);
  const inline = tick + "<!-- " + hidden + " -->" + tick + " " + active;
  const inlineActive = markdownLinkIsActive(inline);
  expect(inlineActive(hidden, inline.indexOf(hidden))).toBe(false);
  expect(inlineActive(active, inline.indexOf(active))).toBe(true);
});

test("rule link rebasing uses HTML boundaries while keeping real code literal", () => {
  const link = "[guide](docs/guide.md)";
  const source = ["<div>", tick + link + tick, "</div>", "", tick + link + tick].join("\n");
  expect(rebaseRuleLinks(source, { outputDir: ".claude", scopeDir: "" }))
    .toBe(source.replace("(docs/guide.md)", "(../docs/guide.md)"));
});

test("complete HTML tags can contain marked references in their attributes", async () => {
  const source = '<widget title="' + tick + token + tick + '">';
  expect(await rewritePreprocessReferences(source, context, () => "resolved"))
    .toBe(source.replace(token, "resolved"));
});

test("adjacent HTML blocks and EOF do not retain span state", async () => {
  const source = ["<script>", tick + token, "</script>", "<pre>", token + tick, "</pre>"].join("\n");
  expect(markdownCodeRanges(source)).toEqual([]);
  expect(await rewritePreprocessReferences(source, context, () => "resolved"))
    .toBe(source.replaceAll(token, "resolved"));
});

test("a block HTML opener interrupts a GFM table instead of creating a protected cell", async () => {
  // GFM 4.10 ends a table at another block-level structure; GitHub's renderer
  // confirms a header-only table followed by raw HTML for this exact fixture.
  const source = ["a | b", "--- | ---", "<div> " + tick + token + tick + " | value"].join("\n");
  expect(markdownCodeRanges(source)).toEqual([]);
  expect(await rewritePreprocessReferences(source, context, () => "resolved"))
    .toBe(source.replace(token, "resolved"));
});


test("HTML candidate filtering admits nested list and quote container prefixes", async () => {
  for (const [first, rest] of [
    ["> - <div>", ">   "],
    ["- > <div>", "  > "],
    ["1. <div>", "   "],
    ["1) <div>", "   "],
    ["* <div>", "  "],
    ["+ <div>", "  "],
    ["   <div>", "   "],
  ]) {
    const source = [first, rest + tick + token + tick, rest + "</div>"].join("\n");
    expect(await rewritePreprocessReferences(source, context, () => "resolved"))
      .toBe(source.replace(token, "resolved"));
  }
});
