import { describe, expect, test } from "bun:test";

import { ruleAppliesTo, ruleSectionTagName } from "../render-rules";
import { targetRecord } from "../targets";
import type { JsonRecord, SourceRule } from "../types";

function rule(relativePath: string, frontmatter: JsonRecord = {}): SourceRule {
  const segments = relativePath.split("/").slice(0, -1);
  return {
    body: "",
    frontmatter,
    id: relativePath.replace(/\.md$/u, ""),
    relativePath,
    scopeDir: segments.join("/"),
    scopeSegments: segments,
    segments: segments.map((value) => ({
      classification: value === "[.]" ? "one-level" : value === "[...]" ? "any-depth" : "literal",
      value,
    })),
    sourcePath: `/repo/.skillset/rules/${relativePath}`,
    targets: targetRecord(() => ({ enabled: true, options: {} })),
  };
}

describe("AGENTS.md section derivation [SET-583]", () => {
  test("sanitizes tag names from the filename stem or frontmatter name", () => {
    expect(ruleSectionTagName(rule("engineering/coding-guidance.md"))).toBe("coding_guidance");
    expect(ruleSectionTagName(rule("2024-notes.md"))).toBe("_2024_notes");
    expect(ruleSectionTagName(rule("My.Rule_v2.md"))).toBe("my_rule_v2");
    expect(ruleSectionTagName(rule("---.md"))).toBe("rule");
    expect(ruleSectionTagName(rule("docs/writing.md", { name: "Docs Writing" }))).toBe("docs_writing");
  });

  test("derives applies_to from scope and relative paths: (decision 81 worked examples)", () => {
    expect(ruleAppliesTo(rule("engineering/coding-guidance.md"))).toBe("engineering/**");
    expect(ruleAppliesTo(rule("engineering/coding-guidance.md", { paths: ["**/*.ts"] }))).toBe(
      "engineering/**/*.ts"
    );
    expect(ruleAppliesTo(rule("docs/writing.md", { paths: ["guides/**/*.md", "*.md"] }))).toBe(
      "docs/*.md, docs/guides/**/*.md"
    );
    expect(ruleAppliesTo(rule("app/[slug]/routing.md"))).toBe("app/[slug]/**");
    expect(ruleAppliesTo(rule("testing.md"))).toBe("**");
    expect(ruleAppliesTo(rule("docs/writing.md", { paths: ["{a,b}/*.md"] }))).toBe("docs/{a,b}/*.md");
  });

  test("refuses to describe an unexpanded wildcard scope", () => {
    expect(() => ruleAppliesTo(rule("apps/[.]/src/testing.md"))).toThrow("unexpanded wildcard scope");
  });
});
