import { describe, expect, it } from "bun:test";

import {
  classifyNativeToolRule,
  PORTABLE_TOOL_ASPECTS,
  readEffectiveToolsPolicy,
  type EffectiveToolsPolicy,
} from "../skill-policy";
import { targetNames } from "../targets";
import {
  getRenderedToolsRealization,
  listToolsRealizationFacts,
  planToolsRealization,
  renderResultStatusForToolsTier,
  TOOLS_REALIZATION_SURFACES,
  TOOLS_REALIZATION_TIERS,
  toolsMetadataSidecarTargets,
  toolsNativeOverlayRealizations,
  toolsRealizationFacts,
} from "../tools-realization";
import type { JsonRecord } from "../types";

function policyFor(target: "claude" | "codex" | "cursor", frontmatter: JsonRecord): EffectiveToolsPolicy {
  return readEffectiveToolsPolicy(frontmatter, {}, target, "skills/example/SKILL.md");
}

describe("tools realization registry", () => {
  it("answers exactly one rendered fact per provider, aspect, and direction", () => {
    for (const provider of targetNames()) {
      for (const aspect of PORTABLE_TOOL_ASPECTS) {
        for (const direction of ["constrain", "grant"] as const) {
          const fact = getRenderedToolsRealization(provider, aspect, direction);
          expect(fact.rendered).toBe(true);
          expect(fact.provider).toBe(provider);
          expect(fact.aspects).toContain(aspect);
          expect(fact.evidence.length).toBeGreaterThan(0);
        }
      }
    }
  });

  it("keeps every fact inside the tier and surface vocabularies with evidence", () => {
    for (const fact of toolsRealizationFacts) {
      expect(TOOLS_REALIZATION_TIERS).toContain(fact.tier);
      expect(TOOLS_REALIZATION_SURFACES).toContain(fact.surface);
      expect(fact.aspects.length).toBeGreaterThan(0);
      expect(fact.evidence.length).toBeGreaterThan(0);
      for (const evidence of fact.evidence) {
        if (evidence.kind === "external-docs") expect(evidence.verifiedAt).toBeDefined();
      }
    }
  });

  it("covers transformed, metadata-only, settings-required, advisory, and unsupported rows honestly", () => {
    const byTier = (tier: string) => toolsRealizationFacts.filter((fact) => fact.tier === tier);

    const transformed = byTier("transformed");
    expect(transformed.every((fact) => fact.provider === "claude" && fact.rendered)).toBe(true);
    expect(new Set(transformed.flatMap((fact) => fact.aspects))).toEqual(new Set(PORTABLE_TOOL_ASPECTS));

    const metadataOnly = byTier("metadata-only");
    expect(new Set(metadataOnly.map((fact) => fact.provider))).toEqual(new Set(["codex", "cursor"]));
    expect(metadataOnly.every((fact) => fact.rendered && fact.surface === "metadata")).toBe(true);

    const settingsRequired = byTier("settings-required");
    expect(settingsRequired.map((fact) => `${fact.provider}:${fact.aspects.join(",")}`).sort()).toEqual([
      "codex:write",
      "cursor:write",
    ]);
    expect(settingsRequired.every((fact) => !fact.rendered && fact.diagnostic !== undefined)).toBe(true);

    const advisory = byTier("advisory");
    expect(advisory.length).toBeGreaterThan(0);
    expect(advisory.every((fact) => !fact.rendered && fact.provider === "codex")).toBe(true);

    const unsupported = byTier("unsupported");
    expect(unsupported.map((fact) => `${fact.provider}:${fact.aspects.join(",")}`)).toEqual(["cursor:mcp"]);
    expect(unsupported.every((fact) => !fact.rendered && fact.surface === "none")).toBe(true);

    // No derived or approximate row is claimed until a provider realization is
    // proven; the vocabulary reserves the tiers without faking evidence.
    expect(byTier("derived")).toEqual([]);
    expect(byTier("approximate")).toEqual([]);
  });

  it("filters facts by provider, aspect, and rendered flag", () => {
    const cursorMcp = listToolsRealizationFacts({ aspect: "mcp", provider: "cursor" });
    expect(cursorMcp.map((fact) => fact.tier).sort()).toEqual(["metadata-only", "unsupported"]);
    expect(listToolsRealizationFacts({ aspect: "mcp", provider: "cursor", rendered: true })).toHaveLength(1);
  });

  it("maps rendered tiers onto render-result statuses and fails loud otherwise", () => {
    expect(renderResultStatusForToolsTier("native")).toBe("target_native");
    expect(renderResultStatusForToolsTier("transformed")).toBe("transformed");
    expect(renderResultStatusForToolsTier("metadata-only")).toBe("metadata_only");
    expect(() => renderResultStatusForToolsTier("settings-required")).toThrow(
      "does not produce rendered output"
    );
    expect(() => renderResultStatusForToolsTier("unsupported")).toThrow("does not produce rendered output");
  });

  it("derives the metadata sidecar targets from registry facts", () => {
    expect([...toolsMetadataSidecarTargets()].sort()).toEqual(["codex", "cursor"]);
  });

  it("realizes native overlays natively on Claude and as metadata elsewhere", () => {
    expect(toolsNativeOverlayRealizations.claude.tier).toBe("native");
    expect(toolsNativeOverlayRealizations.codex.tier).toBe("metadata-only");
    expect(toolsNativeOverlayRealizations.cursor.tier).toBe("metadata-only");
    expect(toolsNativeOverlayRealizations.cursor.diagnostic).toContain("no documented native tool rule syntax");
  });
});

describe("tools realization planner", () => {
  it("shows macro expansion as the deciding layer for tools: readonly", () => {
    const plan = planToolsRealization(policyFor("claude", { tools: "readonly" }));
    expect(plan.macro).toBe("readonly");
    expect(plan.provider).toBe("claude");
    const byAspect = new Map(plan.entries.map((entry) => [entry.aspect, entry]));
    expect(byAspect.get("read")?.decidingLayer).toBe("macro");
    expect(byAspect.get("read")?.emits).toEqual(["allowed-tools: Read"]);
    expect(byAspect.get("search")?.emits).toEqual(["allowed-tools: Grep", "allowed-tools: Glob"]);
    expect(byAspect.get("write")?.emits).toEqual(["disallowed-tools: Write", "disallowed-tools: Edit"]);
    expect(byAspect.get("write")?.diagnostics.join(" ")).toContain("Bash and MCP tools can still change state");
    expect(byAspect.get("write")?.tier).toBe("transformed");
    expect(byAspect.get("write")?.surface).toBe("skill-frontmatter");
  });

  it("marks provider overrides as the deciding layer", () => {
    const plan = planToolsRealization(
      policyFor("claude", { tools: { read: true, claude: { read: false } } })
    );
    const read = plan.entries.find((entry) => entry.aspect === "read");
    expect(read?.decidingLayer).toBe("provider-override");
    expect(read?.value).toBe(false);
    expect(read?.emits).toEqual(["disallowed-tools: Read"]);
  });

  it("classifies native overlay rules and keeps unknown rules unclassified", () => {
    const plan = planToolsRealization(
      policyFor("claude", {
        tools: { claude: { allow: ["Bash(git status)", "WebFetch"], deny: ["mcp__slack"] } },
      })
    );
    const overlays = plan.entries.filter((entry) => entry.kind === "native-overlay");
    expect(overlays).toHaveLength(3);

    const bash = overlays.find((entry) => entry.rule === "Bash(git status)");
    expect(bash?.aspect).toBe("shell");
    expect(bash?.tier).toBe("native");
    expect(bash?.emits).toEqual(["allowed-tools: Bash(git status)"]);

    const unknown = overlays.find((entry) => entry.rule === "WebFetch");
    expect(unknown?.unclassified).toBe(true);
    expect(unknown?.aspect).toBeUndefined();
    expect(unknown?.tier).toBe("native");

    const deny = overlays.find((entry) => entry.rule === "mcp__slack");
    expect(deny?.aspect).toBe("mcp");
    expect(deny?.ruleDirection).toBe("deny");
    expect(deny?.emits).toEqual(["disallowed-tools: mcp__slack"]);
  });

  it("plans metadata-only realizations for Codex and Cursor", () => {
    for (const target of ["codex", "cursor"] as const) {
      const plan = planToolsRealization(
        policyFor(target, {
          tools: {
            mcp: { github: ["get_*"] },
            write: false,
            [target]: { allow: ["custom-rule"] },
          },
        })
      );
      const write = plan.entries.find((entry) => entry.aspect === "write");
      expect(write?.tier).toBe("metadata-only");
      expect(write?.surface).toBe("metadata");
      expect(write?.emits).toEqual([".skillset.tools.yaml: tools.portable.write"]);
      expect(write?.diagnostics.join(" ")).toContain("no proven skill-local tools enforcement surface");

      const overlay = plan.entries.find((entry) => entry.kind === "native-overlay");
      expect(overlay?.rule).toBe("custom-rule");
      expect(overlay?.unclassified).toBe(true);
      expect(overlay?.tier).toBe("metadata-only");
      expect(overlay?.emits).toEqual([".skillset.tools.yaml: tools.target_native.allow"]);
    }
  });

  it("treats deny-only MCP maps as constraints and surfaces unsupported residual risks", () => {
    const claudePlan = planToolsRealization(policyFor("claude", { tools: { mcp: { slack: false } } }));
    const claudeMcp = claudePlan.entries.find((entry) => entry.aspect === "mcp");
    expect(claudeMcp?.emits).toEqual(["disallowed-tools: mcp__slack"]);

    const cursorPlan = planToolsRealization(
      policyFor("cursor", { tools: { mcp: { github: ["get_*"], slack: false } } })
    );
    const cursorMcp = cursorPlan.entries.find((entry) => entry.aspect === "mcp");
    expect(cursorMcp?.tier).toBe("metadata-only");
    expect(cursorMcp?.diagnostics.join(" ")).toContain("inherited MCP tools may remain available");

    const claudeMixed = planToolsRealization(
      policyFor("claude", { tools: { mcp: { github: true, slack: false } } })
    );
    const mixed = claudeMixed.entries.find((entry) => entry.aspect === "mcp");
    expect(mixed?.emits).toEqual(["allowed-tools: mcp__github", "disallowed-tools: mcp__slack"]);
  });

  it("still fails loud when native allow contradicts an effective portable false", () => {
    expect(() =>
      policyFor("claude", { tools: { write: false, claude: { allow: ["Write"] } } })
    ).toThrow("contradicts effective tools.write: false");
  });

  it("keeps the classifier table aligned with the locked design", () => {
    expect(classifyNativeToolRule("Bash(rm -rf *)")).toBe("shell");
    expect(classifyNativeToolRule("Bash")).toBe("shell");
    expect(classifyNativeToolRule("mcp__github__get_issue")).toBe("mcp");
    expect(classifyNativeToolRule("Write")).toBe("write");
    expect(classifyNativeToolRule("Edit(src/*)")).toBe("write");
    expect(classifyNativeToolRule("Read")).toBe("read");
    expect(classifyNativeToolRule("Grep")).toBe("search");
    expect(classifyNativeToolRule("Glob")).toBe("search");
    expect(classifyNativeToolRule("WebSearch")).toBeUndefined();
    expect(classifyNativeToolRule("Readonly")).toBeUndefined();
  });
});
