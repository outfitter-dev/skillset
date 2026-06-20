import { describe, expect, test } from "bun:test";

import {
  workbenchDiagnosticFromLintDiagnostic,
  workbenchDiagnosticsFromLintDiagnostics,
  selectWorkbenchDiagnostics,
} from "../index";
import type { LintDiagnostic } from "@skillset/lint";
import type { WorkbenchLintDiagnosticInput } from "../lint-bridge";
import type { WorkbenchDiagnostic } from "../types";

describe("lint bridge", () => {
  test("maps lint diagnostics into Workbench diagnostics", () => {
    const lintDiagnostic = {
      guidance: {
        docs: ["docs/features/skills.md"],
        steps: ["Shorten the description."],
        summary: "Keep skill descriptions compact.",
      },
      line: 3,
      message: "Description is too long.",
      path: ".skillset/src/skills/demo/SKILL.md",
      rule: "skill-description-length",
      severity: "warn",
    } satisfies LintDiagnostic;
    const bridgeInput: WorkbenchLintDiagnosticInput = lintDiagnostic;
    const found = workbenchDiagnosticFromLintDiagnostic(bridgeInput);

    expect(found).toEqual({
      help: [
        "Keep skill descriptions compact.",
        "Shorten the description.",
        "docs/features/skills.md",
      ],
      location: { line: 3, path: ".skillset/src/skills/demo/SKILL.md" },
      message: "Description is too long.",
      ruleId: "lint/skill-description-length",
      scope: "source",
      severity: "warning",
      subject: { kind: "skill", path: ".skillset/src/skills/demo/SKILL.md" },
    } satisfies WorkbenchDiagnostic);
  });

  test("supports caller-provided scope, rule prefix, and subject", () => {
    const found = workbenchDiagnosticsFromLintDiagnostics(
      [
        {
          message: "Hook issue",
          path: ".skillset/src/plugins/demo/hooks/hooks.json",
          rule: "hook-target-incompatible",
          severity: "error",
        },
      ],
      {
        rulePrefix: "compat",
        scope: "provider",
        subject: { id: "demo", kind: "plugin", path: ".skillset/src/plugins/demo" },
      }
    );

    expect(found).toEqual([
      {
        location: { path: ".skillset/src/plugins/demo/hooks/hooks.json" },
        message: "Hook issue",
        ruleId: "compat/hook-target-incompatible",
        scope: "provider",
        severity: "error",
        subject: { id: "demo", kind: "plugin", path: ".skillset/src/plugins/demo" },
      },
    ]);
  });

  test("preserves lint code, feature identity, and rule level", () => {
    const found = workbenchDiagnosticFromLintDiagnostic(
      {
        code: "missing-fallback",
        featureId: "standalone-skills",
        message: "Missing fallback.",
        path: ".skillset/src/skills/demo/SKILL.md",
        rule: "skill-env-var-no-fallback",
        severity: "warn",
      },
      { ruleLevel: "strict" }
    );

    expect(found).toMatchObject({
      featureId: "standalone-skills",
      ruleId: "lint/skill-env-var-no-fallback:missing-fallback",
      ruleLevel: "strict",
    } satisfies Partial<WorkbenchDiagnostic>);
    expect(selectWorkbenchDiagnostics([found], { preset: "standard" })).toEqual([]);
    expect(selectWorkbenchDiagnostics([found], { preset: "strict" })).toEqual([found]);
  });

  test("omits help when lint guidance is absent", () => {
    const found = workbenchDiagnosticFromLintDiagnostic({
      message: "Missing name.",
      path: ".skillset/src/skills/demo/SKILL.md",
      rule: "skill-name-required",
      severity: "error",
    });

    expect(found.help).toBeUndefined();
    expect(found.severity).toBe("error");
    expect(found.ruleId).toBe("lint/skill-name-required");
  });
});
