import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, test } from "bun:test";
import { targetNames } from "../targets";

import {
  assessCapabilityFidelity,
  assessPinnedCapabilityJudgment,
  type CapabilityJudgment,
  assertCapabilityAuthorities,
  compareCapability,
  CAPABILITY_FIDELITIES,
  CAPABILITY_IMPLEMENTATION_EVIDENCE,
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
    const judgment: CapabilityJudgment = { implementationPaths: [], capabilityId: "example", featureId: "example", target: "codex", fidelity: "exact", scope: "Explicit synthetic protocol.", limitations: [], authorityHash: "reviewed" };
    expect(assessPinnedCapabilityJudgment(judgment, "reviewed").fidelity).toBe("exact");
    expect(assessPinnedCapabilityJudgment(judgment, "updated")).toEqual({ fidelity: "unknown", reasons: ["example:example:codex: stale"] });
    expect(assessPinnedCapabilityJudgment(judgment, undefined)).toEqual({ fidelity: "unknown", reasons: ["example:example:codex: missing"] });
  });
});


describe("reviewed implementation evidence", () => {
  async function readEvidence(): Promise<Map<string, string>> {
    const root = resolve(import.meta.dir, "../../../..");
    return new Map(await Promise.all(CAPABILITY_IMPLEMENTATION_EVIDENCE.map(async ({ path }) =>
      [path, await readFile(resolve(root, path), "utf8")] as const
    )));
  }
  // Hash canonical Git text so checkout line-ending policy does not create false drift.
  function drift(contents: ReadonlyMap<string, string>): string[] {
    return CAPABILITY_IMPLEMENTATION_EVIDENCE.filter(({ path, contentHash }) => {
      const content = contents.get(path);
      return content === undefined || `sha256:${createHash("sha256").update(content.replace(/\r\n/gu, "\n")).digest("hex")}` !== contentHash;
    }).map(({ path }) => path);
  }
  test("cited renderer, test and documentation content still matches the reviewed judgment", async () => {
    // A failure requires reviewing the semantic judgment, not blindly regenerating hashes.
    expect(drift(await readEvidence())).toEqual([]);
  });
  test("checkout CRLF conversion does not invalidate the reviewed Git text", async () => {
    const contents = await readEvidence();
    for (const [path, content] of contents) contents.set(path, content.replace(/\r?\n/gu, "\r\n"));
    expect(drift(contents)).toEqual([]);
  });
  test("changing or removing an actual cited renderer invalidates implementation review", async () => {
    const contents = await readEvidence();
    const path = "packages/core/src/render-codex-skill-sidecars.ts";
    contents.set(path, contents.get(path)!.replace("allow_implicit_invocation: implicitInvocation", "allow_implicit_invocation: !implicitInvocation"));
    expect(drift(contents)).toEqual([path]);
    contents.delete(path);
    expect(drift(contents)).toEqual([path]);
  });
  test("a changed referenced source contract makes a real lookup judgment unknown", () => {
    const original = findCapabilities("skill-invocation")[0]!;
    expect(compareCapability(original, ["codex"])[0]?.fidelity).toBe("exact");
    const changed = { ...original, sourceContractIds: [] };
    expect(compareCapability(changed, ["codex"])[0]?.fidelity).toBe("unknown");
    expect(compareCapability(changed, ["codex"])[0]?.limitations.join(" ")).toContain("stale");
  });
});


test("per-capability implementation evidence excludes unrelated hook and rule files", () => {
  const invocation = compareCapability(findCapabilities("skill-invocation")[0]!, ["codex"])[0]!;
  expect(invocation.implementationEvidence.map(({ path }) => path)).toContain("packages/core/src/render-codex-skill-sidecars.ts");
  expect(invocation.implementationEvidence.some(({ path }) => path.includes("hook") || path.includes("rule"))).toBe(false);
  for (const row of listCapabilities().flatMap((entry) => compareCapability(entry, targetNames()))) {
    if (row.fidelity !== "unknown") expect(row.implementationEvidence.length).toBeGreaterThan(0);
  }
});

test("the synthesized rule judgment excludes authored native root guidance", () => {
  const row = compareCapability(findCapabilities("project-rules")[0]!, ["codex"])[0]!;
  expect(row.fidelity).toBe("synthesized");
  expect(row.limitations.join(" ")).toContain("Native root AGENTS.md is read in place");
  expect(row.implementationEvidence.map(({ path }) => path)).toContain("packages/core/src/__tests__/native-root-rules.test.ts");
});
