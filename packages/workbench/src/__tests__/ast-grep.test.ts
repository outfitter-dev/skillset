import { describe, expect, test } from "bun:test";

import {
  formatWorkbenchDiagnostic,
  probeAstGrepAvailability,
  selectWorkbenchDiagnostics,
  workbenchDiagnosticsFromAstGrepMatches,
} from "../index";

describe("workbench ast-grep adapter", () => {
  test("maps explicit ast-grep matches into Workbench diagnostics", () => {
    const diagnostics = workbenchDiagnosticsFromAstGrepMatches({
      matches: [
        {
          column: 9,
          endColumn: 31,
          endLine: 12,
          file: ".skillset/hooks/scripts/check.ts",
          line: 12,
          text: "process.exit(1)",
        },
      ],
      rule: {
        id: "runtime.no-process-exit",
        message: "Avoid process.exit in hook helper scripts; return a status through the hook runner.",
        ruleLevel: "strict",
        scope: "runtime",
        severity: "warning",
        subjectKind: "script",
      },
    });

    expect(diagnostics.map(formatWorkbenchDiagnostic)).toEqual([
      ".skillset/hooks/scripts/check.ts:12:9: warning: ast-grep/runtime.no-process-exit: Avoid process.exit in hook helper scripts; return a status through the hook runner.",
    ]);
    expect(diagnostics[0]).toMatchObject({
      help: ["Match: process.exit(1)"],
      location: {
        column: 9,
        endColumn: 31,
        endLine: 12,
        line: 12,
        path: ".skillset/hooks/scripts/check.ts",
      },
      ruleLevel: "strict",
      scope: "runtime",
      subject: {
        kind: "script",
        path: ".skillset/hooks/scripts/check.ts",
      },
    });
    expect(selectWorkbenchDiagnostics(diagnostics, { preset: "standard" })).toEqual([]);
    expect(selectWorkbenchDiagnostics(diagnostics, { preset: "strict" })).toEqual(diagnostics);
  });

  test("sorts multiple ast-grep matches deterministically", () => {
    const diagnostics = workbenchDiagnosticsFromAstGrepMatches({
      matches: [
        { file: "scripts/b.ts", line: 1, text: "process.exit(1)" },
        { file: "scripts/a.ts", line: 8, text: "process.exit(2)" },
      ],
      rule: {
        id: "runtime.no-process-exit",
        message: "Avoid process.exit in helper scripts.",
        scope: "runtime",
        severity: "warning",
        subjectKind: "script",
      },
    });

    expect(diagnostics.map((diagnostic) => diagnostic.location?.path)).toEqual([
      "scripts/a.ts",
      "scripts/b.ts",
    ]);
  });

  test("availability probe is explicit and reports missing binaries without throwing", async () => {
    const availability = await probeAstGrepAvailability("definitely-missing-skillset-ast-grep");

    expect(availability).toEqual({ ok: false });
  });
});
