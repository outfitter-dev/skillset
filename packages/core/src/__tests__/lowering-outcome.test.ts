import { describe, expect, it } from "bun:test";

import {
  LOWERING_OUTCOME_SCHEMA,
  LOWERING_OUTCOME_STATUS_VALUES,
  defineLoweringOutcome,
  serializeLoweringOutcome,
  type SkillsetLoweringOutcome,
} from "@skillset/core";

describe("lowering outcomes", () => {
  it("normalizes to a stable JSON shape with sorted nested arrays", () => {
    const outcome = defineLoweringOutcome({
      diagnostics: [
        { code: "z-warning", path: ".skillset/src/z.md" },
        { code: "a-warning", message: "First." },
      ],
      evidence: [
        { kind: "test", ref: "b.test.ts" },
        { kind: "external-docs", ref: "https://example.com/docs", verifiedAt: "2026-06-12" },
      ],
      featureId: "project-instructions",
      outputs: [
        { kind: "rule", path: ".claude/rules/b.md" },
        { kind: "agents", path: "AGENTS.md" },
      ],
      policy: "default",
      sourcePath: ".skillset/instructions/root.md",
      sourceUnit: "instructions:root",
      status: "transformed",
      target: "codex",
    });

    expect(serializeLoweringOutcome(outcome)).toBe(`{
  "schema": "${LOWERING_OUTCOME_SCHEMA}",
  "sourceUnit": "instructions:root",
  "sourcePath": ".skillset/instructions/root.md",
  "featureId": "project-instructions",
  "target": "codex",
  "status": "transformed",
  "policy": "default",
  "outputs": [
    {
      "kind": "rule",
      "path": ".claude/rules/b.md"
    },
    {
      "kind": "agents",
      "path": "AGENTS.md"
    }
  ],
  "diagnostics": [
    {
      "code": "a-warning",
      "message": "First."
    },
    {
      "code": "z-warning",
      "path": ".skillset/src/z.md"
    }
  ],
  "evidence": [
    {
      "kind": "external-docs",
      "ref": "https://example.com/docs",
      "verifiedAt": "2026-06-12"
    },
    {
      "kind": "test",
      "ref": "b.test.ts"
    }
  ]
}
`);
  });

  it("does not require output paths for source-only or skipped outcomes", () => {
    const outcome = defineLoweringOutcome({
      featureId: "supports",
      policy: "scope:excluded",
      sourcePath: ".skillset/skills/demo/SKILL.md",
      sourceUnit: "skill:demo",
      status: "intentionally_skipped",
    });

    expect(outcome.outputs).toBeUndefined();
    expect(outcome.target).toBeUndefined();
    expect(serializeLoweringOutcome(outcome)).toContain('"status": "intentionally_skipped"');
  });

  it("can represent multiple outputs from one source unit", () => {
    const outcome = defineLoweringOutcome({
      featureId: "plugin-manifests",
      outputs: [
        { path: "plugins-claude/plugins/acme/.claude-plugin/plugin.json" },
        { path: "plugins-codex/plugins/acme/.codex-plugin/plugin.json" },
      ],
      sourcePath: ".skillset/plugins/acme/skillset.yaml",
      sourceUnit: "plugin:acme",
      status: "emitted",
    });

    expect(outcome.outputs?.map((output) => output.path)).toEqual([
      "plugins-claude/plugins/acme/.claude-plugin/plugin.json",
      "plugins-codex/plugins/acme/.codex-plugin/plugin.json",
    ]);
  });

  it("rejects invalid schemas, statuses, missing identity, and incomplete evidence", () => {
    expect(() =>
      defineLoweringOutcome({
        featureId: "project-instructions",
        schema: "wrong" as typeof LOWERING_OUTCOME_SCHEMA,
        sourceUnit: "instructions:root",
        status: "emitted",
      })
    ).toThrow("unsupported lowering outcome schema wrong");
    expect(() =>
      defineLoweringOutcome({
        featureId: "project-instructions",
        sourceUnit: "instructions:root",
        status: "magical" as SkillsetLoweringOutcome["status"],
      })
    ).toThrow("unknown lowering outcome status magical");
    expect(() =>
      defineLoweringOutcome({
        featureId: "",
        sourceUnit: "instructions:root",
        status: "emitted",
      })
    ).toThrow("featureId is required");
    expect(() =>
      defineLoweringOutcome({
        featureId: "project-instructions",
        sourceUnit: "",
        status: "emitted",
      })
    ).toThrow("sourceUnit is required");
    expect(() =>
      defineLoweringOutcome({
        featureId: "project-instructions",
        sourceUnit: "instructions:root",
        status: "unsupported",
      })
    ).toThrow("unsupported status requires a reason");
    expect(() =>
      defineLoweringOutcome({
        evidence: [{ kind: "external-docs", ref: "https://example.com/docs" }],
        featureId: "project-instructions",
        sourceUnit: "instructions:root",
        status: "emitted",
      })
    ).toThrow("external docs evidence requires verifiedAt");
  });

  it("pins the outcome status vocabulary", () => {
    expect(LOWERING_OUTCOME_STATUS_VALUES).toEqual([
      "degraded",
      "emitted",
      "externally_managed",
      "failed",
      "intentionally_skipped",
      "lossy",
      "metadata_only",
      "target_native",
      "transformed",
      "unsupported",
    ]);
  });
});
