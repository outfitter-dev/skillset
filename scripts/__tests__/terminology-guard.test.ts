import { describe, expect, it } from "bun:test";

import { isScannablePath, scanContent } from "../terminology-guard";

describe("terminology guard", () => {
  it("flags retired render-result vocabulary", () => {
    expect(scanContent("a.ts", "type X = SkillsetLoweringOutcome;").map((v) => v.label)).toContain(
      "SkillsetLowering* -> SkillsetRenderResult*"
    );
    expect(scanContent("a.ts", "const loweringOutcomes = [];").map((v) => v.label)).toContain(
      "loweringOutcomes -> renderResults"
    );
    expect(scanContent("a.json", '"schema": "skillset-lowering-outcome@1"').map((v) => v.label)).toContain(
      "skillset-lowering-outcome@1 -> skillset-render-result@1"
    );
    expect(scanContent("a.ts", "readonly loweringOwner: string;").map((v) => v.label)).toContain(
      "loweringOwner -> renderOwner"
    );
    expect(scanContent("a.md", "the lowering outcome record").length).toBeGreaterThan(0);
    expect(scanContent("a.md", "lossy lowering and the loss ledger").map((v) => v.label)).toContain(
      "loss ledger -> render report"
    );
    expect(scanContent("a.ts", "const LOWERING_OUTCOME_SCHEMA = 1;").map((v) => v.label)).toContain(
      "LOWERING_OUTCOME -> RENDER_RESULT"
    );
    expect(scanContent("a.md", "the lowering policy blocks the build").map((v) => v.label)).toContain(
      "lowering policy -> unsupported destination policy"
    );
    expect(scanContent("a.md", "the value was lowered before writes").map((v) => v.label)).toContain(
      "lowered -> rendered/derived"
    );
  });

  it("does not let an allowlisted substring mask a co-located regression", () => {
    // `match.lowering` is allowlisted, but `loweringOutcomes` on the same line is not.
    const labels = scanContent("a.ts", "const loweringOutcomes = match.lowering;").map((v) => v.label);
    expect(labels).toContain("loweringOutcomes -> renderResults");
    // The bare `lowering` inside `match.lowering` stays exempt (no bare-verb violation).
    expect(labels).not.toContain("lowering -> render/derive");
  });

  it("flags the old config key but not the new one", () => {
    expect(scanContent("a.md", "compile.unsupported defaults to error").map((v) => v.label)).toContain(
      "compile.unsupported -> compile.unsupportedDestination"
    );
    expect(scanContent("a.md", "compile.unsupportedDestination defaults to error")).toEqual([]);
  });

  it("flags the bare render verb but not ordinary lower-* English", () => {
    expect(scanContent("a.md", "Skillset lowering to Claude").length).toBeGreaterThan(0);
    expect(scanContent("a.md", "lower-level opt-outs and lower-case names")).toEqual([]);
    expect(scanContent("a.md", "a lower config level than the root")).toEqual([]);
  });

  it("permits deferred and historical allowlisted lines", () => {
    // Transform-dialect concept (deferred follow-up).
    expect(scanContent("a.ts", 'if (match.lowering === "none") return;')).toEqual([]);
    expect(scanContent("a.ts", "No faithful Codex lowering: skipped")).toEqual([]);
    // Deterministic-projection concept (code not renamed).
    expect(scanContent("a.md", "the deterministic projection conformance proof")).toEqual([]);
    // Historical ADR reference.
    expect(scanContent("a.md", "[Lowering Outcomes](../adrs/...-lowering-outcomes-and-loss-ledger.md)")).toEqual([]);
  });

  it("does not scan generated, historical, or deferred-owner paths", () => {
    expect(isScannablePath("docs/adrs/0001-root-compile-policy.md")).toBe(false);
    expect(isScannablePath(".claude/skills/x/SKILL.md")).toBe(false);
    expect(isScannablePath(".agents/plans/p/PLAN.md")).toBe(false);
    expect(isScannablePath(".changeset/x.md")).toBe(false);
    expect(isScannablePath("apps/skillset/CHANGELOG.md")).toBe(false);
    expect(isScannablePath("packages/transforms/src/engine.ts")).toBe(false);
    expect(isScannablePath("packages/core/src/render.ts")).toBe(false);
    expect(isScannablePath("packages/core/src/deterministic-projection.ts")).toBe(false);
    // Active surfaces are scanned.
    expect(isScannablePath("docs/features/render-results.md")).toBe(true);
    expect(isScannablePath("packages/core/src/render-result.ts")).toBe(true);
    expect(isScannablePath("README.md")).toBe(true);
  });

  it("ignores non-scannable extensions", () => {
    expect(isScannablePath("scripts/run.sh")).toBe(false);
    expect(isScannablePath("LICENSE")).toBe(false);
  });
});
