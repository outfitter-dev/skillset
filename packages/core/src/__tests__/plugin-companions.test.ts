import { describe, expect, it } from "bun:test";
import { join } from "node:path";

import { buildSkillsetResult, diffSkillsetResult } from "../build";
import { createTestFixtureRoot } from "../../../../scripts/test-helpers/fixture-root";

// Valid as a Skillset plugin slug, but past the Agent Plugins 1.0 name limit.
const LONG_PLUGIN_ID = `long-${"x".repeat(65)}`;

describe("plugin companions", () => {
  for (const target of ["claude", "cursor"] as const) {
    it(`keeps ${target} companions when the Agent Plugins baseline is unsupported`, async () => {
      const root = await fixture(target, LONG_PLUGIN_ID);

      const result = await buildSkillsetResult(root);
      expect(result.ok).toBe(true);
      for (const path of ["README.md", "scripts/setup.sh", "src/index.js"]) {
        expect(await Bun.file(join(root, "plugins", LONG_PLUGIN_ID, path)).exists()).toBe(true);
      }
    });
  }

  it("keeps codex assets when the Agent Plugins baseline is unsupported", async () => {
    const root = await fixture("codex", LONG_PLUGIN_ID);

    const result = await buildSkillsetResult(root);
    expect(result.ok).toBe(true);
    for (const path of ["README.md", "assets/icon.svg", "scripts/setup.sh", "src/index.js"]) {
      expect(await Bun.file(join(root, "plugins", LONG_PLUGIN_ID, path)).exists()).toBe(true);
    }
  });

  it("attributes a shared baseline companion to the standard profile that owns it", async () => {
    const root = await fixture("claude", "demo");

    const { renderResults } = await diffSkillsetResult(root);
    const iconResults = renderResults.filter((result) =>
      result.outputs?.some((output) => output.path === "plugins/demo/assets/icon.svg")
    );
    expect(iconResults).toEqual([
      expect.objectContaining({
        featureId: "plugin-assets",
        sourceUnit: "plugin.demo.feature:assets",
        standardProfile: "agent-plugins-1.0",
        status: "target_native",
      }),
    ]);
  });
});

async function fixture(target: "claude" | "codex" | "cursor", pluginId: string): Promise<string> {
  const root = await createTestFixtureRoot("skillset-plugin-companions-");
  const files: Record<string, string> = {
    "skillset.yaml": `skillset:\n  name: companions\ncompile:\n  unsupportedDestination: warn\nclaude: ${target === "claude"}\ncodex: ${target === "codex"}\ncursor: ${target === "cursor"}\n`,
    [`.skillset/plugins/${pluginId}/skillset.yaml`]: `skillset:\n  name: ${pluginId}\n  description: Companion plugin.\n`,
    [`.skillset/plugins/${pluginId}/README.md`]: "# Companion plugin\n",
    [`.skillset/plugins/${pluginId}/assets/icon.svg`]: "<svg/>\n",
    [`.skillset/plugins/${pluginId}/scripts/setup.sh`]: "echo setup\n",
    [`.skillset/plugins/${pluginId}/src/index.js`]: "export {};\n",
    [`.skillset/plugins/${pluginId}/skills/demo/SKILL.md`]: "---\nname: demo\ndescription: Demo skill.\n---\n\nBody.\n",
  };
  for (const [path, content] of Object.entries(files)) await Bun.write(join(root, path), content);
  return root;
}
