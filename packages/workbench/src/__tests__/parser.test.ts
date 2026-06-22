import { describe, expect, test } from "bun:test";

import {
  checkWorkbenchSyntax,
  inferWorkbenchParseKind,
  parseWorkbenchDocument,
} from "../index";

describe("workbench parser", () => {
  test("infers parse kinds from paths", () => {
    expect(inferWorkbenchParseKind("config.json")).toBe("json");
    expect(inferWorkbenchParseKind("skillset.lock")).toBe("json");
    expect(inferWorkbenchParseKind("SKILL.md")).toBe("markdown");
    expect(inferWorkbenchParseKind("notes.markdown")).toBe("markdown");
    expect(inferWorkbenchParseKind("agent.toml")).toBe("toml");
    expect(inferWorkbenchParseKind("skillset.yaml")).toBe("yaml");
    expect(inferWorkbenchParseKind("skillset.yml")).toBe("yaml");
    expect(inferWorkbenchParseKind("README.txt")).toBe("unknown");
  });

  test("parses valid JSON, YAML, and TOML with Bun-backed syntax checks", () => {
    expect(checkWorkbenchSyntax({ content: `{"name":"demo"}`, path: "demo.json" })).toEqual([]);
    expect(checkWorkbenchSyntax({ content: "name: demo\n", path: "demo.yaml" })).toEqual([]);
    expect(checkWorkbenchSyntax({ content: 'name = "demo"\n', path: "demo.toml" })).toEqual([]);

    const yamlParsed = parseWorkbenchDocument({ content: "name: demo\n", path: "demo.yaml" });
    expect(yamlParsed.kind).toBe("yaml");
    if (yamlParsed.kind !== "yaml") throw new Error("expected YAML parse result");
    expect(yamlParsed.data).toEqual({
      name: "demo",
    });

    const tomlParsed = parseWorkbenchDocument({ content: 'name = "demo"\n', path: "demo.toml" });
    expect(tomlParsed.kind).toBe("toml");
    if (tomlParsed.kind !== "toml") throw new Error("expected TOML parse result");
    expect(tomlParsed.data).toEqual({
      name: "demo",
    });
  });

  test("reports structured syntax diagnostics for invalid JSON, YAML, and TOML", () => {
    expect(
      checkWorkbenchSyntax({ content: `{\n  "name": "demo",\n  "description":\n}`, path: "demo.json" })
    ).toContainEqual(
      expect.objectContaining({
        location: expect.objectContaining({ line: 3, path: "demo.json" }),
        ruleId: "syntax/json",
        severity: "error",
      })
    );
    expect(checkWorkbenchSyntax({ content: "name: demo\nsummary: [\n", path: "demo.yaml" })).toContainEqual(
      expect.objectContaining({
        location: expect.objectContaining({ line: 2, path: "demo.yaml" }),
        ruleId: "syntax/yaml",
        severity: "error",
      })
    );
    expect(checkWorkbenchSyntax({ content: 'name = "demo"\nsummary =\n', path: "demo.toml" })).toContainEqual(
      expect.objectContaining({
        location: expect.objectContaining({ line: 2, path: "demo.toml" }),
        ruleId: "syntax/toml",
        severity: "error",
      })
    );
    expect(
      checkWorkbenchSyntax({ content: 'name = "demo"\n[section\nkey = 1\n', path: "demo.toml" })
    ).toContainEqual(
      expect.objectContaining({
        location: expect.objectContaining({ line: 3, path: "demo.toml" }),
        ruleId: "syntax/toml",
        severity: "error",
      })
    );
  });

  test("parses Markdown frontmatter, body, and headings with source line facts", () => {
    const parsed = parseWorkbenchDocument({
      content: `---\nname: demo\ndescription: Demo skill.\n---\n\n# Title\n\nText.\n\n\`\`\`\n# Ignored\n\`\`\`\n\n## Next\n`,
      path: "SKILL.md",
    });

    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.kind).toBe("markdown");
    if (parsed.kind !== "markdown") throw new Error("expected markdown parse result");
    expect(parsed.frontmatter).toEqual({
      description: "Demo skill.",
      name: "demo",
    });
    expect(parsed.bodyStartLine).toBe(5);
    expect(parsed.headings).toEqual([
      { depth: 1, line: 6, text: "Title" },
      { depth: 2, line: 14, text: "Next" },
    ]);
  });

  test("preserves heading text hashes unless they are a Markdown closing sequence", () => {
    const parsed = parseWorkbenchDocument({
      content: "# C#\n# Title###\n# Title ###\n",
      path: "README.md",
    });

    expect(parsed.kind).toBe("markdown");
    if (parsed.kind !== "markdown") throw new Error("expected markdown parse result");
    expect(parsed.headings).toEqual([
      { depth: 1, line: 1, text: "C#" },
      { depth: 1, line: 2, text: "Title###" },
      { depth: 1, line: 3, text: "Title" },
    ]);
  });

  test("ignores headings inside matching Markdown fences only", () => {
    const parsed = parseWorkbenchDocument({
      content:
        "````\n# ignored\n```\n# still ignored\n````\n# visible\n~~~\n# tilde ignored\n```\n# still tilde ignored\n~~~\n# also visible\n    ```\n# indented fence marker is visible\n```ts\n# hidden\n``` ts\n# still hidden\n```\n# final visible\n``` ```\n# invalid opening fence keeps this visible\n",
      path: "README.md",
    });

    expect(parsed.kind).toBe("markdown");
    if (parsed.kind !== "markdown") throw new Error("expected markdown parse result");
    expect(parsed.headings).toEqual([
      { depth: 1, line: 6, text: "visible" },
      { depth: 1, line: 12, text: "also visible" },
      { depth: 1, line: 14, text: "indented fence marker is visible" },
      { depth: 1, line: 20, text: "final visible" },
      { depth: 1, line: 22, text: "invalid opening fence keeps this visible" },
    ]);
  });

  test("reports Markdown frontmatter syntax diagnostics", () => {
    expect(checkWorkbenchSyntax({ content: "---\nname: demo\n", path: "SKILL.md" })).toEqual([
      expect.objectContaining({
        location: { line: 1, path: "SKILL.md" },
        ruleId: "syntax/markdown-frontmatter",
      }),
    ]);

    expect(checkWorkbenchSyntax({ content: "---\nname: [\n---\nBody\n", path: "SKILL.md" })).toEqual([
      expect.objectContaining({
        location: { line: 2, path: "SKILL.md" },
        ruleId: "syntax/markdown-frontmatter",
      }),
    ]);

    for (const frontmatter of ["- nope", "null", "42", "plain scalar"]) {
      expect(
        checkWorkbenchSyntax({ content: `---\n${frontmatter}\n---\nBody\n`, path: "SKILL.md" })
      ).toEqual([
        expect.objectContaining({
          location: { line: 2, path: "SKILL.md" },
          message: "frontmatter must be a YAML object",
          ruleId: "syntax/markdown-frontmatter",
        }),
      ]);
    }
  });

  test("accepts frontmatter delimiters with trailing whitespace", () => {
    const parsed = parseWorkbenchDocument({
      content: "---   \nname: demo\n---\t\n# Title\n",
      path: "SKILL.md",
    });

    expect(parsed.kind).toBe("markdown");
    if (parsed.kind !== "markdown") throw new Error("expected markdown parse result");
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.frontmatter).toEqual({ name: "demo" });
    expect(parsed.headings).toEqual([{ depth: 1, line: 4, text: "Title" }]);
  });
});
