import { describe, expect, it } from "bun:test";

import {
  pluginManifestPath,
  pluginPathPartsForOutput,
  pluginTargetForOutputPath,
  pluginTargetRoot,
  providerSourceForPlugin,
} from "../plugin-output";
import type { BuildGraph } from "../types";

const graph = {
  plugins: [{ id: "trails" }],
  root: {
    outputs: {
      plugins: { claude: "plugins", codex: "plugins", cursor: "plugins" },
    },
  },
} as unknown as BuildGraph;

describe("plugin package roots", () => {
  it("uses one root with provider manifests side by side", () => {
    for (const target of ["claude", "codex", "cursor"] as const) {
      expect(pluginTargetRoot("plugins", target, "trails")).toBe(
        "plugins/trails"
      );
      expect(providerSourceForPlugin("plugins", target, { id: "trails" })).toBe(
        "./plugins/trails"
      );
    }

    expect(pluginManifestPath("plugins", "claude", { id: "trails" })).toBe(
      "plugins/trails/.claude-plugin/plugin.json"
    );
    expect(pluginManifestPath("plugins", "codex", { id: "trails" })).toBe(
      "plugins/trails/plugin.json"
    );
    expect(pluginManifestPath("plugins", "cursor", { id: "trails" })).toBe(
      "plugins/trails/.cursor-plugin/plugin.json"
    );
  });

  it("recovers package paths without provider directory segments", () => {
    expect(
      pluginPathPartsForOutput(
        graph,
        "plugins",
        "claude",
        "plugins/trails/skills/hike/SKILL.md"
      )
    ).toEqual({ pluginId: "trails", pluginPath: "skills/hike/SKILL.md" });
    expect(
      pluginTargetForOutputPath(
        graph,
        "plugins/trails/.claude-plugin/plugin.json"
      )
    ).toBe("claude");
    expect(
      pluginTargetForOutputPath(graph, "plugins/trails/plugin.json")
    ).toBe("codex");
    expect(
      pluginTargetForOutputPath(graph, "plugins/trails/skills/hike/SKILL.md")
    ).toBeUndefined();
  });
});
