import { describe, expect, test } from "bun:test";

import {
  stringifyYamlSourceDocument,
  updateMarkdownSourceDocument,
  updateYamlSourceDocument,
} from "../source-document";
import { parseMarkdown } from "../yaml";

describe("authored source document writes", () => {
  test("moves root skillset first while preserving other order and comments", () => {
    const source = [
      "# heading",
      'description: "keep style" # description note',
      "custom:",
      "  beta: 2 # beta note",
      "  alpha: 1",
      "skillset:",
      "  # name note",
      "  name: demo",
      "tail: true # tail note",
      "",
    ].join("\n");

    const updated = updateYamlSourceDocument(source, "fixture.yaml", (current) => ({
      ...current,
      skillset: {
        ...(current.skillset as Record<string, unknown>),
        origin: { path: "fixture.yaml" },
      },
    }));

    expect(updated.startsWith("skillset:\n  # name note\n  name: demo\n")).toBe(true);
    expect(updated).toContain('# heading\ndescription: "keep style" # description note');
    expect(updated).toContain("beta: 2 # beta note\n  alpha: 1");
    expect(updated).toContain("tail: true # tail note");
    expect(updated.indexOf("description:")).toBeLessThan(updated.indexOf("custom:"));
    expect(updated.indexOf("custom:")).toBeLessThan(updated.indexOf("tail:"));
  });

  test("returns a no-op YAML update byte-for-byte", () => {
    const source = "custom: [a,b]\r\nskillset: { name: demo }\r\n";
    expect(updateYamlSourceDocument(source, "fixture.yaml", (current) => current)).toBe(source);
  });

  test("keeps frontmatter bytes unchanged for body-only Markdown updates", () => {
    const source = [
      "---\r\n",
      "# frontmatter note\r\n",
      'description: "keep style"\r\n',
      "custom: [a,b]\r\n",
      "---\r\n",
      "\r\n",
      "Old body.\r\n",
    ].join("");
    const prefix = source.slice(0, source.indexOf("Old body."));

    const updated = updateMarkdownSourceDocument(source, "fixture.md", (current) => ({
      ...current,
      body: "New body.",
    }));

    expect(updated.slice(0, updated.indexOf("New body."))).toBe(prefix);
    expect(updated).toEndWith("New body.\n");
  });

  test("keeps mixed frontmatter delimiter framing intact for body-only Markdown updates", () => {
    const source = "---\r\nname: demo\n---\n\nOld body.\n";
    const prefix = source.slice(0, source.indexOf("Old body."));

    const updated = updateMarkdownSourceDocument(source, "fixture.md", (current) => ({
      ...current,
      body: "New body.",
    }));

    expect(updated.slice(0, updated.indexOf("New body."))).toBe(prefix);
  });

  test.each(["\n", "\r\n"])("supports empty frontmatter with %p line endings", (eol) => {
    const source = `---${eol}---${eol}${eol}Old body.${eol}`;

    expect(updateMarkdownSourceDocument(source, "fixture.md", (current) => ({
      ...current,
      body: "New body.",
    }))).toBe(`---${eol}---${eol}${eol}New body.\n`);
  });

  test.each(["\n", "\r\n"])("adds metadata to empty frontmatter with %p line endings", (eol) => {
    const source = `---${eol}---${eol}${eol}Body.${eol}`;
    const updated = updateMarkdownSourceDocument(source, "fixture.md", (current) => ({
      ...current,
      frontmatter: { name: "demo" },
    }));

    expect(updated).toBe(`---${eol}name: demo${eol}---${eol}${eol}Body.${eol}`);
    expect(parseMarkdown(updated, "fixture.md").frontmatter).toEqual({ name: "demo" });
  });

  test("adds frontmatter to body-only Markdown without changing its body", () => {
    const source = "# Instructions\n\nKeep this body.\n";
    const updated = updateMarkdownSourceDocument(source, "fixture.md", (current) => ({
      ...current,
      frontmatter: { skillset: { origin: { path: "AGENTS.md" } } },
    }));

    expect(updated).toBe(
      "---\nskillset:\n  origin:\n    path: AGENTS.md\n---\n\n# Instructions\n\nKeep this body.\n"
    );
  });

  test("renders new authored YAML with skillset first and insertion order elsewhere", () => {
    expect(stringifyYamlSourceDocument({
      zeta: true,
      skillset: { name: "demo" },
      alpha: true,
    })).toBe("skillset:\n  name: demo\nzeta: true\nalpha: true\n");
  });
});
