import { describe, expect, test } from "bun:test";
import { targetNames } from "../targets";

import {
  assessCapabilityFidelity,
  assessPinnedCapabilityJudgment,
  type CapabilityJudgment,
  assertCapabilityAuthorities,
  compareCapability,
  CAPABILITY_FIDELITIES,
  findCapabilities,
  listCapabilities,
  type CapabilityEvidenceAssessment,
} from "../capability-crosswalk";

const current: CapabilityEvidenceAssessment = {
  id: "provider-snapshot:example",
  status: "current",
  scope: "Explicit test protocol semantics, not a real provider claim.",
};

describe("capability fidelity evidence boundary", () => {
  test.each(CAPABILITY_FIDELITIES)("retains an explicit %s judgment with current scoped evidence", (fidelity) => {
    expect(assessCapabilityFidelity(fidelity, [current])).toEqual({
      fidelity,
      reasons: [],
    });
  });

  test("absence never upgrades a claim, including unavailable and provider-only", () => {
    for (const fidelity of CAPABILITY_FIDELITIES) {
      expect(assessCapabilityFidelity(fidelity, []).fidelity).toBe("unknown");
    }
  });

  test.each(["stale", "missing", "insufficient"] as const)("%s evidence cannot prove semantic compatibility", (status) => {
    const result = assessCapabilityFidelity("equivalent", [{ ...current, status }]);
    expect(result.fidelity).toBe("unknown");
    expect(result.reasons).toEqual([`provider-snapshot:example: ${status}`]);
  });

  test("one current source cannot hide another stale source or absent semantic scope", () => {
    expect(assessCapabilityFidelity("exact", [current, { ...current, id: "other", status: "stale" }]).fidelity).toBe("unknown");
    expect(assessCapabilityFidelity("exact", [{ ...current, scope: " " }]).fidelity).toBe("unknown");
  });

  test("evidence never invents a fidelity judgment", () => {
    expect(assessCapabilityFidelity(undefined, [current])).toEqual({
      fidelity: "unknown",
      reasons: ["No semantic fidelity judgment is recorded."],
    });
  });
});

describe("capability catalog", () => {
  test("every catalog entry resolves current authorities for every registered target", () => {
    expect(() => assertCapabilityAuthorities()).not.toThrow();
    for (const capability of listCapabilities()) {
      const rows = compareCapability(capability, targetNames());
      expect(rows.length).toBeGreaterThan(0);
      expect(new Set(rows.map(({ target }) => target))).toEqual(new Set(targetNames()));
      expect(rows.every((row) => row.canonical.shape.length > 0)).toBe(true);
    }
  });
  test("covers the seven initial families through existing authority identities", () => {
    expect([...new Set(listCapabilities().map((entry) => entry.family))].sort()).toEqual([
      "agents", "hooks", "mcp", "plugins", "rules", "skills", "standards",
    ]);
    for (const entry of listCapabilities()) {
      expect(entry.featureIds.length + entry.standardProfileIds.length).toBeGreaterThan(0);
    }
  });

  test("semantic IDs and native aliases select the same concept without fuzzy rewriting", () => {
    expect(findCapabilities("developer_instructions").map(({ id }) => id)).toEqual(["project-agents"]);
    expect(findCapabilities("project-agents")).toEqual(findCapabilities("developer_instructions"));
    expect(findCapabilities(".claude/anything")).toEqual([]);
    expect(findCapabilities("developer_instruction")).toEqual([]);
  });

  test("shared aliases retain all matching concepts instead of picking the first", () => {
    const ids = findCapabilities("SKILL.md").map(({ id }) => id);
    expect(ids).toContain("skills");
    expect(ids).toContain("agent-skills-standard");
  });

  test("catalog is immutable and results are stable", () => {
    expect(Object.isFrozen(listCapabilities())).toBe(true);
    expect(Object.isFrozen(listCapabilities()[0]?.aliases)).toBe(true);
    expect(listCapabilities().map(({ id }) => id)).toEqual(listCapabilities().map(({ id }) => id).sort());
    expect(findCapabilities("  developer_instructions  ")).toEqual(findCapabilities("developer_instructions"));
  });
});


describe("pinned semantic judgments", () => {
  test("the actual catalog represents all seven outcomes with qualified scope", () => {
    const rows = listCapabilities().flatMap((entry) => compareCapability(entry, targetNames()));
    expect([...new Set(rows.map(({ fidelity }) => fidelity))].sort()).toEqual([...CAPABILITY_FIDELITIES].sort());
    for (const row of rows.filter(({ fidelity }) => fidelity !== "unknown")) {
      expect(row.semanticScope?.length).toBeGreaterThan(0);
      expect(row.evidence.length).toBeGreaterThan(0);
      expect(row.authorityHash).toMatch(/^sha256:[a-f0-9]{64}$/u);
    }
  });
  test("changed or absent pinned evidence invalidates a previously exact judgment", () => {
    const judgment: CapabilityJudgment = { capabilityId: "example", featureId: "example", target: "codex", fidelity: "exact", scope: "Explicit synthetic protocol.", limitations: [], authorityHash: "reviewed" };
    expect(assessPinnedCapabilityJudgment(judgment, "reviewed").fidelity).toBe("exact");
    expect(assessPinnedCapabilityJudgment(judgment, "updated")).toEqual({ fidelity: "unknown", reasons: ["example:example:codex: stale"] });
    expect(assessPinnedCapabilityJudgment(judgment, undefined)).toEqual({ fidelity: "unknown", reasons: ["example:example:codex: missing"] });
  });
});
