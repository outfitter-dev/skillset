import { describe, expect, test } from "bun:test";

import {
  checkWorkbenchSyntax,
  workbenchDiagnosticsFromMarkdownCodeFences,
  workbenchDiagnosticsFromMarkdownTemplatePlaceholders,
} from "../index";

describe("workbench Markdown diagnostics", () => {
  test("reports nested backtick fences that are as long as the outer fence", () => {
    const diagnostics = checkWorkbenchSyntax({
      content: [
        "# Skill",
        "",
        "```markdown",
        "Use this example:",
        "```ts",
        "console.log('hello');",
        "```",
        "```",
        "",
      ].join("\n"),
      path: ".skillset/skills/docs/SKILL.md",
    });

    expect(diagnostics).toEqual([
      expect.objectContaining({
        fix: {
          kind: "manual",
          message: "Use at least 4 backticks for the outer fence.",
        },
        location: expect.objectContaining({
          endLine: 5,
          line: 3,
          path: ".skillset/skills/docs/SKILL.md",
        }),
        message:
          "outer 3-backtick fence is not long enough for inner 3-backtick fence on line 5",
        ruleId: "markdown/code-fence-nesting",
        ruleLevel: "standard",
        scope: "source",
        severity: "warning",
        subject: { kind: "markdown", path: ".skillset/skills/docs/SKILL.md" },
      }),
    ]);
  });

  test("reports likely unlabeled inner fences in Markdown examples", () => {
    const diagnostics = checkWorkbenchSyntax({
      content: [
        "```markdown",
        "Use this example:",
        "```",
        "name: Demo",
        "```",
        "```",
        "",
      ].join("\n"),
      path: ".skillset/skills/docs/SKILL.md",
    });

    expect(diagnostics).toContainEqual(
      expect.objectContaining({
        location: expect.objectContaining({ endLine: 3, line: 1 }),
        message: "outer 3-backtick fence is not long enough for inner 3-backtick fence on line 3",
        ruleId: "markdown/code-fence-nesting",
      })
    );
  });

  test("reports unlabeled inner fences even when their first content line is blank", () => {
    const diagnostics = checkWorkbenchSyntax({
      content: [
        "```markdown",
        "Use this example:",
        "```",
        "",
        "name: Demo",
        "```",
        "```",
        "",
      ].join("\n"),
      path: ".skillset/skills/docs/SKILL.md",
    });

    expect(diagnostics).toContainEqual(
      expect.objectContaining({
        location: expect.objectContaining({ endLine: 3, line: 1 }),
        message: "outer 3-backtick fence is not long enough for inner 3-backtick fence on line 3",
        ruleId: "markdown/code-fence-nesting",
      })
    );
  });

  test("accepts outer fences that are longer than nested examples", () => {
    const diagnostics = workbenchDiagnosticsFromMarkdownCodeFences({
      content: [
        "````markdown",
        "Use this example:",
        "```ts",
        "console.log('hello');",
        "```",
        "````",
        "",
      ].join("\n"),
      path: ".skillset/skills/docs/references/example.md",
    });

    expect(diagnostics).toEqual([]);
  });

  test("checks reference and examples files without requiring a skill directory", () => {
    for (const path of ["REFERENCE.md", "EXAMPLES.md"]) {
      const diagnostics = workbenchDiagnosticsFromMarkdownCodeFences({
        content: [
          "```markdown",
          "Template:",
          "```yaml",
          "name: Demo",
          "```",
          "```",
          "",
        ].join("\n"),
        path,
      });

      expect(diagnostics).toContainEqual(
        expect.objectContaining({
          location: expect.objectContaining({ line: 1, path }),
          ruleId: "markdown/code-fence-nesting",
        })
      );
    }
  });

  test("checks docs paths through the syntax diagnostic surface", () => {
    const diagnostics = checkWorkbenchSyntax({
      content: [
        "```markdown",
        "Example:",
        "```yaml",
        "name: Demo",
        "```",
        "```",
        "",
      ].join("\n"),
      path: "docs/features/example.md",
    });

    expect(diagnostics).toContainEqual(
      expect.objectContaining({
        location: expect.objectContaining({ line: 1, path: "docs/features/example.md" }),
        ruleId: "markdown/code-fence-nesting",
      })
    );
  });

  test("does not report ordinary adjacent fenced blocks", () => {
    const diagnostics = checkWorkbenchSyntax({
      content: ["```ts", "one();", "```", "", "```ts", "two();", "```", ""].join("\n"),
      path: "SKILL.md",
    });

    expect(diagnostics).toEqual([]);
  });

  test("does not report a completed Markdown example followed by a plain block", () => {
    const diagnostics = checkWorkbenchSyntax({
      content: [
        "```markdown",
        "Use this example.",
        "```",
        "",
        "Then run:",
        "```",
        "skillset check",
        "```",
        "",
      ].join("\n"),
      path: "docs/features/example.md",
    });

    expect(diagnostics).toEqual([]);
  });

  test("does not report literal fence text inside non-Markdown code blocks", () => {
    const diagnostics = checkWorkbenchSyntax({
      content: [
        "```text",
        "This documentation literally mentions ```ts here.",
        "```ts",
        "```",
        "",
      ].join("\n"),
      path: "docs/features/example.md",
    });

    expect(diagnostics).toEqual([]);
  });

  test("does not treat invalid backtick info strings as fence openers", () => {
    const diagnostics = checkWorkbenchSyntax({
      content: [
        "``` ```",
        "not fenced",
        "```ts",
        "inside",
        "```",
        "",
      ].join("\n"),
      path: "SKILL.md",
    });

    expect(diagnostics).toEqual([]);
  });

  test("accepts supported template guidance placeholder forms", () => {
    const diagnostics = workbenchDiagnosticsFromMarkdownTemplatePlaceholders({
      content: [
        "Write the final answer to { Customer name }.",
        "Set the report title to [Project title].",
        "Skillset variables such as {{this.description}} are separate.",
        "",
      ].join("\n"),
      path: ".skillset/skills/templates/SKILL.md",
    });

    expect(diagnostics).toEqual([]);
  });

  test("reports empty template guidance placeholders", () => {
    const diagnostics = checkWorkbenchSyntax({
      content: [
        "# Template",
        "",
        "Write the account name as {   }.",
        "Set the optional note as [].",
        "",
      ].join("\n"),
      path: ".skillset/skills/templates/SKILL.md",
    });

    expect(diagnostics).toEqual([
      expect.objectContaining({
        location: expect.objectContaining({ column: 27, line: 3 }),
        message: "template guidance placeholder is empty",
        ruleId: "markdown/template-placeholder",
        ruleLevel: "standard",
        scope: "source",
        severity: "warning",
      }),
      expect.objectContaining({
        location: expect.objectContaining({ column: 26, line: 4 }),
        message: "template guidance placeholder is empty",
        ruleId: "markdown/template-placeholder",
      }),
    ]);
  });

  test("reports unclosed single-brace template guidance placeholders", () => {
    const diagnostics = checkWorkbenchSyntax({
      content: "Send the report to { Customer name\n",
      path: ".skillset/skills/templates/SKILL.md",
    });

    expect(diagnostics).toEqual([
      expect.objectContaining({
        location: expect.objectContaining({ column: 20, endColumn: 34, line: 1 }),
        message: "template guidance placeholder is missing }",
        ruleId: "markdown/template-placeholder",
      }),
    ]);
  });

  test("ignores template-looking examples inside code spans and fenced blocks", () => {
    const diagnostics = checkWorkbenchSyntax({
      content: [
        "`{   }` should be literal.",
        "``[]`` and ``{   }`` should also be literal.",
        "",
        "```markdown",
        "Write {   } in an example.",
        "```",
        "",
      ].join("\n"),
      path: ".skillset/skills/templates/SKILL.md",
    });

    expect(diagnostics).toEqual([]);
  });

  test("does not treat Markdown task list markers as template placeholders", () => {
    const diagnostics = checkWorkbenchSyntax({
      content: [
        "- [ ] finish task",
        "- [x] completed task",
        "1. [ ] ordered task",
        "- parent",
        "    - [ ] nested task",
        "1. parent",
        "    1. [ ] nested ordered task",
        "",
      ].join("\n"),
      path: ".skillset/skills/templates/SKILL.md",
    });

    expect(diagnostics).toEqual([]);
  });
});
