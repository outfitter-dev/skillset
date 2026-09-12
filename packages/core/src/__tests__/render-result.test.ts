import { describe, expect, it } from "bun:test";

import {
  RENDER_RESULT_SCHEMA,
  RENDER_RESULT_STATUS_VALUES,
  defineRenderResult,
  parseRenderResult,
  serializeRenderResult,
  type SkillsetRenderResult,
} from "@skillset/core";

describe("render results", () => {
  it("normalizes to a stable JSON shape with sorted nested arrays", () => {
    const outcome = defineRenderResult({
      diagnostics: [
        { code: "z-warning", path: ".skillset/z.md" },
        { code: "a-warning", message: "First." },
      ],
      evidence: [
        { kind: "test", ref: "b.test.ts" },
        { kind: "external-docs", ref: "https://example.com/docs", verifiedAt: "2026-06-12" },
      ],
      destination: "instruction",
      featureId: "project-instructions",
      outputs: [
        { kind: "rule", path: ".claude/rules/b.md" },
        { kind: "agents", path: "AGENTS.md" },
      ],
      policy: "default",
      sourcePath: ".skillset/rules/root.md",
      sourceUnit: "instructions:root",
      status: "transformed",
      target: "codex",
    });

    expect(serializeRenderResult(outcome)).toBe(`{
  "schema": "${RENDER_RESULT_SCHEMA}",
  "sourceUnit": "instructions:root",
  "sourcePath": ".skillset/rules/root.md",
  "featureId": "project-instructions",
  "target": "codex",
  "destination": "instruction",
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
      "path": ".skillset/z.md"
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
    const outcome = defineRenderResult({
      featureId: "supports",
      policy: "scope:excluded",
      sourcePath: ".skillset/skills/demo/SKILL.md",
      sourceUnit: "skill:demo",
      status: "intentionally_skipped",
    });

    expect(outcome.outputs).toBeUndefined();
    expect(outcome.target).toBeUndefined();
    expect(serializeRenderResult(outcome)).toContain('"status": "intentionally_skipped"');
  });

  it("keeps standards identity separate from provider targets", () => {
    const outcome = defineRenderResult({
      featureId: "standalone-skills",
      sourceUnit: "skill:demo",
      standardProfile: "agent-skills",
      status: "rendered",
    });

    expect(outcome.target).toBeUndefined();
    expect(outcome.standardProfile).toBe("agent-skills");
    expect(serializeRenderResult(outcome)).toContain('"standardProfile": "agent-skills"');
  });

  it("parses current standard results and rejects invalid current identities", () => {
    expect(
      parseRenderResult({
        featureId: "standalone-skills",
        schema: RENDER_RESULT_SCHEMA,
        sourceUnit: "skill:demo",
        standardProfile: "agent-skills",
        status: "rendered",
      })
    ).toMatchObject({
      schema: RENDER_RESULT_SCHEMA,
      standardProfile: "agent-skills",
    });
    expect(() =>
      parseRenderResult({
        featureId: "standalone-skills",
        schema: RENDER_RESULT_SCHEMA,
        sourceUnit: "skill:demo",
        status: "rendered",
        target: "agents",
      })
    ).toThrow("target must be a provider target");
    expect(() =>
      parseRenderResult({
        featureId: "standalone-skills",
        schema: RENDER_RESULT_SCHEMA,
        sourceUnit: "skill:demo",
        standardProfile: "future-standard",
        status: "rendered",
      })
    ).toThrow("standardProfile must be a standard profile id");
  });

  it("can represent multiple outputs from one source unit", () => {
    const outcome = defineRenderResult({
      featureId: "plugin-manifests",
      outputs: [
        { path: "plugins/acme/claude/.claude-plugin/plugin.json" },
        { path: "plugins/acme/codex/.codex-plugin/plugin.json" },
      ],
      sourcePath: ".skillset/plugins/acme/skillset.yaml",
      sourceUnit: "plugin:acme",
      status: "rendered",
    });

    expect(outcome.outputs?.map((output) => output.path)).toEqual([
      "plugins/acme/claude/.claude-plugin/plugin.json",
      "plugins/acme/codex/.codex-plugin/plugin.json",
    ]);
  });

  it("rejects invalid schemas, statuses, missing identity, and incomplete evidence", () => {
    expect(() =>
      defineRenderResult({
        featureId: "project-instructions",
        schema: "wrong" as typeof RENDER_RESULT_SCHEMA,
        sourceUnit: "instructions:root",
        status: "rendered",
      })
    ).toThrow("unsupported render result schema wrong");
    expect(() =>
      defineRenderResult({
        featureId: "project-instructions",
        sourceUnit: "instructions:root",
        status: "magical" as SkillsetRenderResult["status"],
      })
    ).toThrow("unknown render result status magical");
    expect(() =>
      defineRenderResult({
        featureId: "",
        sourceUnit: "instructions:root",
        status: "rendered",
      })
    ).toThrow("featureId is required");
    expect(() =>
      defineRenderResult({
        featureId: "standalone-skills",
        sourceUnit: "skill:demo",
        standardProfile: "agent-skills",
        status: "rendered",
        target: "codex",
      })
    ).toThrow("cannot name both a provider target and a standardProfile");
    expect(() =>
      defineRenderResult({
        featureId: "project-instructions",
        sourceUnit: "",
        status: "rendered",
      })
    ).toThrow("sourceUnit is required");
    expect(() =>
      defineRenderResult({
        featureId: "project-instructions",
        sourceUnit: "instructions:root",
        status: "unsupported",
      })
    ).toThrow("unsupported status requires a reason");
    expect(() =>
      defineRenderResult({
        evidence: [{ kind: "external-docs", ref: "https://example.com/docs" }],
        featureId: "project-instructions",
        sourceUnit: "instructions:root",
        status: "rendered",
      })
    ).toThrow("external docs evidence requires verifiedAt");
  });

  it("pins the outcome status vocabulary", () => {
    expect(RENDER_RESULT_STATUS_VALUES).toEqual([
      "degraded",
      "externally_managed",
      "failed",
      "intentionally_skipped",
      "lossy",
      "metadata_only",
      "rendered",
      "target_native",
      "transformed",
      "unsupported",
    ]);
  });
});
