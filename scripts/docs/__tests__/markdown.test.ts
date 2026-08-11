import { describe, expect, test } from "bun:test";

import {
  extractGeneratedMarkers,
  extractInlineMarkdownLinks,
  extractMarkdownHeadings,
  githubHeadingSlug,
  replaceGeneratedBlock,
  validateGeneratedMarkers,
} from "../markdown";

describe("Markdown links", () => {
  test("extracts inline destinations, including nested parentheses and titles", () => {
    const source = [
      'See [setup](./setup.md#Install_(local)) and [policy](<../SECURITY.md> "Private reporting").',
      "![diagram](./diagram.png)",
    ].join("\n");

    expect(extractInlineMarkdownLinks(source)).toEqual([
      {
        column: 5,
        destination: "./setup.md#Install_(local)",
        label: "setup",
        line: 1,
      },
      { column: 45, destination: "../SECURITY.md", label: "policy", line: 1 },
    ]);
  });

  test("ignores links in code spans and fenced examples", () => {
    const source = [
      "Keep `[hidden](./hidden.md)` but follow [visible](./visible.md).",
      "```markdown",
      "[fenced](./fenced.md)",
      "```",
      "~~~",
      "[also-fenced](./also.md)",
      "~~~~",
    ].join("\n");

    expect(
      extractInlineMarkdownLinks(source).map((link) => link.destination)
    ).toEqual(["./visible.md"]);
  });

  test("does not open backtick fences with backticks in the info string", () => {
    const source = ["``` invalid`info", "[visible](./visible.md)", "```"].join(
      "\n"
    );

    expect(
      extractInlineMarkdownLinks(source).map((link) => link.destination)
    ).toEqual(["./visible.md"]);
  });

  test("ignores links inside HTML comments", () => {
    const source = [
      "<!-- [hidden](./missing.md) -->",
      "<!--",
      "[also hidden][missing]",
      "[missing]: ./missing.md",
      "-->",
      "[visible](./visible.md)",
    ].join("\n");

    expect(extractInlineMarkdownLinks(source)).toEqual([
      {
        column: 1,
        destination: "./visible.md",
        label: "visible",
        line: 6,
      },
    ]);
  });

  test("ignores links after an unclosed HTML comment", () => {
    expect(
      extractInlineMarkdownLinks(
        "[visible](./visible.md)\n<!-- unclosed\n[hidden](./missing.md)\n"
      ).map(({ destination }) => destination)
    ).toEqual(["./visible.md"]);
  });

  test("ignores links inside raw HTML blocks", () => {
    const source = [
      "<script>",
      "[script](./script.md)",
      "</script>",
      "",
      "<pre>",
      "[pre](./pre.md)",
      "</pre>",
      "",
      "<div>",
      "[div](./div.md)",
      "</div>",
      "",
      "[visible](./visible.md)",
    ].join("\n");

    expect(
      extractInlineMarkdownLinks(source).map(({ destination }) => destination)
    ).toEqual(["./visible.md"]);
  });

  test("resolves full, collapsed, and shortcut reference links", () => {
    const source = [
      "Read [the guide][guide], [setup][], and [Security].",
      "",
      "[guide]: ./guide.md#start",
      "[setup]: <./setup.md>",
      '[security]: ../SECURITY.md "Private reports"',
    ].join("\n");

    expect(
      extractInlineMarkdownLinks(source).map((link) => link.destination)
    ).toEqual(["./guide.md#start", "./setup.md", "../SECURITY.md"]);
  });
});

describe("Markdown headings", () => {
  test("derives GitHub-compatible anchors and duplicate suffixes", () => {
    const source = [
      "# Hello, World!",
      "## Hello, World!",
      "### Café & _Tools_",
      "```markdown",
      "# Not a heading",
      "```",
      "  #### [Install locally](./install.md) ###",
      "##### API `build()`",
    ].join("\n");

    expect(extractMarkdownHeadings(source)).toEqual([
      { anchor: "hello-world", depth: 1, line: 1, text: "Hello, World!" },
      { anchor: "hello-world-1", depth: 2, line: 2, text: "Hello, World!" },
      { anchor: "café--tools", depth: 3, line: 3, text: "Café & Tools" },
      { anchor: "install-locally", depth: 4, line: 7, text: "Install locally" },
      { anchor: "api-build", depth: 5, line: 8, text: "API build()" },
    ]);
    expect(githubHeadingSlug("API: `build()` / check?")).toBe(
      "api-build--check"
    );
    expect(githubHeadingSlug("Ship 🚀 safely")).toBe("ship--safely");
    expect(githubHeadingSlug("Dev 👩‍💻 guide")).toBe("dev--guide");
    expect(githubHeadingSlug("Ship ❤️ safely")).toBe("ship--safely");
    expect(githubHeadingSlug("foo_bar")).toBe("foo_bar");
    expect(githubHeadingSlug("_foo_bar_")).toBe("foo_bar");
    expect(githubHeadingSlug("__foo__")).toBe("foo");
    expect(githubHeadingSlug("___foo___")).toBe("foo");
    expect(githubHeadingSlug("____foo____")).toBe("foo");
    expect(githubHeadingSlug("___foo__")).toBe("_foo");
    expect(githubHeadingSlug("____foo___")).toBe("_foo");
    expect(githubHeadingSlug("_____foo___")).toBe("__foo");
    expect(githubHeadingSlug("\\_foo\\_")).toBe("_foo_");
    expect(githubHeadingSlug("\\\\_foo\\\\_")).toBe("foo");
    expect(githubHeadingSlug("_foo\\\\_")).toBe("foo");
    expect(githubHeadingSlug("Press 1️⃣ now")).toBe("press-1-now");
    expect(githubHeadingSlug("“Hello”—guide")).toBe("helloguide");
    expect(githubHeadingSlug("[API](./foo_(bar).md)")).toBe("api");
    expect(githubHeadingSlug("![Logo](./foo_(bar).png)")).toBe("logo");
    expect(githubHeadingSlug("Fish &amp; Chips")).toBe("fish--chips");
    expect(githubHeadingSlug("Copyright &copy; 2026")).toBe("copyright--2026");
    expect(githubHeadingSlug("A &ndash; B")).toBe("a--b");
    expect(githubHeadingSlug("Fish &#xA0; Chips")).toBe("fish--chips");
    expect(githubHeadingSlug("`&amp;`")).toBe("amp");
    expect(githubHeadingSlug("<https://example.com>")).toBe("httpsexamplecom");
    expect(
      extractMarkdownHeadings("# [Guide][ref]\n\n[ref]: ./guide.md\n")[0]
        ?.anchor
    ).toBe("guide");
    expect(
      extractMarkdownHeadings(
        "# [Full][ref]\n## [Collapsed][]\n### [Shortcut]\n\n[ref]: ./full.md\n[collapsed]: ./collapsed.md\n[shortcut]: ./shortcut.md\n"
      ).map(({ anchor }) => anchor)
    ).toEqual(["full", "collapsed", "shortcut"]);
  });
});

describe("generated markers", () => {
  test("extracts and validates distinct visible blocks", () => {
    const source = [
      "`<!-- skillset:generated:start ignored -->`",
      "<!-- skillset:generated:start support-matrix -->",
      "generated",
      "<!-- skillset:generated:end support-matrix -->",
      "```markdown",
      "<!-- skillset:generated:start fenced -->",
      "```",
      "<!-- skillset:generated:start cli-reference -->",
      "<!-- skillset:generated:end cli-reference -->",
    ].join("\n");
    const markers = extractGeneratedMarkers(source);

    expect(markers).toEqual([
      { id: "support-matrix", kind: "start", line: 2 },
      { id: "support-matrix", kind: "end", line: 4 },
      { id: "cli-reference", kind: "start", line: 8 },
      { id: "cli-reference", kind: "end", line: 9 },
    ]);
    expect(validateGeneratedMarkers(markers)).toEqual([]);
  });

  test("reports malformed, nested, mismatched, duplicate, and unpaired markers", () => {
    const markers = extractGeneratedMarkers(
      [
        "<!-- skillset:generated:end reversed -->",
        "<!-- skillset:generated:start Bad_ID -->",
        "<!-- skillset:generated:start nested -->",
        "<!-- skillset:generated:end wrong -->",
        "<!-- skillset:generated:start Bad_ID -->",
      ].join("\n")
    );

    expect(validateGeneratedMarkers(markers)).toEqual([
      { id: "reversed", kind: "unexpected-end", line: 1 },
      { id: "Bad_ID", kind: "invalid-id", line: 2 },
      { expectedId: "Bad_ID", id: "nested", kind: "nested-start", line: 3 },
      { expectedId: "Bad_ID", id: "wrong", kind: "mismatched-end", line: 4 },
      { id: "Bad_ID", kind: "invalid-id", line: 5 },
      { id: "Bad_ID", kind: "duplicate-id", line: 5 },
      { id: "Bad_ID", kind: "unclosed-start", line: 5 },
    ]);
  });

  test("reports marker comments with missing block IDs", () => {
    expect(
      validateGeneratedMarkers(
        extractGeneratedMarkers("<!-- skillset:generated:start -->")
      )
    ).toEqual([{ id: "start", kind: "invalid-syntax", line: 1 }]);
    expect(
      validateGeneratedMarkers(
        extractGeneratedMarkers(
          "<!-- skillset:generated:start block extra -->\n<!-- skillset:generated:begin block -->"
        )
      )
    ).toEqual([
      { id: "start block extra", kind: "invalid-syntax", line: 1 },
      { id: "begin block", kind: "invalid-syntax", line: 2 },
    ]);
  });

  test("reports unterminated marker comments and keeps them visible after invalid fences", () => {
    const markers = extractGeneratedMarkers(
      [
        "``` invalid`info",
        "<!-- skillset:generated:start visible -->",
        "<!-- skillset:generated:end visible -->",
        "<!-- skillset:generated:start unterminated",
      ].join("\n")
    );

    expect(markers).toEqual([
      { id: "visible", kind: "start", line: 2 },
      { id: "visible", kind: "end", line: 3 },
      { id: "start unterminated", kind: "invalid", line: 4 },
    ]);
    expect(validateGeneratedMarkers(markers)).toEqual([
      { id: "start unterminated", kind: "invalid-syntax", line: 4 },
    ]);
  });

  test("replaces exactly one block body and preserves all surrounding bytes", () => {
    const source = [
      "prefix  ",
      "<!-- feature-support:start -->",
      "legacy",
      "<!-- feature-support:end -->",
      "<!-- skillset:generated:start cli-reference -->",
      "old body",
      "<!-- skillset:generated:end cli-reference -->",
      "suffix\t",
    ].join("\n");

    expect(replaceGeneratedBlock(source, "cli-reference", "\nnew body\n")).toBe(
      [
        "prefix  ",
        "<!-- feature-support:start -->",
        "legacy",
        "<!-- feature-support:end -->",
        "<!-- skillset:generated:start cli-reference -->",
        "new body",
        "<!-- skillset:generated:end cli-reference -->",
        "suffix\t",
      ].join("\n")
    );
  });

  test("rejects missing, invalid, duplicate, nested, and mismatched blocks", () => {
    expect(() => replaceGeneratedBlock("plain", "missing", "body")).toThrow(
      "expected exactly one generated block: missing"
    );
    expect(() => replaceGeneratedBlock("plain", "Bad_ID", "body")).toThrow(
      "invalid generated block ID: Bad_ID"
    );

    const invalidSources = [
      [
        "<!-- skillset:generated:start same -->",
        "<!-- skillset:generated:end same -->",
        "<!-- skillset:generated:start same -->",
        "<!-- skillset:generated:end same -->",
      ].join("\n"),
      [
        "<!-- skillset:generated:start outer -->",
        "<!-- skillset:generated:start inner -->",
        "<!-- skillset:generated:end outer -->",
      ].join("\n"),
      [
        "<!-- skillset:generated:start target -->",
        "<!-- skillset:generated:end wrong -->",
      ].join("\n"),
      "<!-- skillset:generated:start target extra -->",
    ];
    for (const invalidSource of invalidSources) {
      expect(() =>
        replaceGeneratedBlock(invalidSource, "target", "body")
      ).toThrow("invalid generated markers:");
    }
  });
});
