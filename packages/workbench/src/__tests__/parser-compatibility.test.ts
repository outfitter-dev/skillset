import { describe, expect, test } from "bun:test";

import {
  renderValidatedToml,
  validateGeneratedStructuredOutput,
} from "@skillset/core/internal/structured-output";
import {
  parseMarkdown,
  parseYamlRecord,
  stringifyMarkdown,
} from "@skillset/core/internal/yaml";

import { parseWorkbenchDocument } from "../index";

describe("compiler and Workbench parser compatibility", () => {
  test("preserves YAML 1.2 strings and typed scalars through generated frontmatter", () => {
    const frontmatter =
      'yes: yes\nno: no\non: on\noff: off\ny: y\nY: Y\nnumber: "0123"\ncolon: "value:"\nbracket: "[value"\nbrace: "{value"\nenabled: true\ndisabled: false\ncount: 2\n';
    const expected = {
      yes: "yes",
      no: "no",
      on: "on",
      off: "off",
      y: "y",
      Y: "Y",
      number: "0123",
      colon: "value:",
      bracket: "[value",
      brace: "{value",
      enabled: true,
      disabled: false,
      count: 2,
    };
    expect(parseYamlRecord(frontmatter, "SKILL.md")).toEqual(expected);
    const rendered = stringifyMarkdown(expected, "# Body\n");
    for (const content of [`---\n${frontmatter}---\n\n# Body\n`, rendered]) {
      expect(parseMarkdown(content, "SKILL.md").frontmatter).toEqual(expected);
      const workbench = parseWorkbenchDocument({ content, path: "SKILL.md" });
      expect(workbench.kind).toBe("markdown");
      if (workbench.kind !== "markdown") throw new Error("expected Markdown");
      expect(workbench.diagnostics).toEqual([]);
      expect(workbench.frontmatter).toEqual(expected);
    }
    expect(
      stringifyMarkdown(
        parseMarkdown(rendered, "SKILL.md").frontmatter,
        "# Body\n"
      )
    ).toBe(rendered);
  });

  test("preserves anchors and block scalar chomping in both YAML parsers", () => {
    const content =
      "first: &base\n  value: yes\nsecond: *base\nkeep: |\n  first\n  second\nstrip: |-\n  first\n  second\n";
    const expected = {
      first: { value: "yes" },
      second: { value: "yes" },
      keep: "first\nsecond\n",
      strip: "first\nsecond",
    };
    expect(parseYamlRecord(content, "skillset.yaml")).toEqual(expected);
    const parsed = parseWorkbenchDocument({ content, path: "skillset.yaml" });
    expect(parsed.kind).toBe("yaml");
    if (parsed.kind !== "yaml") throw new Error("expected YAML");
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.data).toEqual(expected);
  });

  test("rejects tab indentation with source diagnostics", () => {
    const content = "value:\n\tchild: false\n";
    expect(() => parseYamlRecord(content, "skillset.yaml")).toThrow(
      "skillset.yaml is not valid YAML"
    );
    expect(
      parseWorkbenchDocument({ content, path: "skillset.yaml" }).diagnostics
    ).toContainEqual(
      expect.objectContaining({
        ruleId: "syntax/yaml",
        severity: "error",
        location: expect.objectContaining({ path: "skillset.yaml" }),
      })
    );
  });

  test("generated TOML preserves boolean, numeric and string types", () => {
    const expected = {
      text: "yes",
      enabled: true,
      count: 2,
      agent: {
        prompt: "line one\nline two",
        items: ["0123", "value:", "[value", "{value"],
      },
    };
    const content = renderValidatedToml(expected, "agent.toml");
    const parsed = parseWorkbenchDocument({ content, path: "agent.toml" });
    expect(parsed.kind).toBe("toml");
    if (parsed.kind !== "toml") throw new Error("expected TOML");
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.data).toEqual(expected);
    expect(content).toContain("enabled = true\n");
    expect(content).toContain("count = 2\n");
  });

  test.each([
    ["agent.toml", "[broken\nkey = true\n", "TOML", "syntax/toml"],
    ["config.json", '{"enabled":}', "JSON", "syntax/json"],
  ])(
    "invalid %s retains source and target labels",
    (targetPath, content, kind, ruleId) => {
      expect(() =>
        validateGeneratedStructuredOutput({
          content,
          sourcePath: "source.md",
          targetPath,
        })
      ).toThrow(
        `invalid generated output: source.md -> ${targetPath} ${kind} parse error:`
      );
      expect(
        parseWorkbenchDocument({ content, path: targetPath }).diagnostics
      ).toContainEqual(
        expect.objectContaining({
          ruleId,
          severity: "error",
          location: expect.objectContaining({ path: targetPath }),
        })
      );
    }
  );
});
