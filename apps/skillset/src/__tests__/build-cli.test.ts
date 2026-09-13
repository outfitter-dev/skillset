import { describe, expect, it } from "bun:test";

import type { SkillsetRenderResult } from "@skillset/core";

import { formatDiffPathForPresentation } from "../build-cli";

describe("SET-406 diff projection identity", () => {
  it("explains a shared standard baseline and provider delta at one path", () => {
    const path = ".agents/skills/review/SKILL.md";
    const outcomes: readonly SkillsetRenderResult[] = [
      {
        featureId: "standalone-skills",
        outputs: [{ path }],
        schema: "skillset-render-result@2",
        sourceUnit: "skill:review",
        standardProfile: "agent-skills",
        status: "rendered",
      },
      {
        featureId: "standalone-skills",
        outputs: [{ path }],
        schema: "skillset-render-result@2",
        sourceUnit: "skill:review",
        status: "rendered",
        target: "codex",
      },
    ];

    expect(formatDiffPathForPresentation(path, outcomes)).toBe(
      ".agents/skills/review/SKILL.md [agent-skills baseline + codex delta]"
    );
  });

  it("keeps independent provider output labeled as provider output", () => {
    const path = "plugins/review/claude/.claude-plugin/plugin.json";
    expect(
      formatDiffPathForPresentation(path, [
        {
          featureId: "plugin-manifests",
          outputs: [{ path }],
          schema: "skillset-render-result@2",
          sourceUnit: "plugin:review",
          status: "rendered",
          target: "claude",
        },
      ])
    ).toBe(`${path} [claude]`);
  });
});
