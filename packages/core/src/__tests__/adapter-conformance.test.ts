import { describe, expect, it } from "bun:test";
import { normalizeSkillsetFixtureFiles } from "../../../../scripts/test-helpers/skillset-config";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getProviderDestinationFormatSnapshot } from "@skillset/registry";

import {
  checkAdapterConformance,
  diffSkillsetResult,
  getSkillsetFeature,
  SkillsetRenderResultError,
  type AdapterConformanceCase,
  type SkillsetRenderResult,
} from "@skillset/core";

const CONFORMANCE_FIXTURE: Record<string, string> = {
  "skillset.yaml": `
skillset:
  name: conformance-root
  marketplace:
    name: conformance-market
claude: true
codex: true
`,
  ".skillset/skills/repo-skill/SKILL.md": `
---
name: repo-skill
description: Repo skill.
---

Use the repo skill.
`,
  ".skillset/rules/root.md": `
---
description: Root instructions.
---

Keep generated output deterministic.
`,
  ".skillset/agents/reviewer.md": `
---
name: reviewer
description: Reviews code.
skills:
  - repo-skill
---

Review diffs carefully.
`,
  ".skillset/plugins/alpha/skillset.yaml": `
skillset:
  name: alpha
  description: Alpha plugin.
dependencies:
  plugins:
    - name: external-tools
      range: ^2.1.0
      marketplace: acme
mcp: true
`,
  ".skillset/plugins/alpha/.mcp.json": `
{
  "mcpServers": {
    "alpha": { "command": "node" }
  }
}
`,
  ".skillset/plugins/alpha/skills/plugin-skill/SKILL.md": `
---
name: plugin-skill
description: Plugin skill.
tool_intent:
  allow:
    read:
      - docs/**
---

Use the plugin skill.
`,
};

describe("adapter conformance", () => {
  it("ties representative registry support claims to emitted render results", async () => {
    const root = await fixture(CONFORMANCE_FIXTURE);

    const result = await diffSkillsetResult(root);
    const report = checkAdapterConformance(result.renderResults, [
      { featureId: "standalone-skills", sourceUnit: "skill:repo-skill", target: "claude" },
      { featureId: "plugin-skills", sourceUnit: "plugin.alpha.skill:plugin-skill", target: "codex" },
      { featureId: "project-instructions", sourceUnit: "instruction:AGENTS.md", target: "codex" },
      { featureId: "project-agents", sourceUnit: "agent:reviewer", target: "codex" },
      { featureId: "plugin-mcp", sourceUnit: "plugin.alpha.feature:mcp", target: "claude" },
      { featureId: "dependencies", sourceUnit: "plugin.alpha.feature:dependencies", target: "claude" },
      { featureId: "dependencies", sourceUnit: "plugin.alpha.feature:dependencies", target: "codex" },
      { featureId: "tool-intent", sourceUnit: "plugin.alpha.skill:plugin-skill", target: "claude" },
      { featureId: "tool-intent", sourceUnit: "plugin.alpha.skill:plugin-skill", target: "codex" },
    ]);

    expect(report).toEqual({ issues: [], ok: true });
  });

  it("can inspect adopted destination snapshots for conformance support claims", () => {
    const pluginManifest = getSkillsetFeature("plugin-manifests");
    const codexEvidence = pluginManifest?.targetSupport.codex.evidence ?? [];
    const snapshotEvidence = codexEvidence.find((item) => item.kind === "provider-snapshot" && item.ref === "codex-plugin");
    const snapshot = getProviderDestinationFormatSnapshot("codex-plugin");

    expect(snapshotEvidence).toBeDefined();
    expect((snapshot?.format as { readonly manifest?: { readonly path?: string } })?.manifest?.path).toBe(
      ".codex-plugin/plugin.json"
    );
  });

  it("proves unsupported feature claims through structured render results", async () => {
    const root = await fixture({
      ...CONFORMANCE_FIXTURE,
      ".skillset/plugins/alpha/bin/tool": `
#!/usr/bin/env bash
echo alpha
`,
    });

    const report = checkAdapterConformance(await renderErrorResults(root), [
      { featureId: "plugin-bin", sourceUnit: "plugin.alpha.feature:bin", target: "codex" },
    ]);

    expect(report).toEqual({ issues: [], ok: true });
  });

  it("reports missing, mismatched, and reason-drifted outcomes deterministically", () => {
    const cases: readonly AdapterConformanceCase[] = [
      { featureId: "dependencies", sourceUnit: "plugin.alpha.feature:dependencies", target: "codex" },
      { featureId: "plugin-skills", sourceUnit: "plugin.alpha.skill:plugin-skill", target: "codex" },
      { featureId: "standalone-skills", sourceUnit: "skill:repo-skill", target: "claude" },
    ];
    const outcomes: readonly SkillsetRenderResult[] = [
      outcome({ featureId: "dependencies", reason: "custom stale reason", status: "degraded", target: "codex" }),
      outcome({ featureId: "plugin-skills", status: "transformed", target: "codex" }),
      outcome({ featureId: "standalone-skills", status: "rendered", target: "claude" }),
      outcome({ featureId: "standalone-skills", reason: "contradictory", status: "unsupported", target: "claude" }),
    ];

    const report = checkAdapterConformance(outcomes, cases);

    expect(report.issues.map((issue) => issue.code)).toEqual([
      "reason-mismatch",
      "status-mismatch",
      "status-mismatch",
    ]);
    expect(report.issues[0]?.message).toContain("reason does not match");
    expect(report.issues[2]?.observed).toEqual(["rendered", "unsupported"]);
  });
});

async function renderErrorResults(root: string): Promise<readonly SkillsetRenderResult[]> {
  try {
    await diffSkillsetResult(root);
  } catch (error) {
    expect(error).toBeInstanceOf(SkillsetRenderResultError);
    return (error as SkillsetRenderResultError).renderResults;
  }
  throw new Error("expected diffSkillsetResult to reject");
}

function outcome(
  overrides: {
    readonly featureId: string;
    readonly reason?: string;
    readonly status: SkillsetRenderResult["status"];
    readonly target: NonNullable<SkillsetRenderResult["target"]>;
  }
): SkillsetRenderResult {
  const sourceUnitByFeature: Record<string, string> = {
    dependencies: "plugin.alpha.feature:dependencies",
    "plugin-skills": "plugin.alpha.skill:plugin-skill",
    "standalone-skills": "skill:repo-skill",
  };
  return {
    evidence: [{ kind: "test", ref: "packages/core/src/__tests__/adapter-conformance.test.ts" }],
    featureId: overrides.featureId,
    ...(overrides.reason === undefined ? {} : { reason: overrides.reason }),
    schema: "skillset-render-result@1",
    sourceUnit: sourceUnitByFeature[overrides.featureId] ?? "unknown",
    status: overrides.status,
    target: overrides.target,
  };
}

async function fixture(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "skillset-adapter-conformance-"));
  for (const [path, content] of Object.entries(normalizeSkillsetFixtureFiles(files))) {
    await Bun.write(join(root, path), `${content.trim()}\n`);
  }
  return root;
}
