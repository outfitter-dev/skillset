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
});
