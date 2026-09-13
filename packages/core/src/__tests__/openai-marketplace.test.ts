import { describe, expect, test } from "bun:test";
import { mkdtemp, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { normalizeSkillsetFixtureFiles } from "../../../../scripts/test-helpers/skillset-config";
import { checkProviderFormatConformance } from "../provider-format-conformance";
import { renderBuildGraph } from "../render";
import { collectRenderResults } from "../render-result-collector";
import { loadBuildGraph } from "../resolver";
import type {
  BuildGraph,
  MarketplaceCatalogConfig,
  MarketplacePluginEntryConfig,
  RenderedFile,
} from "../types";

const decoder = new TextDecoder();

describe("ChatGPT marketplace rendering", () => {
  test("derives one implicit local catalog from rendered ChatGPT packages", async () => {
    const graph = await fixtureGraph({
      ".skillset/plugins/tools/skillset.yaml": `
skillset:
  name: tools
  listing:
    display_name: Tool Chest
    summary: Useful tools.
    category: Developer Tools
  author:
    name: Tools Team
`,
      "skillset.yaml": `
skillset:
  name: acme
claude: false
codex: true
cursor: false
`,
    });

    const rendered = await renderBuildGraph(graph);
    expect(json(rendered, ".agents/plugins/marketplace.json")).toEqual({
      name: "acme",
      interface: { displayName: "acme" },
      plugins: [
        expect.objectContaining({
          name: "tools",
          source: {
            source: "local",
            path: "./plugins/tools/chatgpt",
          },
          policy: {
            installation: "AVAILABLE",
            authentication: "ON_INSTALL",
          },
          category: "Developer Tools",
          description: "Useful tools.",
          author: { name: "Tools Team" },
          interface: expect.objectContaining({
            displayName: "Tool Chest",
            category: "Developer Tools",
          }),
        }),
      ],
    });
    expect(
      checkProviderFormatConformance(
        rendered.filter(
          (file) => file.path === ".agents/plugins/marketplace.json"
        )
      ).ok
    ).toBe(true);
    expect(json(rendered, "skillset.lock").items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          consumers: [{ phase: "delta", target: "codex" }],
          feature: "marketplaces",
          files: [".agents/plugins/marketplace.json"],
          name: "chatgpt-marketplace",
          owner: { target: "codex" },
          outputPath: ".agents/plugins/marketplace.json",
        }),
      ])
    );
    const results = collectRenderResults(graph, rendered, {
      claudeMarketplacePlugins: [],
      includedPaths: new Set(rendered.map((file) => file.path)),
    });
    expect(results).toContainEqual(
      expect.objectContaining({
        destination: "marketplaces",
        evidence: expect.arrayContaining([
          expect.objectContaining({
            kind: "source",
            ref: "packages/registry/src/openai-marketplace-evidence.ts",
          }),
          expect.objectContaining({
            kind: "test",
            ref: "scripts/__tests__/provider-validation.test.ts",
          }),
        ]),
        featureId: "marketplaces",
        outputs: [
          {
            kind: "plugin-feature",
            path: ".agents/plugins/marketplace.json",
          },
        ],
        sourceUnit: "skillset.yaml",
        status: "target_native",
        target: "codex",
      })
    );
  });

  test("points implicit entries at a custom modern bundle root", async () => {
    const graph = await fixtureGraph({
      ".skillset/plugins/tools/skillset.yaml": "skillset:\n  name: tools",
      "skillset.yaml": `
skillset:
  name: custom-root
claude: false
codex:
  plugins:
    path: generated/chatgpt
cursor: false
`,
    });

    const catalog = json(
      await renderBuildGraph(graph),
      ".agents/plugins/marketplace.json"
    );
    const plugins = catalog.plugins as Record<string, unknown>[];
    expect(plugins[0]?.source).toEqual({
      source: "local",
      path: "./generated/chatgpt/plugins/tools",
    });
  });

  test("preserves configured order and applies typed listing precedence", async () => {
    const graph = await fixtureGraph({
      ".skillset/plugins/alpha/assets/logo.svg": "logo",
      ".skillset/plugins/alpha/skillset.yaml": `
skillset:
  name: alpha
  homepage: https://package.example/alpha
  listing:
    display_name: Package Alpha
    category: Package Category
    logo: ./assets/logo.svg
`,
      "skillset.yaml": `
skillset:
  name: configured
claude: false
codex: true
cursor: false
marketplaces:
  curated:
    title: Curated
    targets: [codex]
    plugins:
      - plugin: remote
        codex:
          source:
            source: url
            url: https://example.com/remote.git
          category: Remote Category
          interface:
            displayName: Remote
            logo: ./assets/remote.svg
      - plugin: alpha
        codex:
          category: Marketplace Category
          displayName: Legacy Alpha
          homepage: https://catalog.example/alpha
          interface:
            displayName: Nested Alpha
            websiteUrl: https://explicit.example/alpha
          policy:
            products: []
`,
    });

    const catalog = json(
      await renderBuildGraph(graph),
      ".agents/plugins/marketplace.json"
    );
    const plugins = catalog.plugins as Record<string, unknown>[];
    expect(plugins.map((plugin) => plugin.name)).toEqual(["remote", "alpha"]);
    expect(plugins[0]).toEqual(
      expect.objectContaining({
        category: "Remote Category",
        interface: {
          displayName: "Remote",
          category: "Remote Category",
        },
      })
    );
    expect(plugins[1]).toEqual(
      expect.objectContaining({
        category: "Marketplace Category",
        homepage: "https://package.example/alpha",
        policy: {
          installation: "AVAILABLE",
          authentication: "ON_INSTALL",
          products: [],
        },
        interface: expect.objectContaining({
          category: "Marketplace Category",
          displayName: "Nested Alpha",
          logo: "./assets/logo.svg",
          websiteUrl: "https://explicit.example/alpha",
        }),
      })
    );
  });

  test("keeps a materialized local manifest authoritative over catalog fallback metadata", async () => {
    const graph = await fixtureGraph({
      ".skillset/plugins/alpha/skillset.yaml": `
skillset:
  name: alpha
  version: 3.1.4
  description: Package description.
  homepage: https://package.example/alpha
  keywords: [package, local]
  author:
    name: Package Author
`,
      "skillset.yaml": `
skillset:
  name: configured
claude: false
codex: true
cursor: false
marketplaces:
  curated:
    targets: [codex]
    plugins:
      - id: catalog-alias
        plugin: alpha
        codex:
          source:
            source: local
            path: ./plugins/alpha/chatgpt
          version: 9.9.9
          description: Catalog fallback.
          homepage: https://catalog.example/alpha
          keywords: [catalog]
          author:
            name: Catalog Author
`,
    });

    const catalog = json(
      await renderBuildGraph(graph),
      ".agents/plugins/marketplace.json"
    );
    expect((catalog.plugins as Record<string, unknown>[])[0]).toEqual(
      expect.objectContaining({
        name: "catalog-alias",
        version: "3.1.4",
        description: "Package description.",
        homepage: "https://package.example/alpha",
        keywords: ["package", "local"],
        author: { name: "Package Author" },
      })
    );
  });

  test("rejects a configured local source without a matching source plugin", async () => {
    const graph = await fixtureGraph({
      "skillset.yaml": `
skillset:
  name: local-source
claude: false
codex: true
cursor: false
marketplaces:
  curated:
    targets: [codex]
    plugins:
      - plugin: missing
        codex:
          source:
            source: local
            path: ./plugins/missing/chatgpt
`,
    });

    await expect(renderBuildGraph(graph)).rejects.toThrow(
      "ChatGPT marketplace entry missing requires a materialized local plugin package"
    );
  });

  test("rejects a configured local source whose plugin is not materialized", async () => {
    const graph = await fixtureGraph({
      ".skillset/plugins/alpha/skillset.yaml": "skillset:\n  name: alpha",
      "skillset.yaml": `
skillset:
  name: local-source
claude: false
codex:
  plugins: []
cursor: false
marketplaces:
  curated:
    targets: [codex]
    plugins:
      - plugin: alpha
        codex:
          source:
            source: local
            path: ./plugins/alpha/chatgpt
`,
    });

    await expect(renderBuildGraph(graph)).rejects.toThrow(
      "ChatGPT marketplace entry alpha requires a materialized local plugin package"
    );
  });

  test("rejects configured local sources that redirect the materialized package", async () => {
    const graph = await fixtureGraph({
      ".skillset/plugins/alpha/skillset.yaml": "skillset:\n  name: alpha",
      "skillset.yaml": `
skillset:
  name: local-source
claude: false
codex: true
cursor: false
marketplaces:
  curated:
    targets: [codex]
    plugins:
      - plugin: alpha
        codex:
          source:
            source: local
            path: ./elsewhere
`,
    });

    await expect(renderBuildGraph(graph)).rejects.toThrow(
      "ChatGPT marketplace entry alpha local source must reference the materialized package ./plugins/alpha/chatgpt"
    );
  });

  test("rejects missing and non-materialized local listing assets", async () => {
    const missing = await fixtureGraph({
      ".skillset/plugins/alpha/skillset.yaml": "skillset:\n  name: alpha",
      "skillset.yaml": `
skillset:
  name: local-assets
claude: false
codex: true
cursor: false
marketplaces:
  curated:
    targets: [codex]
    plugins:
      - plugin: alpha
        codex:
          interface:
            logo: ./assets/missing.svg
`,
    });
    await expect(renderBuildGraph(missing)).rejects.toThrow(
      "ChatGPT marketplace entry alpha interface.logo references a missing package asset ./assets/missing.svg"
    );

    const notMaterialized = await fixtureGraph({
      ".skillset/plugins/alpha/logo.svg": "logo",
      ".skillset/plugins/alpha/skillset.yaml": "skillset:\n  name: alpha",
      "skillset.yaml": `
skillset:
  name: local-assets
claude: false
codex: true
cursor: false
marketplaces:
  curated:
    targets: [codex]
    plugins:
      - plugin: alpha
        codex:
          interface:
            logo: ./logo.svg
`,
    });
    await expect(renderBuildGraph(notMaterialized)).rejects.toThrow(
      "ChatGPT marketplace entry alpha interface.logo is not materialized in the local package"
    );
  });

  test("rejects a local listing asset symlink that escapes the materialized package", async () => {
    const graph = await fixtureGraph({
      ".skillset/plugins/alpha/assets/.keep": "keep",
      ".skillset/plugins/alpha/skillset.yaml": "skillset:\n  name: alpha",
      "skillset.yaml": `
skillset:
  name: local-assets
claude: false
codex: true
cursor: false
marketplaces:
  curated:
    targets: [codex]
    plugins:
      - plugin: alpha
        codex:
          interface:
            logo: ./assets/logo.svg
`,
    });
    const outside = await mkdtemp(
      join(tmpdir(), "skillset-marketplace-asset-")
    );
    await Bun.write(join(outside, "logo.svg"), "outside");
    const [plugin] = graph.plugins;
    if (plugin === undefined) throw new Error("missing fixture plugin alpha");
    await symlink(
      join(outside, "logo.svg"),
      join(plugin.path, "assets/logo.svg")
    );

    await expect(renderBuildGraph(graph)).rejects.toThrow(
      "ChatGPT marketplace entry alpha interface.logo resolves outside the local plugin package"
    );
  });

  test("rejects a local listing asset path that traverses outside the package", async () => {
    const loaded = await fixtureGraph({
      ".skillset/plugins/alpha/skillset.yaml": "skillset:\n  name: alpha",
      "skillset.yaml": `
skillset:
  name: local-assets
claude: false
codex: true
cursor: false
`,
    });
    const graph = withMarketplaces(loaded, {
      curated: {
        plugins: [
          marketplaceEntry({
            codex: { interface: { logo: "./../outside.svg" } },
            id: "alpha",
            plugin: "alpha",
          }),
        ],
        targets: ["codex"],
      },
    });

    await expect(renderBuildGraph(graph)).rejects.toThrow(
      "ChatGPT marketplace entry alpha interface.logo resolves outside the local plugin package"
    );
  });

  test("rejects ambiguous configured Codex catalogs deterministically", async () => {
    const loaded = await fixtureGraph({
      ".skillset/plugins/alpha/skillset.yaml": "skillset:\n  name: alpha",
      "skillset.yaml": `
skillset:
  name: ambiguous
claude: false
codex: true
cursor: false
`,
    });
    const catalog: MarketplaceCatalogConfig = {
      plugins: [marketplaceEntry({ id: "alpha", plugin: "alpha" })],
      targets: ["codex"],
    };
    const graph = withMarketplaces(loaded, { one: catalog, two: catalog });

    await expect(renderBuildGraph(graph)).rejects.toThrow(
      "ChatGPT marketplace output requires exactly one catalog targeting codex; found one, two"
    );
  });

  test("rejects source credentials without echoing them", async () => {
    const loaded = await fixtureGraph({
      ".skillset/plugins/local/skillset.yaml": "skillset:\n  name: local",
      "skillset.yaml": `
skillset:
  name: credential-test
claude: false
codex: true
cursor: false
`,
    });
    const graph = withMarketplaces(loaded, {
      curated: {
        plugins: [
          marketplaceEntry({
            id: "remote",
            plugin: "remote",
            codex: {
              source: {
                source: "url",
                url: "https://person:do-not-print@example.com/plugin.git",
              },
            },
          }),
        ],
        targets: ["codex"],
      },
    });

    const error = await renderBuildGraph(graph).catch(
      (reason: unknown) => reason
    );
    expect(String(error)).toContain(
      "source credentials are unsupported; configure Git or npm credentials out of band"
    );
    expect(String(error)).not.toContain("do-not-print");
  });
});

function marketplaceEntry(
  value: Record<string, unknown>
): MarketplacePluginEntryConfig {
  return value as unknown as MarketplacePluginEntryConfig;
}

function withMarketplaces(
  graph: BuildGraph,
  marketplaces: Readonly<Record<string, MarketplaceCatalogConfig>>
): BuildGraph {
  return { ...graph, root: { ...graph.root, marketplaces } };
}

function json(
  files: readonly RenderedFile[],
  path: string
): Record<string, unknown> {
  const file = files.find((candidate) => candidate.path === path);
  if (file === undefined) throw new Error(`missing rendered file ${path}`);
  return JSON.parse(decoder.decode(file.content)) as Record<string, unknown>;
}

async function fixtureGraph(
  files: Record<string, string>
): Promise<BuildGraph> {
  const root = await mkdtemp(join(tmpdir(), "skillset-openai-marketplace-"));
  for (const [path, content] of Object.entries(
    normalizeSkillsetFixtureFiles(files)
  )) {
    await Bun.write(join(root, path), `${content.trim()}\n`);
  }
  return loadBuildGraph(root);
}
