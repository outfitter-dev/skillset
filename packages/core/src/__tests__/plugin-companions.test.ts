import { describe, expect, it } from "bun:test";
import { join } from "node:path";

import { buildSkillsetResult, diffSkillsetResult } from "../build";
import { createTestFixtureRoot } from "../../../../scripts/test-helpers/fixture-root";

// Valid as a Skillset plugin slug, but past the Agent Plugins 1.0 name limit.
const LONG_PLUGIN_ID = `long-${"x".repeat(65)}`;

describe("plugin companions", () => {
  it("keeps claude companions when the Agent Plugins baseline is unsupported", async () => {
    const root = await fixture("claude", LONG_PLUGIN_ID);

    const result = await buildSkillsetResult(root);
    expect(result.ok).toBe(true);
    for (const path of ["README.md", "scripts/setup.sh", "src/index.js"]) {
      expect(await Bun.file(join(root, "plugins", LONG_PLUGIN_ID, path)).exists()).toBe(true);
    }
  });

  it("does not copy companions whose cursor registry support is still planned", async () => {
    const root = await fixture("cursor", LONG_PLUGIN_ID);

    const result = await buildSkillsetResult(root);
    expect(result.ok).toBe(true);
    for (const path of ["README.md", "assets/icon.svg", "scripts/setup.sh", "src/index.js"]) {
      expect(await Bun.file(join(root, "plugins", LONG_PLUGIN_ID, path)).exists()).toBe(false);
    }
    const { renderResults } = await diffSkillsetResult(root);
    expect(
      renderResults.filter((outcome) =>
        ["plugin-assets", "plugin-readme", "plugin-scripts", "plugin-src"].includes(outcome.featureId)
      )
    ).toEqual([]);
  });

  it("changes the fallback plugin source hash when a copied README changes", async () => {
    const root = await fixture("claude", LONG_PLUGIN_ID);

    expect((await buildSkillsetResult(root)).ok).toBe(true);
    const before = await pluginSourceHash(root, LONG_PLUGIN_ID);
    await Bun.write(join(root, ".skillset/plugins", LONG_PLUGIN_ID, "README.md"), "# Companion plugin, revised\n");
    expect((await buildSkillsetResult(root)).ok).toBe(true);

    expect(await pluginSourceHash(root, LONG_PLUGIN_ID)).not.toBe(before);
  });

  it("keeps codex assets when the Agent Plugins baseline is unsupported", async () => {
    const root = await fixture("codex", LONG_PLUGIN_ID);

    const result = await buildSkillsetResult(root);
    expect(result.ok).toBe(true);
    for (const path of ["README.md", "assets/icon.svg", "scripts/setup.sh", "src/index.js"]) {
      expect(await Bun.file(join(root, "plugins", LONG_PLUGIN_ID, path)).exists()).toBe(true);
    }
  });

  it("reports a standard-owned baseline companion as rendered for its standard profile", async () => {
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
        status: "rendered",
      }),
    ]);
    expect(iconResults[0]?.target).toBeUndefined();
  });

  it("keeps provider-owned fallback companions target native", async () => {
    const root = await fixture("codex", LONG_PLUGIN_ID);

    const { renderResults } = await diffSkillsetResult(root);
    const iconResults = renderResults.filter((result) =>
      result.outputs?.some((output) => output.path === `plugins/${LONG_PLUGIN_ID}/assets/icon.svg`)
    );
    expect(iconResults).toEqual([
      expect.objectContaining({ featureId: "plugin-assets", status: "target_native", target: "codex" }),
    ]);
  });
});

async function pluginSourceHash(root: string, pluginId: string): Promise<string | undefined> {
  const lock: unknown = await Bun.file(join(root, "plugins/skillset.lock")).json();
  if (typeof lock !== "object" || lock === null || !("items" in lock) || !Array.isArray(lock.items)) return undefined;
  for (const item of lock.items) {
    if (typeof item !== "object" || item === null) continue;
    if ("kind" in item && item.kind === "plugin" && "name" in item && item.name === pluginId && "sourceHash" in item) {
      return typeof item.sourceHash === "string" ? item.sourceHash : undefined;
    }
  }
  return undefined;
}

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
