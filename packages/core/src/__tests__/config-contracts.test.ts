import { describe, expect, it } from "bun:test";

import {
  DISTRIBUTION_RUNTIME_TARGETS,
  NON_DISTRIBUTABLE_RUNTIME_IDS,
  readCompileConfig,
  readDraftSelectors,
  readInternalMarker,
  readMarketplaceCatalogConfig,
  readWorkspacePluginsConfig,
  validateConfigDocument,
  validateRootSourceManifestDocument,
  validateWorkspaceConfigDocument,
} from "../config";
import { SKILLSET_RUNTIME_IDS } from "../feature-registry";
import type { JsonRecord } from "../types";

describe("distribution runtime contract", () => {
  it("SET-346 partitions every registered runtime into one target or the named exclusion set", () => {
    const mappedRuntimeIds = Object.values(DISTRIBUTION_RUNTIME_TARGETS).flat();
    const registeredRuntimeIds = new Set<string>(SKILLSET_RUNTIME_IDS);

    for (const runtime of SKILLSET_RUNTIME_IDS) {
      const mappingCount = mappedRuntimeIds.filter((candidate) => candidate === runtime).length;
      const partitionCount = mappingCount + Number(NON_DISTRIBUTABLE_RUNTIME_IDS.has(runtime));

      expect(partitionCount).toBe(1);
    }
    expect(mappedRuntimeIds.filter((runtime) => !registeredRuntimeIds.has(runtime))).toEqual([]);
    expect(
      [...NON_DISTRIBUTABLE_RUNTIME_IDS].filter((runtime) => !registeredRuntimeIds.has(runtime))
    ).toEqual([]);
  });
});

describe("schema-owned config document contexts", () => {
  it("parses root plugin behavior without changing defaults", () => {
    expect(readCompileConfig({}, "skillset.yaml").instructionFrontPage).toBe(
      "claude-dir"
    );
    expect(readCompileConfig({}, "skillset.yaml").sessionStartHook).toBe(
      "auto"
    );
    expect(
      readCompileConfig(
        { compile: { instruction_front_page: "repo-root" } },
        "skillset.yaml"
      ).instructionFrontPage
    ).toBe("repo-root");
    for (const sessionStartHook of ["auto", "on", "off"] as const) {
      expect(
        readCompileConfig(
          { compile: { session_start_hook: sessionStartHook } },
          "skillset.yaml"
        ).sessionStartHook
      ).toBe(sessionStartHook);
    }
    expect(() =>
      readCompileConfig(
        { compile: { session_start_hook: "sometimes" } },
        "skillset.yaml"
      )
    ).toThrow(
      "expected skillset.yaml.compile.session_start_hook to be auto, on, or off"
    );
    expect(readInternalMarker({}, "skillset.yaml")).toBe(true);
    expect(
      readInternalMarker({ internal_marker: false }, "skillset.yaml")
    ).toBe(false);
    expect(readDraftSelectors({ drafts: [] }, "skillset.yaml")).toEqual([]);

    expect(readWorkspacePluginsConfig({}, "skillset.yaml")).toEqual({
      internalUse: { drafts: {}, plugins: false, skills: {} },
      output: {
        path: "plugins/[name]",
        targets: { claude: {}, codex: {}, cursor: {} },
      },
    });
    expect(
      readWorkspacePluginsConfig(
        {
          plugins: {
            internal_use: {
              plugins: ["demo", "!excluded"],
              skills: { demo: ["review", "!proofread"] },
            },
            output: {
              path: "dist/[name]",
              codex: { combine: true, name: "bundle" },
            },
          },
        },
        "skillset.yaml"
      )
    ).toEqual({
      internalUse: {
        drafts: {},
        plugins: ["demo", "!excluded"],
        skills: { demo: ["review", "!proofread"] },
      },
      output: {
        path: "dist/[name]",
        targets: {
          claude: {},
          codex: { combine: true, name: "bundle" },
          cursor: {},
        },
      },
    });

    for (const draftPolicy of ["only", "override"] as const) {
      expect(
        readWorkspacePluginsConfig(
          { plugins: { internal_use: { drafts: { demo: draftPolicy } } } },
          "skillset.yaml"
        ).internalUse.drafts
      ).toEqual({ demo: draftPolicy });
    }
    for (const field of ["plugins", "skills"] as const) {
      expect(() =>
        readWorkspacePluginsConfig(
          {
            plugins: {
              internal_use: field === "plugins"
                ? { plugins: "only" }
                : { skills: { demo: "override" } },
            },
          },
          "skillset.yaml"
        )
      ).toThrow("expected");
    }
  });

  it("rejects removed skill-root overrides without closing provider target blocks", () => {
    for (const target of ["claude", "codex", "cursor"] as const) {
      expect(() =>
        validateConfigDocument(
          { [target]: { providerNative: { retained: true }, skills: { path: `generated/${target}/skills` } } },
          "skillset.yaml",
          { allowCompile: true }
        )
      ).toThrow(`${target}.skills.path`);
      expect(() =>
        validateConfigDocument(
          { skillset: { outputs: { skills: { [target]: `generated/${target}/skills` } } } },
          "skillset.yaml",
          { allowCompile: true }
        )
      ).toThrow(`skillset.outputs.skills.${target}`);
    }

    expect(() =>
      validateConfigDocument(
        {
          codex: {
            providerNative: { retained: true },
            skills: { enabled: true, include: ["review"] },
          },
        },
        "skillset.yaml",
        { allowCompile: true }
      )
    ).not.toThrow();
  });

  it("rejects bundle paths before parser trimming can change their meaning", () => {
    for (const path of [" ../outside", " /absolute", " C:/absolute", ".. ", "plugin/.. "]) {
      expect(() => validateConfigDocument(
        { claude: { bundle: { path } } },
        ".skillset/plugins/demo/skillset.yaml",
        { allowHooks: true }
      )).toThrow("claude.bundle.path must be a workspace-relative directory path");
    }
  });

  it("keeps Core validation aligned with each schema-owned document vocabulary", () => {
    expect(() => validateConfigDocument({
      compile: { targets: ["cursor"] },
      skillset: { name: "root" },
      supports: ["bun >=1.0.0"],
    }, "skillset.yaml", { allowCompile: true })).not.toThrow();
    expect(() => validateConfigDocument({ compile: {} }, "unscoped skillset.yaml")).toThrow(
      "unsupported top-level key compile"
    );

    expect(() => validateWorkspaceConfigDocument({ skillset: { name: "wrong-context" } }, ".skillset/config.yaml")).toThrow(
      "unsupported workspace config key skillset"
    );

    expect(() => validateRootSourceManifestDocument({
      skillset: { name: "root" },
      supports: ["bun >=1.0.0"],
    }, ".skillset/skillset.yaml")).not.toThrow();
    expect(() => validateRootSourceManifestDocument({ compile: {} }, ".skillset/skillset.yaml")).toThrow(
      "unsupported root source manifest key compile"
    );

    const plugin: JsonRecord = {
      bin: true,
      hooks: { Stop: ["shell-policy"] },
      mcp: true,
      skillset: { name: "demo" },
    };
    expect(() => validateConfigDocument(plugin, ".skillset/plugins/demo/skillset.yaml", { allowHooks: true })).not.toThrow();
    expect(() => validateConfigDocument({ compile: {} }, ".skillset/plugins/demo/skillset.yaml", { allowHooks: true })).toThrow(
      "unsupported top-level key compile"
    );
  });
});

describe("Codex marketplace config", () => {
  it("preserves configured catalog and plugin order with typed native metadata", () => {
    const catalogs = readMarketplaceCatalogConfig(
      {
        marketplaces: {
          zeta: {
            plugins: [{ plugin: "zeta" }],
            targets: ["claude"],
          },
          alpha: {
            plugins: [
              {
                codex: {
                  displayName: "Legacy Alpha",
                  policy: { products: [] },
                  source: {
                    ref: "main",
                    sha: "a".repeat(40),
                    source: "git-subdir",
                    path: "./plugins/alpha",
                    url: "github:acme/plugins",
                  },
                },
                plugin: "alpha",
              },
              { plugin: "beta" },
            ],
            targets: ["codex"],
          },
        },
      },
      "skillset.yaml"
    );

    expect(Object.keys(catalogs)).toEqual(["zeta", "alpha"]);
    expect(catalogs.alpha?.plugins.map((entry) => entry.id)).toEqual([
      "alpha",
      "beta",
    ]);
    expect(catalogs.alpha?.plugins[0]?.codex).toMatchObject({
      interface: { displayName: "Legacy Alpha" },
      policy: { products: [] },
      source: {
        path: "./plugins/alpha",
        ref: "main",
        sha: "a".repeat(40),
        source: "git-subdir",
      },
    });
  });

  it("normalizes native source and product aliases without narrowing Git forms", () => {
    const catalogs = readMarketplaceCatalogConfig(
      {
        marketplaces: {
          native: {
            plugins: [
              {
                codex: {
                  policy: { products: ["ATLAS", "CHATGPT", "CODEX"] },
                  source: "./plugins/local",
                },
                plugin: "local",
              },
              {
                codex: {
                  source: {
                    path: "./plugins/nested",
                    source: "url",
                    url: "file:///tmp/plugins.git",
                  },
                },
                plugin: "file-git",
              },
              {
                codex: {
                  source: {
                    source: "url",
                    url: "/tmp/plugins.git",
                  },
                },
                plugin: "absolute-git",
              },
            ],
            targets: ["codex"],
          },
        },
      },
      "skillset.yaml"
    );

    expect(catalogs.native?.plugins[0]?.codex).toMatchObject({
      policy: { products: ["atlas", "chatgpt", "codex"] },
      source: { path: "./plugins/local", source: "local" },
    });
    expect(catalogs.native?.plugins[1]?.codex?.source).toEqual({
      path: "./plugins/nested",
      source: "url",
      url: "file:///tmp/plugins.git",
    });
    expect(catalogs.native?.plugins[2]?.codex?.source).toEqual({
      source: "url",
      url: "/tmp/plugins.git",
    });
  });

  it("matches schema fidelity for normalized products, git subdirs, and Unicode prompts", () => {
    const workspace = (codex: JsonRecord): JsonRecord => ({
      marketplaces: {
        native: {
          plugins: [{ codex, plugin: "demo" }],
          targets: ["codex"],
        },
      },
    });

    expect(() =>
      readMarketplaceCatalogConfig(
        workspace({ policy: { products: ["chatgpt", "CHATGPT"] } }),
        "skillset.yaml"
      )
    ).toThrow("products entries to be unique");
    expect(() =>
      readMarketplaceCatalogConfig(
        workspace({
          source: {
            source: "git-subdir",
            url: "https://git.example/acme/plugins.git",
          },
        }),
        "skillset.yaml"
      )
    ).toThrow("source.path to be a non-empty string");

    const prompt = "😀".repeat(128);
    const catalogs = readMarketplaceCatalogConfig(
      workspace({ interface: { defaultPrompt: [prompt] } }),
      "skillset.yaml"
    );
    expect(catalogs.native?.plugins[0]?.codex?.interface?.defaultPrompt).toEqual([
      prompt,
    ]);
    expect(() =>
      readMarketplaceCatalogConfig(
        workspace({ interface: { defaultPrompt: ["😀".repeat(129)] } }),
        "skillset.yaml"
      )
    ).toThrow("at most three 128-character prompts");
  });

  it("rejects duplicate effective ids and non-registry npm selectors", () => {
    expect(() =>
      readMarketplaceCatalogConfig(
        {
          marketplaces: {
            disjoint: {
              plugins: [
                { plugin: "shared", targets: ["claude"] },
                { id: "shared", plugin: "other", targets: ["codex"] },
              ],
            },
          },
        },
        "skillset.yaml"
      )
    ).not.toThrow();

    expect(() =>
      readMarketplaceCatalogConfig(
        {
          marketplaces: {
            duplicate: {
              plugins: [
                { plugin: "shared" },
                { id: "shared", plugin: "other" },
              ],
            },
          },
        },
        "skillset.yaml"
      )
    ).toThrow("unique effective ids per target; duplicate shared");

    expect(() =>
      readMarketplaceCatalogConfig(
        {
          marketplaces: {
            overlapping: {
              plugins: [
                { plugin: "shared", targets: ["claude", "codex"] },
                { id: "shared", plugin: "other", targets: ["codex"] },
              ],
            },
          },
        },
        "skillset.yaml"
      )
    ).toThrow("unique effective ids per target; duplicate shared");

    expect(() =>
      readMarketplaceCatalogConfig(
        {
          marketplaces: {
            unsafe: {
              plugins: [
                {
                  codex: {
                    source: {
                      package: "@acme/plugin",
                      source: "npm",
                      version: "file:../payload",
                    },
                  },
                  plugin: "unsafe",
                },
              ],
            },
          },
        },
        "skillset.yaml"
      )
    ).toThrow("npm registry version, tag, or range");
  });

  it("rejects multiple Codex catalogs and redacts credential-bearing URLs", () => {
    expect(() =>
      readMarketplaceCatalogConfig(
        {
          marketplaces: {
            first: { plugins: [{ plugin: "first" }], targets: ["codex"] },
            second: { plugins: [{ plugin: "second" }], targets: ["codex"] },
          },
        },
        "skillset.yaml"
      )
    ).toThrow("Codex supports exactly one marketplace catalog");

    let message = "";
    try {
      readMarketplaceCatalogConfig(
        {
          marketplaces: {
            first: {
              plugins: [
                {
                  codex: {
                    source: {
                      source: "url",
                      url: "https://user:SENTINEL@git.example/acme/plugin.git",
                    },
                  },
                  plugin: "first",
                },
              ],
              targets: ["codex"],
            },
          },
        },
        "skillset.yaml"
      );
    } catch (error) {
      message = String(error);
    }
    expect(message).toContain("credential-free remote Git URL");
    expect(message).not.toContain("SENTINEL");
  });
});
