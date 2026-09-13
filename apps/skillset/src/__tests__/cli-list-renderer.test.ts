import { describe, expect, test } from "bun:test";

import type { GeneratedEntry } from "@skillset/core/internal/types";

import { renderGeneratedEntryList } from "../cli-list-renderer";

const ENTRIES: readonly GeneratedEntry[] = [
  {
    kind: "plugin",
    outputPath: "plugins/demo/claude/.claude-plugin/plugin.json",
    outputRoot: "plugins",
    sourcePath: ".skillset/plugins/demo",
    target: "workspace",
  },
  {
    kind: "plugin",
    outputPath: "plugins/demo/codex/.codex-plugin/plugin.json",
    outputRoot: "plugins",
    sourcePath: ".skillset/plugins/demo",
    target: "workspace",
  },
  {
    kind: "standalone-skill",
    outputPath: ".claude/skills/review/SKILL.md",
    outputRoot: ".claude/skills",
    sourcePath: ".skillset/skills/review/SKILL.md",
    target: "workspace",
  },
  {
    kind: "standalone-skill",
    outputPath: ".agents/skills/review/SKILL.md",
    outputRoot: ".agents/skills",
    sourcePath: ".skillset/skills/review/SKILL.md",
    target: "workspace",
  },
  {
    kind: "rule",
    outputPath: ".cursor/rules/review.mdc",
    outputRoot: ".cursor/rules",
    sourcePath: ".skillset/rules/review.md",
    target: "workspace",
  },
  {
    kind: "island",
    outputPath: ".codex/hooks/hooks.json",
    outputRoot: ".codex",
    sourcePath: ".skillset/_codex/hooks/hooks.json",
    target: "workspace",
  },
];

describe("SET-307 list presentation", () => {
  test("groups projections by authored workspace units", () => {
    const output = renderGeneratedEntryList(ENTRIES, false, {
      color: false,
      width: 80,
    });
    expect(output).toContain("Plugins (1 source, 2 outputs)");
    expect(output).toContain("demo  claude, codex · 2 outputs");
    expect(output).toContain("Skills (1 source, 2 outputs)");
    expect(output).toContain("review  claude, codex · 2 outputs");
    expect(output).toContain(
      "Summary  4 sources · 6 outputs · claude, codex, cursor"
    );
    expect(output).not.toContain(" -> ");
  });

  test("keeps projection paths available through details", () => {
    const output = renderGeneratedEntryList(ENTRIES, true, {
      color: false,
      width: 100,
    });
    expect(output).toContain(
      "[claude] plugin .skillset/plugins/demo -> plugins/demo/claude/.claude-plugin/plugin.json"
    );
    expect(output).toContain(
      "[codex] standalone-skill .skillset/skills/review/SKILL.md -> .agents/skills/review/SKILL.md"
    );
  });

  test("keeps narrow summaries within the requested width", () => {
    const output = renderGeneratedEntryList(ENTRIES, false, {
      color: false,
      width: 40,
    });
    for (const line of output.split("\n"))
      expect(Bun.stringWidth(line)).toBeLessThanOrEqual(40);
  });

  test("renders standards baselines separately from provider deltas", () => {
    const output = renderGeneratedEntryList(
      [
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
        {
          consumers: [
            {
              phase: "baseline",
              standardProfile: "agent-plugins-1.0",
            },
          ],
          kind: "plugin",
          outputPath: "plugins/demo/agents/plugin.json",
          outputRoot: "plugins",
          owner: { standardProfile: "agent-plugins-1.0" },
          sourcePath: ".skillset/plugins/demo",
          target: "workspace",
        },
      ],
      true,
      { color: false, width: 180 }
    );

    expect(output).toContain(
      "[agent-skills baseline + codex delta] standalone-skill .skillset/skills/review/SKILL.md -> .agents/skills/review/SKILL.md"
    );
    expect(output).toContain(
      "[agent-plugins-1.0 baseline] plugin .skillset/plugins/demo -> plugins/demo/agents/plugin.json"
    );
    expect(output).toContain("codex delta");
    expect(output).toContain("agent-plugins-1.0 baseline");
    expect(output).toContain("agent-skills baseline");
    expect(output).not.toContain("agents delta");
  });
});
