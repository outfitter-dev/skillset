import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import { createTestFixtureRoot } from "../../../../scripts/test-helpers/fixture-root";

import { normalizeSkillsetFixtureFiles } from "../../../../scripts/test-helpers/skillset-config";
import { explainPath } from "../authoring";
import { buildSkillsetResult } from "../build";

const HOOKS =
  '{"hooks":{"PreToolUse":[{"matcher":"Bash","hooks":[{"type":"command","command":"echo pre"}]}]}}\n';

describe("SET-732: explain output state", () => {
  it("reports never-written plugin hooks as planned, blocked, and written by the hooks render", async () => {
    const root = await fixture({ ".skillset/plugins/toolkit/hooks/hooks.json": HOOKS });
    await expect(buildSkillsetResult(root)).rejects.toThrow("unsupported destination policy blocked");

    const explained = await explainPath(root, "plugins/toolkit/hooks/hooks.json");
    expect(explained.kind).toBe("generated");
    expect(explained.targets).toEqual(["claude", "codex"]);
    expect(explained.unwrittenOutputs).toEqual(
      expect.arrayContaining([
        "plugins/toolkit/hooks/hooks.json",
        "plugins/toolkit/.claude-plugin/plugin.json",
      ])
    );
    expect(explained.renderResults.length).toBeGreaterThan(0);
    for (const outcome of explained.renderResults) {
      expect(outcome.featureId).toBe("plugin-hooks");
      expect(outcome.outputs?.map((output) => output.path)).toContain(
        "plugins/toolkit/hooks/hooks.json"
      );
    }
    expect(explained.blockingRenderResults).toEqual([
      expect.objectContaining({
        featureId: "plugin-hooks",
        standardProfile: "agent-plugins-1.0",
        status: "unsupported",
      }),
    ]);
    expect(explained.notes).toEqual(
      expect.arrayContaining([
        expect.stringContaining("rendered from .skillset/plugins/toolkit/hooks/hooks.json"),
        expect.stringContaining("Output derivation is blocked by 1 render result"),
        expect.stringContaining("Not written: plugins/toolkit/hooks/hooks.json"),
      ])
    );
  });

  it("reports written outputs as written once the build succeeds", async () => {
    const root = await fixture({});
    expect((await buildSkillsetResult(root)).ok).toBe(true);

    const explained = await explainPath(root, "plugins/toolkit/.claude-plugin/plugin.json");
    expect(explained.kind).toBe("generated");
    expect(explained.unwrittenOutputs).toEqual([]);
    expect(explained.blockingRenderResults).toEqual([]);
    expect(explained.notes.some((note) => note.startsWith("Not written"))).toBe(false);
  });
});

async function fixture(extra: Readonly<Record<string, string>>): Promise<string> {
  const root = await createTestFixtureRoot("skillset-explain-output-state-");
  const files = normalizeSkillsetFixtureFiles({
    ".skillset/plugins/toolkit/skillset.yaml": `
skillset:
  name: toolkit
  license: none
`,
    ".skillset/plugins/toolkit/skills/demo/SKILL.md": `---
name: demo
description: Demo.
---

Body.
`,
    "skillset.yaml": `
skillset:
  name: explain-output-state
  license: none
compile:
  targets:
    - claude
    - codex
`,
    ...extra,
  });
  await Promise.all(
    Object.entries(files).map(([path, content]) =>
      Bun.write(join(root, path), content)
    )
  );
  return root;
}
