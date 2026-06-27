import { describe, expect, test } from "bun:test";

import {
  createWorkbenchDiagnostic,
  formatWorkbenchDiagnostic,
  sortWorkbenchDiagnostics,
  summarizeWorkbenchDiagnostics,
} from "../index";
import type { WorkbenchDiagnostic } from "../types";

const diagnostic = (
  overrides: Partial<WorkbenchDiagnostic> = {}
): WorkbenchDiagnostic => createWorkbenchDiagnostic({
  location: { column: 3, line: 2, path: ".skillset/skills/demo/SKILL.md" },
  message: "Demo finding",
  ruleId: "skillset/demo",
  scope: "source",
  severity: "warning",
  subject: { kind: "skill", path: ".skillset/skills/demo/SKILL.md" },
  ...overrides,
});

describe("workbench diagnostics", () => {
  test("creates JSON-safe diagnostics with optional help and fix metadata", () => {
    const fix = { kind: "manual", message: "Update the source file." } as const;
    const help = ["Keep generated files out of source changes."];
    const location = { column: 3, line: 2, path: ".skillset/skills/demo/SKILL.md" };
    const subject = { kind: "skill", path: ".skillset/skills/demo/SKILL.md" };
    const found = diagnostic({
      fix,
      help,
      location,
      subject,
    });

    help.push("Input mutation should not affect the diagnostic.");
    location.line = 99;
    subject.path = "mutated.md";

    expect(JSON.parse(JSON.stringify(found))).toEqual(found);
    expect(found).toEqual({
      fix: { kind: "manual", message: "Update the source file." },
      help: ["Keep generated files out of source changes."],
      location: { column: 3, line: 2, path: ".skillset/skills/demo/SKILL.md" },
      message: "Demo finding",
      ruleId: "skillset/demo",
      scope: "source",
      severity: "warning",
      subject: { kind: "skill", path: ".skillset/skills/demo/SKILL.md" },
    });
  });

  test("sorts by path, line, column, scope, rule, subject, and message", () => {
    const unsorted = [
      diagnostic({ location: { line: 9, path: "b.md" }, message: "B" }),
      diagnostic({ location: { line: 3, path: "a.md" }, message: "C" }),
      diagnostic({ location: { line: 2, path: "a.md" }, message: "A" }),
      diagnostic({ location: { column: 1, line: 2, path: "a.md" }, message: "B" }),
    ];

    expect(sortWorkbenchDiagnostics(unsorted).map((found) => formatWorkbenchDiagnostic(found))).toEqual([
      "a.md:2:1: warning: skillset/demo: B",
      "a.md:2: warning: skillset/demo: A",
      "a.md:3: warning: skillset/demo: C",
      "b.md:9: warning: skillset/demo: B",
    ]);
  });

  test("sorts diagnostics without locations by subject path", () => {
    const unsorted = [
      createWorkbenchDiagnostic({
        message: "Demo finding",
        ruleId: "skillset/demo",
        scope: "source",
        severity: "warning",
        subject: { kind: "skill", path: "b.md" },
      }),
      createWorkbenchDiagnostic({
        message: "Demo finding",
        ruleId: "skillset/demo",
        scope: "source",
        severity: "warning",
        subject: { kind: "skill", path: "a.md" },
      }),
    ];
    const [first] = unsorted;
    if (first === undefined) throw new Error("Expected a diagnostic fixture.");

    expect(sortWorkbenchDiagnostics(unsorted).map((found) => found.subject.path)).toEqual([
      "a.md",
      "b.md",
    ]);
    expect(formatWorkbenchDiagnostic(first)).toBe("warning: skillset/demo: Demo finding");
  });

  test("summarizes severity counts and blocks success only on errors", () => {
    const result = summarizeWorkbenchDiagnostics([
      diagnostic({ severity: "info" }),
      diagnostic({ severity: "warning" }),
      diagnostic({ severity: "error" }),
    ]);

    expect(result.ok).toBe(false);
    expect(result.errorCount).toBe(1);
    expect(result.warningCount).toBe(1);
    expect(result.infoCount).toBe(1);
    expect(result.diagnostics).toHaveLength(3);

    expect(summarizeWorkbenchDiagnostics([diagnostic({ severity: "warning" })]).ok).toBe(true);
  });

  test("formats workspace-level diagnostics without a file location", () => {
    expect(
      formatWorkbenchDiagnostic(createWorkbenchDiagnostic({
        message: "Workspace issue",
        ruleId: "skillset/demo",
        scope: "workspace",
        severity: "warning",
        subject: { kind: "workspace", id: "root" },
      }))
    ).toBe("warning: skillset/demo: Workspace issue");
  });
});
