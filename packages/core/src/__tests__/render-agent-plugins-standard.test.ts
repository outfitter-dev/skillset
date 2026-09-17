import { describe, expect, test } from "bun:test";
import { mkdtemp, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  getStandardProfile,
  type StandardProfileId,
} from "@skillset/registry";

import { normalizeSkillsetFixtureFiles } from "../../../../scripts/test-helpers/skillset-config";
import { renderBuildGraph } from "../render";
import { validateAgentPluginManifest } from "../render-agent-plugins-standard";
import { collectRenderResults } from "../render-result-collector";
import { loadBuildGraph } from "../resolver";
import type { BuildGraph, RenderedFile } from "../types";

const decoder = new TextDecoder();

describe("Agent Plugins standard rendering", () => {
  test("renders the Codex projection as a ChatGPT product bundle without a target alias", async () => {
    const graph = await fixtureGraph({
      ".skillset/plugins/demo/skillset.yaml": `
skillset:
  name: demo
  listing:
    display_name: Demo Plugin
    summary: Short description.
    description: Long description.
    logo_dark: ./assets/dark.svg
    screenshots: [./assets/shot.png]
  author:
    name: Demo Team
codex:
  interface:
    category: Developer Tools
mcp: true
`,
      ".skillset/plugins/demo/.mcp.json": `
{ "mcpServers": { "demo": { "command": "demo" } } }
`,
      ".skillset/plugins/demo/hooks/hooks.json": `
{ "hooks": { "PreToolUse": [] } }
`,
      ".skillset/plugins/demo/assets/dark.svg": "dark",
      ".skillset/plugins/demo/assets/shot.png": "shot",
      "skillset.yaml": `
skillset:
  name: chatgpt-root
claude: false
codex: true
cursor: false
`,
    });

    const rendered = await renderBuildGraph(graph);
    expect(json(rendered, "plugins/demo/chatgpt/plugin.json")).toEqual({
      $schema: "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
      author: { name: "Demo Team" },
      description: "Short description.",
      extensions: {
        "com.openai": {
          hooks: "./hooks/hooks.json",
          interface: {
            category: "Developer Tools",
            developerName: "Demo Team",
            displayName: "Demo Plugin",
            logoDark: "./assets/dark.svg",
            longDescription: "Long description.",
            screenshots: ["./assets/shot.png"],
            shortDescription: "Short description.",
          },
        },
      },
      name: "demo",
      version: "0.1.0",
    });
    expect(text(rendered, "plugins/demo/chatgpt/mcp.json")).toContain("mcpServers");
    expect(text(rendered, "plugins/demo/chatgpt/hooks/hooks.json")).toContain("PreToolUse");
    expect(rendered.some((file) => file.path.includes("/codex/"))).toBe(false);
  });

  test("rejects extension redirects and legacy root overrides before rendering", async () => {
    const graph = await fixtureGraph({
      ".skillset/plugins/demo/skillset.yaml": `
skillset:
  name: demo
codex:
  manifest:
    extensions:
      com.openai:
        skills: ./other-skills
`,
      "skillset.yaml": `
skillset:
  name: chatgpt-root
claude: false
codex: true
cursor: false
`,
    });
    await expect(renderBuildGraph(graph)).rejects.toThrow(
      "extensions.com.openai.skills is unsupported"
    );
  });

  test("renders the complete typed OpenAI interface with canonical app and hook paths", async () => {
    const graph = await fixtureGraph({
      ".skillset/plugins/demo/.app.json": `
{ "apps": { "Demo": { "id": "demo-connector", "category": "productivity" } } }
`,
      ".skillset/plugins/demo/assets/composer.svg": "composer",
      ".skillset/plugins/demo/assets/dark.svg": "dark",
      ".skillset/plugins/demo/assets/logo.svg": "logo",
      ".skillset/plugins/demo/assets/shot.png": "shot",
      ".skillset/plugins/demo/hooks/hooks.json": `
{ "hooks": { "Stop": [] } }
`,
      ".skillset/plugins/demo/skillset.yaml": `
skillset:
  name: demo
  listing:
    display_name: Demo
    summary: Summary
    description: Description
    capabilities: [Read, Write]
    category: Developer Tools
    website_url: https://example.com
    privacy_policy_url: https://example.com/privacy
    terms_of_service_url: https://example.com/terms
    default_prompt: [Help with this project]
    color: '#112233'
    composer_icon: ./assets/composer.svg
    logo: ./assets/logo.svg
    logo_dark: ./assets/dark.svg
    screenshots: [./assets/shot.png]
  author:
    name: Demo Team
`,
      "skillset.yaml": `
skillset:
  name: complete-interface-root
claude: false
codex: true
cursor: false
`,
    });

    const manifest = json(
      await renderBuildGraph(graph),
      "plugins/demo/chatgpt/plugin.json"
    );
    expect(manifest.extensions).toEqual({
      "com.openai": {
        apps: "./.app.json",
        hooks: "./hooks/hooks.json",
        interface: {
          brandColor: "#112233",
          capabilities: ["Read", "Write"],
          category: "Developer Tools",
          composerIcon: "./assets/composer.svg",
          defaultPrompt: ["Help with this project"],
          developerName: "Demo Team",
          displayName: "Demo",
          logo: "./assets/logo.svg",
          logoDark: "./assets/dark.svg",
          longDescription: "Description",
          privacyPolicyUrl: "https://example.com/privacy",
          screenshots: ["./assets/shot.png"],
          shortDescription: "Summary",
          termsOfServiceUrl: "https://example.com/terms",
          websiteUrl: "https://example.com",
        },
      },
    });
  });

  test("copies contained interface assets outside the conventional companion roots", async () => {
    const graph = await fixtureGraph({
      ".skillset/plugins/demo/icons/logo.png": "logo bytes",
      ".skillset/plugins/demo/media/shot.png": "screenshot bytes",
      ".skillset/plugins/demo/skillset.yaml": `
skillset:
  name: demo
  listing:
    logo: ./icons/logo.png
    screenshots: [./media/shot.png]
`,
      "skillset.yaml": `
skillset:
  name: interface-assets-root
claude: false
codex: true
cursor: false
`,
    });

    const rendered = await renderBuildGraph(graph);
    expect(text(rendered, "plugins/demo/chatgpt/icons/logo.png")).toBe(
      "logo bytes\n"
    );
    expect(text(rendered, "plugins/demo/chatgpt/media/shot.png")).toBe(
      "screenshot bytes\n"
    );
  });

  test("maps reviewed legacy .codex-plugin interface input into the modern extension", async () => {
    const graph = await fixtureGraph({
      ".skillset/plugins/demo/.codex-plugin/plugin.json": `
{ "name": "demo", "interface": { "category": "Developer Tools" } }
`,
      ".skillset/plugins/demo/skillset.yaml": `
skillset:
  name: demo
`,
      "skillset.yaml": `
skillset:
  name: legacy-input-root
claude: false
codex: true
cursor: false
`,
    });

    expect(
      json(await renderBuildGraph(graph), "plugins/demo/chatgpt/plugin.json")
    ).toMatchObject({
      extensions: { "com.openai": { interface: { category: "Developer Tools" } } },
    });
  });

  test("accepts a legacy license that matches resolved canonical metadata", async () => {
    const graph = await fixtureGraph({
      ".skillset/plugins/demo/.codex-plugin/plugin.json": `
{ "name": "demo", "license": "MIT" }
`,
      ".skillset/plugins/demo/skillset.yaml": `
skillset:
  name: demo
  license: MIT
`,
      "skillset.yaml": `
skillset:
  name: legacy-license-root
claude: false
codex: true
cursor: false
`,
    });

    expect(
      json(await renderBuildGraph(graph), "plugins/demo/chatgpt/plugin.json")
    ).toMatchObject({ license: "MIT" });
  });

  test("retains reviewed legacy interface fields beside an authored modern hook", async () => {
    const graph = await fixtureGraph({
      ".skillset/plugins/demo/.codex-plugin/plugin.json": `
{ "name": "demo", "interface": { "category": "Developer Tools" } }
`,
      ".skillset/plugins/demo/hooks/hooks.json": `
{ "hooks": { "Stop": [] } }
`,
      ".skillset/plugins/demo/skillset.yaml": `
skillset:
  name: demo
codex:
  manifest:
    extensions:
      com.openai:
        hooks: ./hooks/hooks.json
`,
      "skillset.yaml": `
skillset:
  name: legacy-modern-merge-root
claude: false
codex: true
cursor: false
`,
    });

    expect(
      json(await renderBuildGraph(graph), "plugins/demo/chatgpt/plugin.json")
    ).toMatchObject({
      extensions: {
        "com.openai": {
          hooks: "./hooks/hooks.json",
          interface: { category: "Developer Tools" },
        },
      },
    });
  });

  test("rejects a fixed extension path when its component is absent", async () => {
    const graph = await fixtureGraph({
      ".skillset/plugins/demo/skillset.yaml": `
skillset:
  name: demo
codex:
  manifest:
    extensions:
      com.openai:
        apps: ./.app.json
`,
      "skillset.yaml": `
skillset:
  name: missing-app-root
claude: false
codex: true
cursor: false
`,
    });

    await expect(renderBuildGraph(graph)).rejects.toThrow(
      "extensions.com.openai.apps requires an authored .app.json component"
    );
  });

  test("stops unmappable legacy component redirects before producing a ChatGPT package", async () => {
    const graph = await fixtureGraph({
      ".skillset/plugins/demo/.codex-plugin/plugin.json": `
{ "name": "demo", "skills": "./other-skills" }
`,
      ".skillset/plugins/demo/skillset.yaml": `
skillset:
  name: demo
`,
      "skillset.yaml": `
skillset:
  name: legacy-input-root
claude: false
codex: true
cursor: false
`,
    });

    await expect(renderBuildGraph(graph)).rejects.toThrow(
      "legacy .codex-plugin/plugin.json.skills must use the fixed ./skills/ component path"
    );
  });

  test("accepts the exact legacy fixed skills path without copying it into the modern manifest", async () => {
    const graph = await fixtureGraph({
      ".skillset/plugins/demo/.codex-plugin/plugin.json": `
{ "name": "demo", "skills": "./skills/" }
`,
      ".skillset/plugins/demo/skillset.yaml": `
skillset:
  name: demo
`,
      ".skillset/plugins/demo/skills/example/SKILL.md": `---
name: example
description: Example skill.
---

Use the example skill.
`,
      "skillset.yaml": `
skillset:
  name: legacy-fixed-skills-root
claude: false
codex: true
cursor: false
`,
    });

    const rendered = await renderBuildGraph(graph);
    const manifest = JSON.parse(
      text(rendered, "plugins/demo/chatgpt/plugin.json")
    ) as Record<string, unknown>;
    expect(manifest.skills).toBeUndefined();
    expect(text(rendered, "plugins/demo/chatgpt/skills/example/SKILL.md")).toContain(
      "Example skill."
    );
    expect(
      (manifest.extensions as Record<string, Record<string, unknown>>)["com.openai"]?.skills
    ).toBeUndefined();
  });

  test("validates legacy redirects even when an explicit modern extension wins precedence", async () => {
    const graph = await fixtureGraph({
      ".skillset/plugins/demo/.codex-plugin/plugin.json": `
{ "name": "demo", "skills": "./other-skills" }
`,
      ".skillset/plugins/demo/skillset.yaml": `
skillset:
  name: demo
codex:
  manifest:
    extensions:
      com.openai:
        interface:
          category: Developer Tools
`,
      "skillset.yaml": `
skillset:
  name: legacy-precedence-root
claude: false
codex: true
cursor: false
`,
    });

    await expect(renderBuildGraph(graph)).rejects.toThrow(
      "legacy .codex-plugin/plugin.json.skills must use the fixed ./skills/ component path"
    );
  });

  test("keeps SSE in the portable MCP component while reporting the Codex runtime gap", async () => {
    const graph = await fixtureGraph({
      ".skillset/plugins/demo/.mcp.json": `
{ "mcpServers": { "events": { "type": "sse", "url": "https://mcp.example.com/events" } } }
`,
      ".skillset/plugins/demo/skillset.yaml": `
skillset:
  name: demo
mcp: true
`,
      "skillset.yaml": `
skillset:
  name: sse-root
claude: false
codex: true
cursor: false
`,
    });
    const rendered = await renderBuildGraph(graph);
    expect(json(rendered, "plugins/demo/chatgpt/mcp.json")).toMatchObject({
      mcpServers: { events: { type: "sse" } },
    });
    expect(
      collectRenderResults(graph, rendered, {
        claudeMarketplacePlugins: [],
        includedPaths: new Set(paths(rendered)),
        scopes: ["plugins"],
      })
    ).toContainEqual(
      expect.objectContaining({
        featureId: "plugin-mcp",
        status: "unsupported",
        target: "codex",
      })
    );
  });

  test("keeps Codex-specific skill sidecars out of the ChatGPT fixed skills component", async () => {
    const graph = await fixtureGraph({
      ".skillset/plugins/demo/skillset.yaml": `
skillset:
  name: demo
`,
      ".skillset/plugins/demo/skills/review/SKILL.md": `
---
name: review
description: Portable review instructions.
metadata:
  local: value
---

Review the change.
`,
      ".skillset/plugins/demo/skills/review/agents/openai.yaml": `
policy:
  allow_implicit_invocation: true
`,
      "skillset.yaml": `
skillset:
  name: chatgpt-root
claude: false
codex: true
cursor: false
`,
    });
    const rendered = await renderBuildGraph(graph);
    const skill = text(rendered, "plugins/demo/chatgpt/skills/review/SKILL.md");
    expect(skill).toContain("Portable review instructions.");
    expect(skill).not.toContain("allow_implicit_invocation");
    expect(rendered.some((file) => file.path.endsWith("chatgpt/skills/review/agents/openai.yaml"))).toBe(false);
  });

  test("rejects a ChatGPT interface asset symlink that escapes the plugin", async () => {
    const root = await fixtureRoot({
      ".skillset/plugins/demo/skillset.yaml": `
skillset:
  name: demo
  listing:
    logo: ./assets/logo.svg
`,
      ".skillset/plugins/demo/assets/.keep": "keep\n",
      "skillset.yaml": `
skillset:
  name: chatgpt-asset-root
claude: false
codex: true
cursor: false
`,
    });
    const outside = await mkdtemp(join(tmpdir(), "skillset-chatgpt-asset-"));
    await Bun.write(join(outside, "logo.svg"), "outside asset\n");
    await symlink(
      join(outside, "logo.svg"),
      join(root, ".skillset/plugins/demo/assets/logo.svg")
    );

    await expect(renderBuildGraph(await loadBuildGraph(root))).rejects.toThrow(
      "resolves outside the plugin root"
    );
  });

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

  test("keeps the provider repository README stable in a combined build", async () => {
    const graph = adopted(
      await fixtureGraph({
        ".skillset/plugins/demo/skillset.yaml": `
skillset:
  name: demo
`,
        "skillset.yaml": `
skillset:
  name: combined-workspace
claude: false
codex: true
cursor: false
`,
      }),
      ["agent-plugins-1.0"]
    );

    const rendered = await renderBuildGraph(graph);
    expect(text(rendered, "plugins/README.md")).toBe(
      "# Skillset Plugins\n\n" +
        "Generated Skillset plugin repository.\n\n" +
        "- `<plugin-id>/chatgpt/` contains each ChatGPT product bundle selected through the Codex target.\n" +
        "- `skillset.lock` records deterministic generated-state provenance.\n"
    );
    expect(paths(rendered)).toContain("plugins/demo/agents/plugin.json");
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
        ".skillset/plugins/demo/subagents/reviewer.md": "Review.",
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
        ".skillset/plugins/demo/subagents/reviewer.md": "Review.",
        ".skillset/plugins/demo/bin/demo": "#!/bin/sh\nexit 0",
        ".skillset/plugins/demo/commands/run.md": "Run.",
        ".skillset/plugins/demo/.mcp.json": `
{
  "mcpServers": {
    "oauth": {
      "oauth": { "clientId": "example" },
      "type": "streamable-http",
      "url": "https://secure.example.com/mcp"
    }
  }
}
`,
        ".skillset/plugins/demo/settings.json": "{}",
        ".skillset/plugins/demo/skillset.yaml": `
skillset:
  name: demo
bin: true
mcp: true
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
    const standardMcp = results.find(
      (result) =>
        result.featureId === "plugin-mcp" &&
        result.standardProfile === "agent-plugins-1.0"
    );
    const profile = getStandardProfile("agent-plugins-1.0");
    expect(
      standardMcp?.evidence?.map((evidence) => ({
        ref: evidence.ref,
        verifiedAt: evidence.verifiedAt,
      }))
    ).toEqual(
      profile.provenance.snapshots.map((snapshot) => ({
        ref: snapshot.url,
        verifiedAt: profile.provenance.observedAt,
      }))
    );
  });

  test("reports plugin attachments to workspace hooks as uncovered", async () => {
    const graph = adopted(
      await fixtureGraph({
        ".skillset/hooks/shared.json": JSON.stringify({
          events: ["SessionStart"],
          run: { command: "echo shared" },
        }),
        ".skillset/plugins/demo/skillset.yaml": `
skillset:
  name: demo
hooks:
  SessionStart:
    - shared
`,
        "skillset.yaml": `
skillset:
  name: workspace-hook-attachment
claude: false
codex: false
cursor: false
`,
      }),
      ["agent-plugins-1.0"]
    );
    expect(graph.plugins[0]?.adaptiveHooks).toEqual([]);
    expect(graph.plugins[0]?.hookAttachments).toHaveLength(1);

    const files = await renderBuildGraph(graph);
    const results = collectRenderResults(graph, files, {
      claudeMarketplacePlugins: [],
      includedPaths: new Set(paths(files)),
      scopes: ["plugins"],
    });
    expect(paths(files)).not.toContain("plugins/demo/agents/hooks/hooks.json");
    expect(results).toContainEqual(
      expect.objectContaining({
        destination: "hooks",
        featureId: "plugin-hooks",
        sourcePath: ".skillset/plugins/demo/skillset.yaml",
        sourceUnit: "plugin.demo.feature:hooks",
        standardProfile: "agent-plugins-1.0",
        status: "unsupported",
      })
    );
  });

  test("keeps package skills when the standalone Agent Skills profile is not adopted", async () => {
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

  test("rejects a special-file license without blocking on open", async () => {
    if (process.platform === "win32") return;
    const root = await fixtureRoot({
      ".skillset/plugins/demo/skillset.yaml": `
skillset:
  name: demo
`,
      "skillset.yaml": `
skillset:
  name: special-license-workspace
claude: false
codex: false
cursor: false
`,
    });
    const licensePath = join(root, ".skillset/plugins/demo/LICENSE.txt");
    const proc = Bun.spawn({
      cmd: ["mkfifo", licensePath],
      stderr: "pipe",
      stdout: "pipe",
    });
    expect(await proc.exited).toBe(0);
    const graph = adopted(await loadBuildGraph(root), ["agent-plugins-1.0"]);

    await expect(renderBuildGraph(graph)).rejects.toThrow(
      "must be a regular file"
    );
  });

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
      adoptionReceiptHashes: Object.fromEntries(
        profiles.map((profile) => [profile, TEST_RECEIPT_HASH])
      ),
    },
  };
}

const TEST_RECEIPT_HASH = `sha256:${"a".repeat(64)}` as const;

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
