import { describe, expect, test } from "bun:test";
import { mkdtemp, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { StandardProfileId } from "@skillset/registry";

import { normalizeSkillsetFixtureFiles } from "../../../../scripts/test-helpers/skillset-config";
import { renderBuildGraph } from "../render";
import { validateAgentPluginManifest } from "../render-agent-plugins-standard";
import { collectRenderResults } from "../render-result-collector";
import { loadBuildGraph } from "../resolver";
import type { BuildGraph, RenderedFile } from "../types";

const decoder = new TextDecoder();

describe("Agent Plugins standard rendering", () => {
  test("renders a valid minimal package without skills or MCP", async () => {
    const graph = adopted(
      await fixtureGraph({
        ".skillset/plugins/demo/skillset.yaml": `
skillset:
  name: demo
`,
        "skillset.yaml": `
skillset:
  name: minimal-workspace
claude: false
codex: false
cursor: false
`,
      }),
      ["agent-plugins-1.0"]
    );

    const rendered = await renderBuildGraph(graph);
    expect(json(rendered, "plugins/demo/agents/plugin.json")).toEqual({
      $schema: "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
      description: "demo",
      name: "demo",
      version: "0.1.0",
    });
    expect(text(rendered, "plugins/README.md")).toContain(
      "`<plugin-id>/agents/`"
    );
    expect(lockItems(rendered, "plugins/skillset.lock")).toContainEqual(
      expect.objectContaining({
        consumers: [
          { phase: "baseline", standardProfile: "agent-plugins-1.0" },
        ],
        files: ["demo/agents/plugin.json"],
        kind: "plugin",
        name: "demo",
        outputPath: "demo/agents/plugin.json",
        owner: { standardProfile: "agent-plugins-1.0" },
        validation: "structured",
      })
    );
  });

  test("renders only closed standard metadata with plugin author precedence", async () => {
    const graph = adopted(
      await fixtureGraph({
        ".skillset/plugins/demo/skillset.yaml": `
skillset:
  name: demo
  version: 3.1.4
  description: Detailed package description.
  author:
    name: Plugin Author
    email: plugin@example.com
    url: https://example.com/plugin
    organization: Hidden Org
  homepage: https://example.com/demo
  repository: https://github.com/example/demo
  license: Apache-2.0
  keywords: [agents, portable]
  manifest:
    name: provider-override
    commands: ./commands
claude:
  manifest:
    experimental: provider-only
`,
        "skillset.yaml": `
skillset:
  name: metadata-workspace
  version: 2.0.0
  author:
    name: Workspace Author
    email: workspace@example.com
    url: https://example.com/workspace
claude: false
codex: false
cursor: false
`,
      }),
      ["agent-plugins-1.0"]
    );

    const manifest = json(
      await renderBuildGraph(graph),
      "plugins/demo/agents/plugin.json"
    );
    expect(manifest).toEqual({
      $schema: "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
      author: {
        email: "plugin@example.com",
        name: "Plugin Author",
        url: "https://example.com/plugin",
      },
      description: "Detailed package description.",
      homepage: "https://example.com/demo",
      keywords: ["agents", "portable"],
      license: "Apache-2.0",
      name: "demo",
      repository: "https://github.com/example/demo",
      version: "3.1.4",
    });
    expect(manifest).not.toHaveProperty("commands");
    expect(manifest).not.toHaveProperty("extensions");
    expect(manifest).not.toHaveProperty("experimental");
  });

  test("rejects fields outside the pinned closed manifest schema", () => {
    expect(() =>
      validateAgentPluginManifest({
        $schema: "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
        commands: "./commands",
        name: "demo",
      })
    ).toThrow("unknown field commands");
  });

  test("does not write any standard package files for a standard-invalid plugin name", async () => {
    const loaded = await fixtureGraph({
      ".skillset/plugins/demo/skills/review/SKILL.md": `
---
name: review
description: Review a change.
---

Review.
`,
      ".skillset/plugins/demo/skillset.yaml": `
skillset:
  name: demo
`,
      "skillset.yaml": `
skillset:
  name: invalid-name-workspace
claude: true
codex: false
cursor: false
`,
    });
    const plugin = loaded.plugins[0];
    if (plugin === undefined) throw new Error("missing fixture plugin");
    const graph = adopted(
      {
        ...loaded,
        plugins: [{ ...plugin, id: "bad--name" }],
      },
      ["agent-plugins-1.0"]
    );

    const rendered = await renderBuildGraph(graph);
    expect(
      paths(rendered).some((path) =>
        path.startsWith("plugins/bad--name/agents/")
      )
    ).toBe(false);
    expect(paths(rendered)).toContain(
      "plugins/bad--name/claude/.claude-plugin/plugin.json"
    );
    const results = collectRenderResults(graph, rendered, {
      claudeMarketplacePlugins: [],
      includedPaths: new Set(paths(rendered)),
      scopes: ["plugins"],
    });
    expect(results).toContainEqual(
      expect.objectContaining({
        featureId: "plugin-manifests",
        standardProfile: "agent-plugins-1.0",
        status: "unsupported",
      })
    );
  });

  test("copies only neutral support files into the package root", async () => {
    const graph = adopted(
      await fixtureGraph({
        ".skillset/plugins/demo/CHANGELOG.md": "# Changes",
        ".skillset/plugins/demo/README.md": "# Demo",
        ".skillset/plugins/demo/agents/reviewer.md": "Review.",
        ".skillset/plugins/demo/assets/icon.svg": "<svg />",
        ".skillset/plugins/demo/bin/demo": "#!/bin/sh\nexit 0",
        ".skillset/plugins/demo/commands/run.md": "Run.",
        ".skillset/plugins/demo/scripts/setup.sh": "#!/bin/sh\nexit 0",
        ".skillset/plugins/demo/skillset.yaml": `
skillset:
  name: demo
`,
        ".skillset/plugins/demo/src/index.ts": "export const demo = true;",
        ".skillset/plugins/demo/themes/theme.json": "{}",
        "skillset.yaml": `
skillset:
  name: support-files-workspace
  license: MIT
claude: false
codex: false
cursor: false
`,
      }),
      ["agent-plugins-1.0"]
    );

    const rendered = await renderBuildGraph(graph);
    expect(paths(rendered)).toEqual(
      expect.arrayContaining([
        "plugins/demo/agents/plugin.json",
        "plugins/demo/agents/README.md",
        "plugins/demo/agents/CHANGELOG.md",
        "plugins/demo/agents/LICENSE.txt",
        "plugins/demo/agents/assets/icon.svg",
        "plugins/demo/agents/scripts/setup.sh",
        "plugins/demo/agents/src/index.ts",
      ])
    );
    expect(
      paths(rendered).some((path) =>
        path.startsWith("plugins/demo/agents/bin/")
      )
    ).toBe(false);
    expect(
      paths(rendered).some((path) =>
        path.startsWith("plugins/demo/agents/commands/")
      )
    ).toBe(false);
    expect(
      paths(rendered).some((path) =>
        path.startsWith("plugins/demo/agents/agents/")
      )
    ).toBe(false);
    expect(
      paths(rendered).some((path) =>
        path.startsWith("plugins/demo/agents/themes/")
      )
    ).toBe(false);
  });

  test("reports provider-only package features as uncovered standard results", async () => {
    const graph = adopted(
      await fixtureGraph({
        ".skillset/plugins/demo/agents/reviewer.md": "Review.",
        ".skillset/plugins/demo/bin/demo": "#!/bin/sh\nexit 0",
        ".skillset/plugins/demo/commands/run.md": "Run.",
        ".skillset/plugins/demo/settings.json": "{}",
        ".skillset/plugins/demo/skillset.yaml": `
skillset:
  name: demo
bin: true
dependencies:
  plugins:
    - name: external-tools
      range: ^1.0.0
`,
        ".skillset/plugins/demo/themes/theme.json": "{}",
        "skillset.yaml": `
skillset:
  name: coverage-workspace
compile:
  unsupportedDestination: warn
claude: false
codex: false
cursor: false
`,
      }),
      ["agent-plugins-1.0"]
    );

    const files = await renderBuildGraph(graph);
    const results = collectRenderResults(graph, files, {
      claudeMarketplacePlugins: [],
      includedPaths: new Set(paths(files)),
      scopes: ["plugins"],
    });
    const uncovered = results
      .filter(
        (result) =>
          result.standardProfile === "agent-plugins-1.0" &&
          result.status === "unsupported"
      )
      .map((result) => result.featureId);
    expect(uncovered).toEqual(
      expect.arrayContaining([
        "plugin-agents",
        "plugin-bin",
        "plugin-commands",
        "plugin-themes",
        "future-companion-source-pointers",
        "dependencies",
      ])
    );
    expect(results).toContainEqual(
      expect.objectContaining({
        destination: "settings.json",
        featureId: "future-companion-source-pointers",
        standardProfile: "agent-plugins-1.0",
        status: "unsupported",
      })
    );
    expect(results).toContainEqual(
      expect.objectContaining({
        featureId: "plugin-manifests",
        outputs: [{ kind: "plugin", path: "plugins/demo/agents/plugin.json" }],
        standardProfile: "agent-plugins-1.0",
        status: "rendered",
      })
    );
  });

  test("keeps package skills when the standalone Agent Skills projection is disabled", async () => {
    const graph = adopted(
      await fixtureGraph({
        ".skillset/plugins/demo/skills/review/SKILL.md": `
---
name: review
description: Review a change.
---

Review.
`,
        ".skillset/plugins/demo/skillset.yaml": `
skillset:
  name: demo
`,
        "skillset.yaml": `
skillset:
  name: package-skills-workspace
compile:
  agents:
    instructions: false
    plugins: true
    skills: false
claude: false
codex: false
cursor: false
`,
      }),
      ["agent-plugins-1.0"]
    );

    const files = await renderBuildGraph(graph);
    expect(paths(files)).toContain(
      "plugins/demo/agents/skills/review/SKILL.md"
    );
    expect(paths(files)).not.toContain(".agents/skills/review/SKILL.md");
  });

  test.each(["top-level", "nested"])(
    "rejects a %s symlink in neutral support files",
    async (kind) => {
      const root = await fixtureRoot({
        ".skillset/plugins/demo/skillset.yaml": `
skillset:
  name: demo
`,
        "skillset.yaml": `
skillset:
  name: support-symlink-workspace
claude: false
codex: false
cursor: false
`,
        ...(kind === "nested"
          ? { ".skillset/plugins/demo/assets/.keep": "keep" }
          : {}),
      });
      const outside = await mkdtemp(
        join(tmpdir(), "skillset-agent-plugin-support-")
      );
      await Bun.write(join(outside, "secret.txt"), "secret\n");
      const linkPath =
        kind === "top-level"
          ? join(root, ".skillset/plugins/demo/assets")
          : join(root, ".skillset/plugins/demo/assets/secret.txt");
      if (kind === "nested") {
        await symlink(join(outside, "secret.txt"), linkPath);
      } else {
        await symlink(outside, linkPath);
      }
      const graph = adopted(await loadBuildGraph(root), ["agent-plugins-1.0"]);

      await expect(renderBuildGraph(graph)).rejects.toThrow(
        "must not be a symbolic link"
      );
    }
  );

  test.each(["plugin", "workspace"])(
    "rejects a symbolic-link %s license before package emission",
    async (owner) => {
      const root = await fixtureRoot({
        ".skillset/plugins/demo/skillset.yaml": `
skillset:
  name: demo
`,
        "skillset.yaml": `
skillset:
  name: license-symlink-workspace
claude: false
codex: false
cursor: false
`,
      });
      const outside = await mkdtemp(
        join(tmpdir(), "skillset-agent-plugin-license-")
      );
      const outsideLicense = join(outside, "LICENSE.txt");
      await Bun.write(outsideLicense, "external license\n");
      await symlink(
        outsideLicense,
        owner === "plugin"
          ? join(root, ".skillset/plugins/demo/LICENSE.txt")
          : join(root, ".skillset/LICENSE.txt")
      );
      const graph = adopted(await loadBuildGraph(root), ["agent-plugins-1.0"]);

      await expect(renderBuildGraph(graph)).rejects.toThrow(
        "must not be a symbolic link"
      );
    }
  );

  test("reports provider-only symlinks without traversing external or cyclic directories", async () => {
    const root = await fixtureRoot({
      ".skillset/plugins/demo/skillset.yaml": `
skillset:
  name: demo
`,
      "skillset.yaml": `
skillset:
  name: provider-symlink-workspace
compile:
  unsupportedDestination: warn
claude: false
codex: false
cursor: false
`,
    });
    const graph = adopted(await loadBuildGraph(root), ["agent-plugins-1.0"]);
    const pluginRoot = join(root, ".skillset/plugins/demo");
    const outside = await mkdtemp(
      join(tmpdir(), "skillset-agent-plugin-provider-")
    );
    await Bun.write(join(outside, "run.md"), "Run.\n");
    await symlink(outside, join(pluginRoot, "commands"));
    await Bun.write(join(pluginRoot, "rules/.keep"), "keep\n");
    await symlink(pluginRoot, join(pluginRoot, "rules/cycle"));

    const files = await renderBuildGraph(graph);
    const results = collectRenderResults(graph, files, {
      claudeMarketplacePlugins: [],
      includedPaths: new Set(paths(files)),
      scopes: ["plugins"],
    });
    expect(results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          destination: "commands",
          featureId: "plugin-commands",
          status: "unsupported",
        }),
        expect.objectContaining({
          destination: "rules",
          featureId: "plugin-rules",
          status: "unsupported",
        }),
      ])
    );
  });
});

function adopted(
  graph: BuildGraph,
  profiles: readonly StandardProfileId[]
): BuildGraph {
  return {
    ...graph,
    standardProjections: {
      adopted: profiles,
      explicitNonAdopted: [],
    },
  };
}

function paths(files: readonly RenderedFile[]): readonly string[] {
  return files.map((file) => file.path);
}

function text(files: readonly RenderedFile[], path: string): string {
  const file = files.find((candidate) => candidate.path === path);
  if (file === undefined) throw new Error(`missing rendered file ${path}`);
  return decoder.decode(file.content);
}

function json(
  files: readonly RenderedFile[],
  path: string
): Record<string, unknown> {
  return JSON.parse(text(files, path)) as Record<string, unknown>;
}

function lockItems(
  files: readonly RenderedFile[],
  path: string
): Record<string, unknown>[] {
  return (json(files, path).items ?? []) as Record<string, unknown>[];
}

async function fixtureGraph(
  files: Record<string, string>
): Promise<BuildGraph> {
  return loadBuildGraph(await fixtureRoot(files));
}

async function fixtureRoot(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "skillset-agent-plugins-"));
  for (const [path, content] of Object.entries(
    normalizeSkillsetFixtureFiles(files)
  )) {
    await Bun.write(join(root, path), `${content.trim()}\n`);
  }
  return root;
}
