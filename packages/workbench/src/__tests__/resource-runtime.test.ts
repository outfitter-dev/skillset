import { describe, expect, test } from "bun:test";
import type {
  LintIssue,
  SkillsetFeatureEntry,
} from "@skillset/core";

import {
  formatWorkbenchDiagnostic,
  selectWorkbenchDiagnostics,
  workbenchDiagnosticsFromResourceLintIssues,
  workbenchDiagnosticsFromRuntimeSupport,
} from "../index";

describe("resource and runtime diagnostics", () => {
  test("maps only resource lint issues into resource diagnostics", () => {
    const issues = [
      {
        code: "hook-target-incompatible",
        featureId: "plugin-hooks",
        message: "Hook cannot render for codex.",
        path: ".skillset/src/plugins/demo/hooks/hooks.json",
        severity: "error",
      },
      {
        code: "resource-undeclared-link",
        featureId: "resources",
        message: ".skillset/src/skills/demo/SKILL.md links to undeclared resource ./scripts/run.sh",
        path: ".skillset/src/skills/demo/SKILL.md",
        severity: "error",
      },
      {
        code: "resource-script-not-executable",
        featureId: "resources",
        message: "Script resource is not executable.",
        path: ".skillset/src/skills/demo/SKILL.md",
        severity: "warn",
      },
    ] satisfies readonly LintIssue[];

    const diagnostics = workbenchDiagnosticsFromResourceLintIssues(issues);

    expect(diagnostics.map(formatWorkbenchDiagnostic)).toEqual([
      ".skillset/src/skills/demo/SKILL.md: warning: resource/resource-script-not-executable: Script resource is not executable.",
      ".skillset/src/skills/demo/SKILL.md: error: resource/resource-undeclared-link: .skillset/src/skills/demo/SKILL.md links to undeclared resource ./scripts/run.sh",
    ]);
    expect(diagnostics.every((diagnostic) => diagnostic.scope === "resource")).toBeTrue();
    expect(diagnostics.every((diagnostic) => diagnostic.subject.kind === "resource")).toBeTrue();
  });

  test("accepts resource diagnostics identified by legacy resource codes", () => {
    const diagnostics = workbenchDiagnosticsFromResourceLintIssues([
      {
        code: "skill-plugin-root-script",
        message: "Skill links to plugin-root script path.",
        path: ".skillset/src/plugins/demo/skills/tool/SKILL.md",
        severity: "error",
      },
    ]);

    expect(formatWorkbenchDiagnostic(diagnostics[0]!)).toBe(
      ".skillset/src/plugins/demo/skills/tool/SKILL.md: error: resource/skill-plugin-root-script: Skill links to plugin-root script path."
    );
  });

  test("maps explicit runtime diagnostics and keeps caveats as help", () => {
    const diagnostics = workbenchDiagnosticsFromRuntimeSupport(
      [
        feature({
          id: "project-agents",
          runtimeSupport: {
            "codex-cli": {
              caveats: ["Skill loading is instruction-guided rather than runtime-enforced."],
              diagnostics: ["Skill-loading intent is not enforced by Codex metadata."],
              evidence: [{ kind: "docs", ref: "docs/features/agents.md" }],
              mechanism: "Render a deterministic instruction preface.",
              status: "shimmed",
            },
            "claude-code": {
              mechanism: "Claude reads project agents natively.",
              status: "native",
            },
          },
        }),
      ],
      { locationPath: "docs/features/runtime-adapters.md" }
    );

    expect(diagnostics.map(formatWorkbenchDiagnostic)).toEqual([
      "docs/features/runtime-adapters.md: warning: runtime/shimmed: codex-cli project-agents: Skill-loading intent is not enforced by Codex metadata.",
    ]);
    expect(diagnostics[0]).toMatchObject({
      featureId: "project-agents",
      help: [
        "Mechanism: Render a deterministic instruction preface.",
        "Caveat: Skill loading is instruction-guided rather than runtime-enforced.",
        "Evidence: docs docs/features/agents.md",
      ],
      scope: "runtime",
      subject: {
        id: "project-agents:codex-cli",
        kind: "runtime-support",
      },
    });
  });

  test("filters runtime diagnostics by runtime and participates in standard selection", () => {
    const diagnostics = workbenchDiagnosticsFromRuntimeSupport(
      [
        feature({
          id: "runtime-adapters",
          runtimeSupport: {
            "codex-cli": {
              diagnostics: ["Codex diagnostic."],
              status: "native",
            },
            "gemini-cli": {
              diagnostics: ["Gemini diagnostic."],
              reason: "Gemini adapter is planned.",
              setup: ["Install Gemini CLI separately."],
              status: "planned",
            },
          },
        }),
      ],
      { runtimes: ["gemini-cli"] }
    );

    expect(diagnostics.map(formatWorkbenchDiagnostic)).toEqual([
      "warning: runtime/planned: gemini-cli runtime-adapters: Gemini diagnostic.",
    ]);
    expect(diagnostics[0]?.help).toEqual([
      "Reason: Gemini adapter is planned.",
      "Setup: Install Gemini CLI separately.",
    ]);
    expect(selectWorkbenchDiagnostics(diagnostics, { preset: "standard" })).toEqual(diagnostics);
  });
});

function feature(
  overrides: Pick<SkillsetFeatureEntry, "id"> &
    Partial<Omit<SkillsetFeatureEntry, "id">>
): SkillsetFeatureEntry {
  const { id, ...rest } = overrides;
  return {
    docs: ["docs/features/test.md"],
    evidence: [],
    id,
    kind: "workflow",
    renderOwner: "packages/core/src/test.ts",
    sourceShape: ".skillset/src/test",
    status: "implemented",
    summary: "Test feature.",
    targetSupport: {
      claude: { status: "native" },
      codex: { status: "native" },
    },
    title: "Test Feature",
    validationOwner: "packages/core/src/test.ts",
    ...rest,
  };
}
