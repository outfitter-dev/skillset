import { describe, expect, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { buildSkillsetResult, doctorSkillset } from "@skillset/core";
import { independentlyObservedOutputBaseline } from "@skillset/core/internal/output-safety";
import { loadBuildGraph } from "@skillset/core/internal/resolver";
import { validateGeneratedStructuredOutput } from "@skillset/core/internal/structured-output";
import { parseMarkdown, parseYamlRecord } from "@skillset/core/internal/yaml";
import { normalizeSkillsetFixtureFiles } from "../../../../scripts/test-helpers/skillset-config";
import { createTestGitFixtureRoot } from "../../../../scripts/test-helpers/git-remote";

const MALFORMED_MAPPING = "foo: bar: baz\n";
const VALID_WORKSPACE = `
skillset:
  name: yaml-syntax-root
claude: true
codex: false
cursor: false
`;
const VALID_SKILL = `
---
name: demo
description: Demo skill.
---

Body.
`;

describe("parseYamlRecord", () => {
  test("parses objects, empty documents, and null as records", () => {
    expect(parseYamlRecord("name: demo\n", "fixture.yaml")).toEqual({ name: "demo" });
    expect(parseYamlRecord("", "fixture.yaml")).toEqual({});
    expect(parseYamlRecord("null\n", "fixture.yaml")).toEqual({});
  });

  test("keeps the non-object shape error", () => {
    expect(() => parseYamlRecord("[]\n", "fixture.yaml")).toThrow(
      "skillset: expected fixture.yaml to contain a YAML object"
    );
    expect(() => parseYamlRecord("hello\n", "fixture.yaml")).toThrow(
      "skillset: expected fixture.yaml to contain a YAML object"
    );
  });

  test("prefixes syntax failures with the logical source path and keeps parser detail", () => {
    let caught: unknown;
    try {
      parseYamlRecord(MALFORMED_MAPPING, "skillset.yaml");
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(Error);
    const error = caught as Error;
    expect(error.message).toContain("skillset.yaml");
    expect(error.message).toContain("is not valid YAML");
    expect(error.message).toContain("line 1");
    expect(error.message).toContain("column 6");
    expect(error.message).toContain("foo: bar: baz");
    expect(error.message).toContain("^");
    expect(error.cause).toBeInstanceOf(Error);
    expect((error.cause as Error).message).toContain("line 1, column 6");
    expect(countOccurrences(error.message, "skillset.yaml")).toBe(1);
  });
});

describe("parseMarkdown frontmatter", () => {
  test("inherits YAML syntax source labels", () => {
    expect(() =>
      parseMarkdown("---\nname: demo\ndescription: [unclosed\n---\n\nBody.\n", "SKILL.md")
    ).toThrow(/SKILL\.md is not valid YAML:[\s\S]*line 2[\s\S]*column/);
  });

  test("keeps unclosed frontmatter, missing frontmatter, and empty frontmatter behavior", () => {
    expect(() => parseMarkdown("---\nname: demo\n", "SKILL.md")).toThrow(
      "skillset: frontmatter in SKILL.md starts with --- but never closes"
    );
    expect(parseMarkdown("# Body only\n", "SKILL.md")).toEqual({
      body: "# Body only\n",
      frontmatter: {},
    });
    expect(parseMarkdown("---\n---\n\nBody.\n", "SKILL.md")).toEqual({
      body: "\nBody.\n",
      frontmatter: {},
    });
  });
});

describe("structured generated-output validation", () => {
  test("does not double-prefix the YAML source path", () => {
    const sourcePath = ".skillset/plugins/demo/skillset.yaml";
    const targetPath = "plugins/demo/skillset.yaml";
    const label = `${sourcePath} -> ${targetPath}`;

    expect(() =>
      validateGeneratedStructuredOutput({
        content: MALFORMED_MAPPING,
        sourcePath,
        targetPath,
      })
    ).toThrow(new RegExp(`${escapeRegExp(label)}[\\s\\S]*line 1[\\s\\S]*column 6`));

    try {
      validateGeneratedStructuredOutput({
        content: MALFORMED_MAPPING,
        sourcePath,
        targetPath,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).toContain("invalid generated output");
      expect(countOccurrences(message, label)).toBe(1);
      expect(countOccurrences(message, sourcePath)).toBe(1);
      return;
    }
    throw new Error("expected structured output validation to fail");
  });
});

describe("workspace YAML syntax characterization", () => {
  test("malformed workspace config names skillset.yaml and keeps parser location", async () => {
    const root = await fixture({
      "skillset.yaml": MALFORMED_MAPPING,
      ".skillset/skills/demo/SKILL.md": VALID_SKILL,
    });

    await expect(loadBuildGraph(root)).rejects.toThrow(
      /skillset\.yaml is not valid YAML:[\s\S]*line 1[\s\S]*column 6/
    );
  });

  test("malformed skill frontmatter names its SKILL.md", async () => {
    const root = await fixture({
      "skillset.yaml": VALID_WORKSPACE,
      ".skillset/skills/demo/SKILL.md": `---\nname: demo\ndescription: [unclosed\n---\n\nBody.\n`,
    });

    await expect(loadBuildGraph(root)).rejects.toThrow(
      /SKILL\.md is not valid YAML:[\s\S]*line 2[\s\S]*column/
    );
  });

  test("output-safety recovery still observes a baseline when config YAML is malformed", async () => {
    const root = await fixture({
      "skillset.yaml": VALID_WORKSPACE,
      ".skillset/skills/demo/SKILL.md": VALID_SKILL,
    });
    await buildSkillsetResult(root);
    expect(await independentlyObservedOutputBaseline(root)).toBe(true);

    await writeFile(join(root, "skillset.yaml"), MALFORMED_MAPPING, "utf8");

    expect(await independentlyObservedOutputBaseline(root)).toBe(true);
    const report = await doctorSkillset(root);
    expect(report.ok).toBe(false);
    expect(report.buildError).toMatch(
      /skillset\.yaml is not valid YAML:[\s\S]*line 1[\s\S]*column 6/
    );
    expect(report.outputState.hasBaseline).toBe(true);
  });
});

async function fixture(files: Record<string, string>): Promise<string> {
  const disposableRoot = await createTestGitFixtureRoot("skillset-yaml-syntax-");
  const root = await mkdtemp(join(disposableRoot, "repo-"));
  for (const [path, content] of Object.entries(normalizeSkillsetFixtureFiles(files))) {
    await Bun.write(join(root, path), `${content.trim()}\n`);
  }
  return root;
}

function countOccurrences(value: string, fragment: string): number {
  let count = 0;
  let index = 0;
  while (index < value.length) {
    const next = value.indexOf(fragment, index);
    if (next === -1) break;
    count += 1;
    index = next + fragment.length;
  }
  return count;
}

function escapeRegExp(value: string): string {
  return value.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
