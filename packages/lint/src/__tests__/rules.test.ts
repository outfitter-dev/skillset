import { describe, expect, test } from "bun:test";

import {
  skillDescriptionHtmlTokenRule,
  skillDescriptionLengthRule,
  skillDescriptionStrictYamlRule,
  skillNameDirectoryMismatchRule,
} from "../rules";
import type { LintSubject } from "../types";

const makeSubject = (overrides: Partial<LintSubject> = {}): LintSubject => ({
  body: "Use the thing.",
  directoryName: "demo",
  files: ["SKILL.md"],
  frontmatter: { description: "Demo skill.", name: "demo" },
  kind: "skill",
  path: ".skillset/src/skills/demo/SKILL.md",
  raw: "---\nname: demo\ndescription: Demo skill.\n---\n\nUse the thing.\n",
  ...overrides,
});

describe("skill-description-length", () => {
  test("flags descriptions longer than 1024 characters with the actual length", () => {
    const description = "x".repeat(1100);
    const diagnostics = skillDescriptionLengthRule.check(
      makeSubject({ frontmatter: { description } })
    );
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.rule).toBe("skill-description-length");
    expect(diagnostics[0]?.severity).toBe("error");
    expect(diagnostics[0]?.message).toContain("1100");
    expect(diagnostics[0]?.guidance?.summary).toContain("Shorten");
  });

  test("counts code points, not UTF-16 units", () => {
    // 1024 emoji are 2048 UTF-16 units but exactly 1024 spread elements.
    const description = "😀".repeat(1024);
    expect(
      skillDescriptionLengthRule.check(
        makeSubject({ frontmatter: { description } })
      )
    ).toEqual([]);
  });

  test("passes at exactly 1024 characters and with no description", () => {
    expect(
      skillDescriptionLengthRule.check(
        makeSubject({ frontmatter: { description: "x".repeat(1024) } })
      )
    ).toEqual([]);
    expect(
      skillDescriptionLengthRule.check(makeSubject({ frontmatter: {} }))
    ).toEqual([]);
  });
});

describe("skill-description-html-token", () => {
  test("flags a bare angle-bracket token", () => {
    const diagnostics = skillDescriptionHtmlTokenRule.check(
      makeSubject({
        frontmatter: { description: "Wraps output in <task> blocks." },
      })
    );
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.rule).toBe("skill-description-html-token");
    expect(diagnostics[0]?.severity).toBe("error");
    expect(diagnostics[0]?.message).toContain("<task>");
    expect(diagnostics[0]?.guidance?.summary).toContain("Backtick-wrap");
  });

  test("ignores tokens inside backtick spans", () => {
    expect(
      skillDescriptionHtmlTokenRule.check(
        makeSubject({
          frontmatter: { description: "Wraps output in `<task>` blocks." },
        })
      )
    ).toEqual([]);
  });

  test("ignores comparisons and non-tag angle brackets", () => {
    expect(
      skillDescriptionHtmlTokenRule.check(
        makeSubject({
          frontmatter: { description: "Use when count < 10 or x > y." },
        })
      )
    ).toEqual([]);
  });
});

describe("skill-description-strict-yaml", () => {
  test("flags an unquoted value containing colon-space", () => {
    const raw =
      "---\nname: demo\ndescription: Use this: it helps.\n---\n\nBody.\n";
    const diagnostics = skillDescriptionStrictYamlRule.check(
      makeSubject({ raw })
    );
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.rule).toBe("skill-description-strict-yaml");
    expect(diagnostics[0]?.severity).toBe("error");
    expect(diagnostics[0]?.guidance?.summary).toContain("js-yaml");
  });

  test("passes quoted and block-scalar values", () => {
    for (const line of [
      'description: "Use this: it helps."',
      "description: 'Use this: it helps.'",
      "description: |",
      "description: >-",
    ]) {
      const raw = `---\nname: demo\n${line}\n  Use this: it helps.\n---\n\nBody.\n`;
      expect(
        skillDescriptionStrictYamlRule.check(makeSubject({ raw }))
      ).toEqual([]);
    }
  });

  test("passes absent descriptions and values without colon-space", () => {
    expect(
      skillDescriptionStrictYamlRule.check(
        makeSubject({ raw: "---\nname: demo\n---\n\nBody.\n" })
      )
    ).toEqual([]);
    expect(
      skillDescriptionStrictYamlRule.check(
        makeSubject({
          raw: "---\ndescription: Plain text with a colon:in-word.\n---\n\nBody.\n",
        })
      )
    ).toEqual([]);
  });
});

describe("skill-name-directory-mismatch", () => {
  test("flags a frontmatter name that differs from the directory", () => {
    const diagnostics = skillNameDirectoryMismatchRule.check(
      makeSubject({ directoryName: "demo", frontmatter: { name: "other" } })
    );
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.rule).toBe("skill-name-directory-mismatch");
    expect(diagnostics[0]?.severity).toBe("error");
    expect(diagnostics[0]?.message).toContain("other");
    expect(diagnostics[0]?.message).toContain("demo");
  });

  test("passes matching names and skills without a frontmatter name", () => {
    expect(
      skillNameDirectoryMismatchRule.check(
        makeSubject({ directoryName: "demo", frontmatter: { name: "demo" } })
      )
    ).toEqual([]);
    expect(
      skillNameDirectoryMismatchRule.check(makeSubject({ frontmatter: {} }))
    ).toEqual([]);
  });
});
