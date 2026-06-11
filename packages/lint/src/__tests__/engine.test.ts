import { describe, expect, test } from "bun:test";

import {
  lintRules,
  listLintRules,
  registerLintRule,
  runLintRules,
} from "../index";
import type { LintRule, LintSubject } from "../types";

const subject: LintSubject = {
  body: "Use the thing.",
  files: ["SKILL.md"],
  frontmatter: { name: "demo" },
  kind: "skill",
  path: ".skillset/skills/demo/SKILL.md",
};

const dummyRule = (overrides: Partial<LintRule> = {}): LintRule => ({
  check: (checked) => [
    {
      message: "dummy finding",
      path: checked.path,
      rule: overrides.name ?? "dummy",
      severity: overrides.severity ?? "warn",
    },
  ],
  description: "Always reports one diagnostic.",
  name: "dummy",
  severity: "warn",
  ...overrides,
});

describe("lint engine", () => {
  test("registry starts empty, registers, and rejects duplicates", () => {
    expect(listLintRules()).toEqual([]);

    const rule = dummyRule();
    registerLintRule(rule);
    expect(listLintRules()).toEqual([rule]);
    expect(() => registerLintRule(rule)).toThrow(
      "lint rule already registered: dummy"
    );

    lintRules.delete(rule.name);
    expect(listLintRules()).toEqual([]);
  });

  test("runLintRules runs explicit rules over subjects", () => {
    const diagnostics = runLintRules([subject], [dummyRule()]);
    expect(diagnostics).toEqual([
      {
        message: "dummy finding",
        path: subject.path,
        rule: "dummy",
        severity: "warn",
      },
    ]);
  });

  test("severity passes through per diagnostic", () => {
    const diagnostics = runLintRules(
      [subject],
      [dummyRule({ name: "hard", severity: "error" })]
    );
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.severity).toBe("error");
    expect(diagnostics[0]?.rule).toBe("hard");
  });

  test("runLintRules with no registered rules yields no diagnostics", () => {
    expect(runLintRules([subject])).toEqual([]);
  });
});
