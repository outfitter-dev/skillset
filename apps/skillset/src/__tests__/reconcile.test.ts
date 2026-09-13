import { describe, expect, it } from "bun:test";

import { renderReconcileReport, type ReconcileReport } from "../reconcile";

describe("SET-406 reconcile projection identity", () => {
  it("explains shared baseline consumers and ownership", () => {
    const report: ReconcileReport = {
      applied: false,
      generatedPath: ".agents/skills/review/SKILL.md",
      outputResolution: {
        entries: [
          {
            consumers: [
              { phase: "baseline", standardProfile: "agent-skills" },
              { phase: "delta", target: "codex" },
            ],
            kind: "standalone-skill",
            outputPath: ".agents/skills/review/SKILL.md",
            outputRoot: ".agents/skills",
            owner: { standardProfile: "agent-skills" },
            sourcePath: ".skillset/skills/review/SKILL.md",
            target: "workspace",
          },
        ],
        generatedPath: ".agents/skills/review/SKILL.md",
        message: "Preview only.",
        nextSteps: [],
        sourcePath: ".skillset/skills/review/SKILL.md",
        status: "suggestible",
        wouldWrite: true,
        wrote: false,
      },
      sourcePath: ".skillset/skills/review/SKILL.md",
      sourceResolutionAvailable: true,
      writtenPaths: [],
    };

    const output = renderReconcileReport(report);
    expect(output).toContain("consumers: agent-skills baseline + codex delta");
    expect(output).toContain("owner: agent-skills baseline");
  });

  it("does not call a provider-only owner a delta", () => {
    const report: ReconcileReport = {
      applied: false,
      generatedPath: ".codex/agents/reviewer.toml",
      outputResolution: {
        entries: [
          {
            consumers: [{ phase: "delta", target: "codex" }],
            kind: "project-agent",
            outputPath: ".codex/agents/reviewer.toml",
            outputRoot: ".",
            owner: { target: "codex" },
            sourcePath: ".skillset/agents/reviewer.md",
            target: "codex",
          },
        ],
        generatedPath: ".codex/agents/reviewer.toml",
        message: "Preview only.",
        nextSteps: [],
        sourcePath: ".skillset/agents/reviewer.md",
        status: "suggestible",
        wouldWrite: true,
        wrote: false,
      },
      sourcePath: ".skillset/agents/reviewer.md",
      sourceResolutionAvailable: true,
      writtenPaths: [],
    };

    const output = renderReconcileReport(report);
    expect(output).toContain("consumers: codex");
    expect(output).toContain("owner: codex");
    expect(output).not.toContain("codex delta");
  });
});
