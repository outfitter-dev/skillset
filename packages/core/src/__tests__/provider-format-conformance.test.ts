import { describe, expect, it } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { normalizeSkillsetFixtureFiles } from "../../../../scripts/test-helpers/skillset-config";
import {
  buildSkillsetResult,
  checkProviderFormatConformance,
  formatProviderFormatConformanceReport,
  providerFormatConformanceFiles,
} from "@skillset/core";

const PROVIDER_FORMAT_FIXTURE: Record<string, string> = {
  "skillset.yaml": `
skillset:
  name: provider-format-root
  author:
    name: Root Team
    email: root@example.com
    url: https://example.com/root
claude: true
codex: true
cursor: true
compile:
  unsupportedDestination: warn
`,
  ".skillset/skills/repo-skill/SKILL.md": `
---
name: repo-skill
description: Repo skill.
---

Use the repo skill.
`,
  ".skillset/rules/root.md": `
---
description: Root instructions.
---

Keep generated output deterministic.
`,
  ".skillset/agents/reviewer.md": `
---
name: reviewer
description: Reviews code.
skills:
  - repo-skill
---

Review diffs carefully.
`,
  ".skillset/plugins/alpha/skillset.yaml": `
skillset:
  name: alpha
  description: Alpha plugin.
  author:
    name: Alpha Team
    email: alpha@example.com
  homepage: https://example.com/alpha
  repository: https://github.com/example/alpha
  license: MIT
  keywords: [alpha, tools]
mcp: true
`,
  ".skillset/plugins/alpha/.mcp.json": `
{
  "mcpServers": {
    "alpha": { "command": "node" }
  }
}
`,
  ".skillset/plugins/alpha/hooks/hooks.json": `
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "*",
        "hooks": [
          { "type": "command", "command": "node hooks/pre-tool-use.js" }
        ]
      }
    ]
  }
}
`,
  ".skillset/plugins/alpha/rules/plugin.md": `
---
description: Plugin instructions.
---

Keep plugin output deterministic.
`,
  ".skillset/plugins/alpha/skills/plugin-skill/SKILL.md": `
---
name: plugin-skill
description: Plugin skill.
---

Use the plugin skill.
`,
};

describe("provider format conformance", () => {
  it("validates generated provider outputs against adopted snapshots", async () => {
    const root = await fixture(PROVIDER_FORMAT_FIXTURE);
    const build = await buildSkillsetResult(root, { isolated: true });

    const files = providerFormatConformanceFiles(build.data, build.renderResults);
    const report = checkProviderFormatConformance(files);

    expect(files.map((file) => file.path).sort()).toEqual(expect.arrayContaining([
      ".skillset/cache/latest/AGENTS.md",
      ".skillset/cache/latest/.claude/agents/reviewer.md",
      ".skillset/cache/latest/.claude-plugin/marketplace.json",
      ".skillset/cache/latest/.cursor-plugin/marketplace.json",
      ".skillset/cache/latest/plugins/alpha/claude/.claude-plugin/plugin.json",
      ".skillset/cache/latest/plugins/alpha/claude/hooks/hooks.json",
      ".skillset/cache/latest/plugins/alpha/codex/.codex-plugin/plugin.json",
      ".skillset/cache/latest/plugins/alpha/codex/hooks/hooks.json",
      ".skillset/cache/latest/plugins/alpha/codex/skills/plugin-skill/SKILL.md",
      ".skillset/cache/latest/plugins/alpha/cursor/.cursor-plugin/plugin.json",
      ".skillset/cache/latest/plugins/alpha/cursor/hooks/hooks.json",
      ".skillset/cache/latest/plugins/alpha/cursor/skills/plugin-skill/SKILL.md",
      ".skillset/cache/latest/.cursor/agents/reviewer.md",
      ".skillset/cache/latest/.cursor/rules/root.mdc",
    ]));
    expect(report).toEqual({ checkedFiles: files.length, issues: [], ok: true });

    const codexManifest = files.find((file) =>
      file.path.endsWith("/codex/.codex-plugin/plugin.json")
    );
    const cursorManifest = files.find((file) =>
      file.path.endsWith("/cursor/.cursor-plugin/plugin.json")
    );
    expect(JSON.parse(new TextDecoder().decode(codexManifest?.content))).toMatchObject({
      author: {
        email: "alpha@example.com",
        name: "Alpha Team",
      },
    });
    expect(JSON.parse(new TextDecoder().decode(cursorManifest?.content))).toMatchObject({
      author: { email: "alpha@example.com", name: "Alpha Team" },
      homepage: "https://example.com/alpha",
      keywords: ["alpha", "tools"],
      license: "MIT",
      repository: "https://github.com/example/alpha",
    });
  });

  it("reports schema-backed missing and unknown fields with provider refs", () => {
    const report = checkProviderFormatConformance([
      rendered("plugins/alpha/claude/.claude-plugin/plugin.json", {
        description: 123,
        keywords: "not-an-array",
        unexpected: true,
      }),
      rendered("plugins/alpha/codex/hooks/hooks.json", {
        hooks: {},
        stale: true,
      }),
      rendered("plugins/alpha/claude/hooks/hooks.json", {
        hooks: {},
        stale: true,
      }),
      rendered("plugins/alpha/cursor/.cursor-plugin/plugin.json", {
        description: "Cursor plugin.",
        mystery: true,
        name: "alpha",
        tags: "not-an-array",
      }),
      rendered("plugins/alpha/cursor/hooks/hooks.json", {
        hooks: {},
        stale: true,
      }),
    ]);

    expect(report.ok).toBe(false);
    expect(report.issues.map((issue) => [issue.providerRef, issue.code, issue.outputPath])).toEqual([
      ["claude-plugin", "missing-required-field", "plugins/alpha/claude/.claude-plugin/plugin.json"],
      ["claude-plugin-manifest-schema", "invalid-field-type", "plugins/alpha/claude/.claude-plugin/plugin.json"],
      ["claude-plugin-manifest-schema", "invalid-field-type", "plugins/alpha/claude/.claude-plugin/plugin.json"],
      ["claude-plugin-manifest-schema", "unknown-destination-field", "plugins/alpha/claude/.claude-plugin/plugin.json"],
      ["claude-hooks", "unknown-destination-field", "plugins/alpha/claude/hooks/hooks.json"],
      ["codex-hooks-schema", "unknown-destination-field", "plugins/alpha/codex/hooks/hooks.json"],
      ["cursor-plugin", "invalid-field-type", "plugins/alpha/cursor/.cursor-plugin/plugin.json"],
      ["cursor-plugin", "unknown-destination-field", "plugins/alpha/cursor/.cursor-plugin/plugin.json"],
      ["cursor-hooks", "unknown-destination-field", "plugins/alpha/cursor/hooks/hooks.json"],
    ]);
    expect(formatProviderFormatConformanceReport(report)).toContain("claude-plugin-manifest-schema");
  });

  it("reports manual-overlay unknown destination fields", () => {
    const report = checkProviderFormatConformance([
      rendered("plugins/alpha/codex/.codex-plugin/plugin.json", {
        interface: {
          displayName: "Alpha",
          mysteryPanel: true,
        },
        name: "alpha",
        strange: true,
      }),
      textFile(".codex/agents/reviewer.toml", [
        'name = "reviewer"',
        'description = "Reviews code."',
        'developer_instructions = "Review diffs carefully."',
        'surprise = true',
        "",
      ].join("\n")),
      textFile(".claude/agents/reviewer.md", [
        "---",
        "name: reviewer",
        "description: Reviews code.",
        "surprise: true",
        "---",
        "",
        "Review diffs carefully.",
        "",
      ].join("\n")),
      textFile(".cursor/agents/reviewer.md", [
        "---",
        "name: reviewer",
        "description: Reviews code.",
        "surprise: true",
        "---",
        "",
        "Review diffs carefully.",
        "",
      ].join("\n")),
      textFile(".cursor/rules/repo.mdc", [
        "---",
        "description: Repo rule.",
        "surprise: true",
        "---",
        "",
        "Follow repo rules.",
        "",
      ].join("\n")),
    ]);

    expect(report.ok).toBe(false);
    expect(report.issues.map((issue) => [issue.providerRef, issue.code])).toEqual([
      ["claude-subagent-frontmatter-overlay", "unknown-destination-field"],
      ["codex-subagent-toml-overlay", "unknown-destination-field"],
      ["cursor-agent", "unknown-destination-field"],
      ["cursor-rules", "unknown-destination-field"],
      ["codex-plugin-manifest-overlay", "unknown-destination-field"],
      ["codex-plugin-manifest-overlay", "unknown-destination-field"],
    ]);
    expect(report.issues.map((issue) => issue.message).join("\n")).toContain("Codex 0.147.0 publishes a plugin authoring validator");
  });

  it("validates Claude's native author object fields", () => {
    const valid = checkProviderFormatConformance([
      rendered("plugins/alpha/claude/.claude-plugin/plugin.json", {
        author: {
          email: "team@example.com",
          name: "Example Team",
          url: "https://example.com/team",
        },
        description: "Alpha plugin.",
        name: "alpha",
      }),
    ]);
    expect(valid).toEqual({ checkedFiles: 1, issues: [], ok: true });

    const invalid = checkProviderFormatConformance([
      rendered("plugins/alpha/claude/.claude-plugin/plugin.json", {
        author: { contributor: "Example Contributor", email: 1 },
        description: "Alpha plugin.",
        name: "alpha",
      }),
    ]);
    expect(invalid.issues.map(({ code, message }) => ({ code, message }))).toEqual([
      {
        code: "invalid-field-type",
        message: "destination field author.email must be a string",
      },
      {
        code: "missing-required-field",
        message: "missing required destination field author.name",
      },
      {
        code: "unknown-destination-field",
        message:
          "unknown destination field author.contributor; allowed fields are email, name, url",
      },
    ]);
  });

  it("validates Codex and Cursor provider-native author objects", () => {
    const valid = checkProviderFormatConformance([
      rendered("plugins/alpha/codex/.codex-plugin/plugin.json", {
        author: { email: "team@example.com", name: "Team", url: "https://example.com" },
        name: "alpha",
      }),
      rendered("plugins/alpha/cursor/.cursor-plugin/plugin.json", {
        author: { email: "team@example.com", name: "Team" },
        description: "Alpha.",
        name: "alpha",
      }),
    ]);
    expect(valid).toEqual({ checkedFiles: 2, issues: [], ok: true });

    const invalid = checkProviderFormatConformance([
      rendered("plugins/alpha/codex/.codex-plugin/plugin.json", {
        author: "Legacy Author",
        name: "alpha",
      }),
      rendered("plugins/alpha/cursor/.cursor-plugin/plugin.json", {
        author: { name: "Team", url: "https://example.com" },
        description: "Alpha.",
        name: "alpha",
      }),
    ]);
    expect(invalid.issues.map(({ code, message }) => ({ code, message }))).toEqual([
      {
        code: "invalid-field-type",
        message: "destination field author must be an object (Codex 0.147.0 publishes a plugin authoring validator and prose manifest specification but no adopted JSON Schema source.)",
      },
      {
        code: "unknown-destination-field",
        message: "unknown destination field author.url; allowed fields are email, name",
      },
    ]);
  });

  it("validates the pinned Cursor marketplace root and entry shapes", () => {
    const valid = checkProviderFormatConformance([
      rendered(".cursor-plugin/marketplace.json", {
        name: "example",
        owner: { email: "team@example.com", name: "Example Team" },
        plugins: [{ description: "Alpha.", name: "alpha", source: "plugins/alpha" }],
      }),
    ]);
    expect(valid).toEqual({ checkedFiles: 1, issues: [], ok: true });

    const invalid = checkProviderFormatConformance([
      rendered(".cursor-plugin/marketplace.json", {
        name: "example",
        owner: { name: "Example Team", url: "https://example.com" },
        plugins: [{ name: "alpha", source: "plugins/alpha", tags: ["alpha"] }],
      }),
    ]);
    expect(invalid.issues.map(({ code, message }) => ({ code, message }))).toEqual([
      {
        code: "unknown-destination-field",
        message: "unknown destination field owner.url; allowed fields are email, name",
      },
      {
        code: "unknown-destination-field",
        message: "unknown destination field plugins[0].tags; allowed fields are description, minClientVersions, name, source",
      },
    ]);
  });

  it("validates Claude marketplace owner and plugin author objects", () => {
    const valid = checkProviderFormatConformance([
      rendered(".claude-plugin/marketplace.json", {
        metadata: { description: "Example marketplace", pluginRoot: "./plugins" },
        name: "example",
        owner: { email: "team@example.com", name: "Example Team" },
        plugins: [
          {
            author: {
              name: "Plugin Team",
              url: "https://example.com/plugin",
            },
            name: "alpha",
            source: "./plugins/alpha",
          },
        ],
      }),
    ]);
    expect(valid).toEqual({ checkedFiles: 1, issues: [], ok: true });

    const invalid = checkProviderFormatConformance([
      rendered(".claude-plugin/marketplace.json", {
        metadata: { generatedBy: "skillset@0.1.0" },
        name: "example",
        owner: { contributor: "Publisher", email: 1 },
        plugins: [
          {
            author: { contributor: "Contributor", name: "Plugin Team" },
            name: "alpha",
            source: "./plugins/alpha",
          },
          { author: "Legacy Author", name: "beta", source: "./plugins/beta" },
        ],
      }),
    ]);
    expect(invalid.issues.map(({ code, message }) => ({ code, message }))).toEqual([
      {
        code: "invalid-field-type",
        message: "destination field owner.email must be a string",
      },
      {
        code: "invalid-field-type",
        message: "destination field plugins[1].author must be an object",
      },
      {
        code: "missing-required-field",
        message: "missing required destination field owner.name",
      },
      {
        code: "unknown-destination-field",
        message:
          "unknown destination field metadata.generatedBy; allowed fields are description, pluginRoot, version",
      },
      {
        code: "unknown-destination-field",
        message:
          "unknown destination field owner.contributor; allowed fields are email, name, url",
      },
      {
        code: "unknown-destination-field",
        message:
          "unknown destination field plugins[0].author.contributor; allowed fields are email, name, url",
      },
    ]);
  });

  it("validates Claude marketplace root and metadata field types", () => {
    const valid = checkProviderFormatConformance([
      rendered(".claude-plugin/marketplace.json", {
        $schema: "https://json.schemastore.org/claude-code-marketplace.json",
        description: "Example marketplace.",
        forceRemoveDeletedPlugins: false,
        metadata: { description: "Example.", pluginRoot: "./plugins", version: "1.0.0" },
        name: "example",
        owner: { name: "Example Team" },
        plugins: [],
        renames: { legacy: null },
      }),
    ]);
    expect(valid).toEqual({ checkedFiles: 1, issues: [], ok: true });

    const invalid = checkProviderFormatConformance([
      rendered(".claude-plugin/marketplace.json", {
        $schema: {},
        description: 1,
        forceRemoveDeletedPlugins: "yes",
        metadata: { description: true, pluginRoot: false, version: 1 },
        name: "example",
        owner: { name: "Example Team" },
        plugins: [],
        renames: [],
      }),
    ]);
    expect(invalid.issues.map(({ message }) => message)).toEqual([
      "destination field $schema must be a string",
      "destination field description must be a string",
      "destination field forceRemoveDeletedPlugins must be a boolean",
      "destination field metadata.description must be a string",
      "destination field metadata.pluginRoot must be a string",
      "destination field metadata.version must be a string",
      "destination field renames must be an object",
    ]);
  });

  it("validates Claude marketplace plugin override fields and nested shapes", () => {
    const valid = checkProviderFormatConformance([
      rendered(".claude-plugin/marketplace.json", {
        name: "example",
        owner: { name: "Example Team" },
        plugins: [
          {
            agents: ["./agents/reviewer.md"],
            channels: [{ displayName: "Alerts", server: "alerts", userConfig: {} }],
            defaultEnabled: false,
            dependencies: ["base", { marketplace: "example", name: "shared" }],
            description: "Alpha plugin.",
            displayName: "Alpha Plugin",
            experimental: { monitors: "./monitors.json" },
            keywords: ["tools"],
            lspServers: [
              {
                ts: {
                  command: "tsserver",
                  diagnostics: false,
                  extensionToLanguage: { ".ts": "typescript" },
                },
              },
            ],
            metadata: { entitlement: "pro" },
            name: "alpha",
            relevance: { signals: { cli: ["alpha"] }, topic: "Alpha plugin" },
            source: { ref: "main", repo: "owner/repo", source: "github" },
            version: "1.0.0",
            workflows: ["./workflows/review.md"],
          },
        ],
      }),
    ]);
    expect(valid).toEqual({ checkedFiles: 1, issues: [], ok: true });

    const invalid = checkProviderFormatConformance([
      rendered(".claude-plugin/marketplace.json", {
        name: "example",
        owner: { name: "Example Team" },
        plugins: [
          {
            agents: [42],
            channels: [42],
            dependencies: [42],
            description: false,
            keywords: "tools",
            name: "alpha",
            source: { ref: 42, repo: "owner/repo", source: "github", unexpected: true },
            unknown: true,
            version: 1,
          },
        ],
      }),
    ]);
    expect(invalid.issues.map(({ code, message }) => ({ code, message }))).toEqual([
      {
        code: "invalid-field-type",
        message: "destination field plugins[0].agents must be a string or an array of strings",
      },
      {
        code: "invalid-field-type",
        message: "destination field plugins[0].channels[0] must be an object",
      },
      {
        code: "invalid-field-type",
        message: "destination field plugins[0].dependencies[0] must be a string or an object",
      },
      {
        code: "invalid-field-type",
        message: "destination field plugins[0].description must be a string",
      },
      {
        code: "invalid-field-type",
        message: "destination field plugins[0].keywords must be an array of strings",
      },
      {
        code: "invalid-field-type",
        message: "destination field plugins[0].source.ref must be a string",
      },
      {
        code: "invalid-field-type",
        message: "destination field plugins[0].version must be a string",
      },
      {
        code: "unknown-destination-field",
        message:
          "unknown destination field plugins[0].source.unexpected; allowed fields are ref, repo, sha, source",
      },
      {
        code: "unknown-destination-field",
        message:
          "unknown destination field plugins[0].unknown; allowed fields are $schema, agents, author, category, channels, commands, defaultEnabled, dependencies, description, displayName, experimental, homepage, hooks, keywords, license, lspServers, mcpServers, metadata, monitors, name, outputStyles, relevance, repository, settings, skills, source, strict, tags, themes, userConfig, version, workflows",
      },
    ]);
  });

  it("rejects empty Claude marketplace identity fields", () => {
    const result = checkProviderFormatConformance([
      rendered(".claude-plugin/marketplace.json", {
        name: "",
        owner: { name: "" },
        plugins: [
          { author: { name: "" }, name: "alpha", source: "./plugins/alpha" },
        ],
      }),
    ]);
    expect(result.issues.map(({ message }) => message)).toEqual([
      "destination field name must not be empty",
      "destination field owner.name must not be empty",
      "destination field plugins[0].author.name must not be empty",
    ]);
  });

  it("validates every array-bearing Claude marketplace plugin override", () => {
    const result = checkProviderFormatConformance([
      rendered(".claude-plugin/marketplace.json", {
        name: "example",
        owner: { name: "Example Team" },
        plugins: [
          {
            commands: [42],
            experimental: { monitors: [42], themes: [42], unknown: true },
            hooks: [42],
            lspServers: [42],
            mcpServers: [42],
            monitors: [42],
            name: "alpha",
            outputStyles: [42],
            skills: [42],
            source: "./plugins/alpha",
            themes: [42],
            workflows: [42],
          },
        ],
      }),
    ]);
    expect(result.issues.map(({ message }) => message)).toEqual([
      "destination field plugins[0].commands[0] must be a string",
      "destination field plugins[0].experimental.monitors[0] must be an object",
      "destination field plugins[0].experimental.themes must be a string or an array of strings",
      "destination field plugins[0].hooks[0] must be a string or an object",
      "destination field plugins[0].lspServers[0] must be a string or an object",
      "destination field plugins[0].mcpServers[0] must be a string or an object",
      "destination field plugins[0].monitors[0] must be an object",
      "destination field plugins[0].outputStyles must be a string or an array of strings",
      "destination field plugins[0].skills must be a string or an array of strings",
      "destination field plugins[0].themes must be a string or an array of strings",
      "destination field plugins[0].workflows must be a string or an array of strings",
      "unknown destination field plugins[0].experimental.unknown; allowed fields are monitors, themes",
    ]);
  });

  it("validates Claude marketplace rename targets", () => {
    const result = checkProviderFormatConformance([
      rendered(".claude-plugin/marketplace.json", {
        name: "example",
        owner: { name: "Example Team" },
        plugins: [],
        renames: { legacy: 42, removed: null, renamed: "current" },
      }),
    ]);
    expect(result.issues.map(({ code, message }) => ({ code, message }))).toEqual([
      {
        code: "invalid-field-type",
        message: "destination field renames.legacy must be a string or null",
      },
    ]);
  });

  it("reports mixed Claude config array entries under their original index", () => {
    const result = checkProviderFormatConformance([
      rendered(".claude-plugin/marketplace.json", {
        name: "example",
        owner: { name: "Example Team" },
        plugins: [
          {
            lspServers: ["./lsp.json", { ts: { command: 1, extensionToLanguage: { ts: "ts" } } }],
            mcpServers: ["./mcp.json", { x: { command: 1 } }],
            name: "mixed",
            source: "./plugins/mixed",
          },
        ],
      }),
    ]);
    expect(result.issues.map(({ message }) => message)).toEqual([
      "destination field plugins[0].lspServers[1].ts.command must be a string",
      "destination field plugins[0].mcpServers[1].x.command must be a string",
    ]);
  });

  it("reports mixed Claude component path entries under their original index", () => {
    const result = checkProviderFormatConformance([
      rendered(".claude-plugin/marketplace.json", {
        name: "example",
        owner: { name: "Example Team" },
        plugins: [
          {
            hooks: [
              { PreToolUse: [{ hooks: [{ command: "./guard.sh", type: "command" }] }] },
              "hooks/config.json",
            ],
            lspServers: [
              { ts: { command: "lsp", extensionToLanguage: { ts: "typescript" } } },
              "lsp/config.json",
            ],
            name: "mixed-paths",
            source: "./plugins/mixed-paths",
          },
        ],
      }),
    ]);
    expect(result.issues.map(({ message }) => message)).toEqual([
      "destination field plugins[0].hooks[1] must start with ./",
      "destination field plugins[0].lspServers[1] must start with ./",
    ]);
  });

  it("rejects Claude MCP OAuth metadata URLs that cannot be parsed", () => {
    const oauthMarketplace = (
      authServerMetadataUrl: string
    ): Record<string, unknown> => ({
      name: "example",
      owner: { name: "Example Team" },
      plugins: [
        {
          mcpServers: {
            remote: {
              oauth: { authServerMetadataUrl },
              type: "http",
              url: "https://example.com",
            },
          },
          name: "oauth",
          source: "./plugins/oauth",
        },
      ],
    });
    const malformed = checkProviderFormatConformance([
      rendered(".claude-plugin/marketplace.json", oauthMarketplace("https://[bad")),
    ]);
    expect(malformed.issues.map(({ message }) => message)).toEqual([
      "destination field plugins[0].mcpServers.remote.oauth.authServerMetadataUrl must be a parsable absolute URL",
    ]);

    const insecure = checkProviderFormatConformance([
      rendered(".claude-plugin/marketplace.json", oauthMarketplace("http://example.com")),
    ]);
    expect(insecure.issues.map(({ message }) => message)).toEqual([
      "destination field plugins[0].mcpServers.remote.oauth.authServerMetadataUrl must use HTTPS",
    ]);

    const uppercase = checkProviderFormatConformance([
      rendered(".claude-plugin/marketplace.json", oauthMarketplace("HTTPS://example.com")),
    ]);
    expect(uppercase.issues.map(({ message }) => message)).toEqual([]);
  });

  it("rejects malformed structured Claude marketplace overrides", () => {
    const result = checkProviderFormatConformance([
      rendered(".claude-plugin/marketplace.json", {
        name: "example",
        owner: { name: "Example Team" },
        plugins: [
          {
            channels: [{ server: "mcp", userConfig: { token: { type: false } } }],
            commands: {
              bar: { content: "inline", source: "not-relative" },
              foo: { source: 1, unknown: true },
            },
            dependencies: ["bad space", { marketplace: "", name: "dep", version: 1 }],
            experimental: { monitors: [{}] },
            hooks: [{ Bogus: [{}] }],
            lspServers: [{
              bad: {
                args: [""], command: "lsp", extensionToLanguage: { x: "" },
                maxRestarts: -1, shutdownTimeout: -1, startupTimeout: 0,
              },
              ts: { args: [1], command: 1, transport: "bogus", unknown: true },
            }],
            mcpServers: [{
              remote: {
                oauth: {
                  authServerMetadataUrl: "http://example.com",
                  callbackPort: 0,
                  clientId: 1,
                  scopes: "",
                  xaa: "yes",
                },
                type: "http",
                url: "https://example.com",
              },
              x: { args: [1], command: 1, env: { X: 1 }, type: "bogus", unknown: true },
            }],
            monitors: [{ command: "watch", description: "Watch.", name: "watch", when: "sometimes" }],
            name: "components",
            source: "./plugins/components",
            userConfig: {
              "bad-key": {
                default: {},
                description: "Token.",
                title: "Token",
                type: "string",
              },
              token: { type: false },
            },
          },
          {
            name: "github",
            source: { repo: "", sha: "x", source: "github" },
          },
          {
            name: "archive",
            source: { sha256: "x", source: "archive", url: "http://example.com/a.zip" },
          },
          {
            name: "command",
            source: { command: "tool path", mode: "bogus", source: "command", timeout: -1 },
          },
          {
            name: "npm",
            source: { package: "", registry: "not a URL", source: "npm" },
          },
          {
            name: "loopback",
            source: { source: "archive", url: "https://127.0.0.1/plugin.zip" },
          },
          {
            name: "unsafe-command",
            source: { command: "tool    café", source: "command" },
          },
          {
            agents: "agents/reviewer.md",
            commands: "commands/review.txt",
            experimental: { monitors: "monitors/config.json" },
            hooks: "hooks/config.yaml",
            lspServers: "lsp/config.json",
            mcpServers: "mcp/config.json",
            monitors: "monitors/config.json",
            name: "paths",
            skills: ["skills/review"],
            source: "./plugins/paths",
          },
        ],
      }),
    ]);
    const messages = result.issues.map(({ message }) => message);
    for (const expected of [
      "destination field plugins[0].channels[0].userConfig.token.type must be a string",
      "destination field plugins[0].commands.bar.source must start with ./",
      "destination field plugins[0].commands.bar must not define both source and content",
      "destination field plugins[0].commands.foo.source must be a string",
      "destination field plugins[0].dependencies[0] must be a valid plugin dependency identifier",
      "destination field plugins[0].dependencies[1].marketplace must not be empty",
      "destination field plugins[0].dependencies[1].version must be a string",
      "missing required destination field plugins[0].experimental.monitors[0].command",
      "unknown destination field plugins[0].hooks[0].Bogus; allowed fields are ConfigChange, CwdChanged, Elicitation, ElicitationResult, FileChanged, InstructionsLoaded, MessageDisplay, Notification, PermissionDenied, PermissionRequest, PostCompact, PostToolBatch, PostToolUse, PostToolUseFailure, PreCompact, PreToolUse, SessionEnd, SessionStart, Setup, Stop, StopFailure, SubagentStart, SubagentStop, TaskCompleted, TaskCreated, TeammateIdle, UserPromptExpansion, UserPromptSubmit, WorktreeCreate, WorktreeRemove",
      "destination field plugins[0].lspServers[0].ts.command must be a string",
      "destination field plugins[0].lspServers[0].ts.transport must be socket or stdio",
      "destination field plugins[0].mcpServers[0].x.command must be a string",
      "destination field plugins[0].mcpServers[0].x.env.X must be a string",
      "destination field plugins[0].mcpServers[0].x.type must be http, sse, stdio, or ws",
      "destination field plugins[0].monitors[0].when must be always or start with on-skill-invoke:",
      "destination field plugins[0].userConfig.bad-key.default must be a string, number, boolean, or array of strings",
      "destination field plugins[0].userConfig.bad-key must use an identifier key",
      "destination field plugins[0].userConfig.token.type must be a string",
      "destination field plugins[1].source.repo must not be empty",
      "destination field plugins[1].source.sha must be a 40-character lowercase hexadecimal commit SHA",
      "destination field plugins[2].source.sha256 must be a 64-character hexadecimal digest",
      "destination field plugins[2].source.url must use HTTPS",
      "destination field plugins[3].source.mode must be copy or link",
      "destination field plugins[3].source.timeout must be an integer from 1 through 600",
      "destination field plugins[4].source.package must not be empty",
      "destination field plugins[4].source.registry must be an absolute URL",
      "destination field plugins[5].source.url must not use a loopback, link-local, or cloud-metadata host",
      "destination field plugins[6].source.command must be at most 500 printable ASCII characters without four consecutive spaces",
      "destination field plugins[7].agents must start with ./",
      "destination field plugins[7].commands must start with ./",
      "destination field plugins[7].experimental.monitors must start with ./",
      "destination field plugins[7].hooks must start with ./",
      "destination field plugins[7].lspServers must start with ./",
      "destination field plugins[7].mcpServers must start with ./ or be an absolute URL",
      "destination field plugins[7].monitors must start with ./",
      "destination field plugins[7].skills[0] must start with ./",
    ]) {
      expect(messages).toContain(expected);
    }
    expect(result.ok).toBe(false);
  });

  it("validates Claude marketplace plugin entry requirements", () => {
    const valid = checkProviderFormatConformance([
      rendered(".claude-plugin/marketplace.json", {
        name: "example",
        owner: { name: "Example Team" },
        plugins: [
          { name: "local", source: "./plugins/local" },
          { name: "Bad_Name", source: "./plugins/native-name" },
          { name: "bad.name", source: "./plugins/dotted-name" },
          { name: "bad_name", source: "./plugins/underscored-name" },
          { name: "a".repeat(128), source: "./plugins/max-name" },
          {
            name: "archive",
            source: {
              sha256: "A".repeat(64),
              source: "archive",
              url: "https://example.com/plugin.zip",
            },
          },
          { name: "command", source: { command: "skillset plugin path", source: "command" } },
          {
            name: "remote",
            source: { repo: "example/remote", source: "github" },
          },
          { name: "npm", source: { package: "@example/plugin", source: "npm" } },
          { name: "url", source: { source: "url", url: "https://example.com/plugin.git" } },
          {
            name: "subdir",
            source: {
              path: "plugins/subdir",
              source: "git-subdir",
              url: "example/repo",
            },
          },
        ],
      }),
    ]);
    expect(valid).toEqual({ checkedFiles: 1, issues: [], ok: true });

    const invalid = checkProviderFormatConformance([
      rendered(".claude-plugin/marketplace.json", {
        name: "example",
        owner: { name: "Example Team" },
        plugins: [
          {},
          { name: 42, source: [] },
          { name: "missing-discriminator", source: {} },
          { name: "invalid-discriminator", source: { source: 42 } },
          { name: "", source: "not-relative" },
          { name: "unknown", source: { source: "bogus" } },
          { name: "missing-repo", source: { source: "github" } },
          {
            name: "empty-subdir",
            source: { path: "", source: "git-subdir", url: "example/repo" },
          },
        ],
      }),
    ]);
    expect(invalid.issues.map(({ code, message }) => ({ code, message }))).toEqual([
      {
        code: "invalid-field-type",
        message: "destination field plugins[1].name must be a string",
      },
      {
        code: "invalid-field-type",
        message: "destination field plugins[1].source must be a string or an object",
      },
      {
        code: "invalid-field-type",
        message: "destination field plugins[3].source.source must be a string",
      },
      {
        code: "invalid-shape",
        message: "destination field plugins[4].name must not be empty",
      },
      {
        code: "invalid-shape",
        message: "destination field plugins[4].source must start with ./ when it is a string",
      },
      {
        code: "invalid-shape",
        message:
          "destination field plugins[5].source.source must be archive, command, github, git-subdir, npm, or url",
      },
      {
        code: "invalid-shape",
        message: "destination field plugins[7].source.path must not be empty",
      },
      {
        code: "missing-required-field",
        message: "missing required destination field plugins[0].name",
      },
      {
        code: "missing-required-field",
        message: "missing required destination field plugins[0].source",
      },
      {
        code: "missing-required-field",
        message: "missing required destination field plugins[2].source.source",
      },
      {
        code: "missing-required-field",
        message: "missing required destination field plugins[6].source.repo",
      },
    ]);
  });

  it("rejects malformed Claude marketplace plugin overrides after rendering", async () => {
    const root = await fixture({
      "skillset.yaml": `
skillset:
  name: provider-format-root
claude:
  marketplace:
    plugins:
      - {}
      - name: ""
        source: not-relative
      - name: missing-repo
        source:
          source: github
`,
      ".skillset/plugins/alpha/skillset.yaml": `
skillset:
  name: alpha
  description: Alpha plugin.
`,
    });
    const build = await buildSkillsetResult(root, { isolated: true });
    const report = checkProviderFormatConformance(
      providerFormatConformanceFiles(build.data, build.renderResults)
    );

    expect(report.issues.map(({ code, message }) => ({ code, message }))).toEqual([
      {
        code: "invalid-shape",
        message: "destination field plugins[1].name must not be empty",
      },
      {
        code: "invalid-shape",
        message: "destination field plugins[1].source must start with ./ when it is a string",
      },
      {
        code: "missing-required-field",
        message: "missing required destination field plugins[0].name",
      },
      {
        code: "missing-required-field",
        message: "missing required destination field plugins[0].source",
      },
      {
        code: "missing-required-field",
        message: "missing required destination field plugins[2].source.repo",
      },
    ]);
  });

  it("rejects Claude marketplace values that fail runtime and sync validation", () => {
    const report = checkProviderFormatConformance([
      rendered(".claude-plugin/marketplace.json", {
        name: "example",
        owner: { name: "Example Team" },
        plugins: [
          { name: "bad name", source: "./plugins/bad" },
          { name: "bad/name", source: "./plugins/slash" },
          { name: "bad@name", source: "./plugins/at-sign" },
          { name: ".leading", source: "./plugins/leading" },
          { name: "a".repeat(129), source: "./plugins/too-long" },
          { name: "local-traversal", source: "./../outside" },
          { name: "empty-command", source: { command: "", source: "command" } },
          { name: "empty-archive", source: { source: "archive", url: "" } },
          {
            name: "subdir-traversal",
            source: { path: "../outside", source: "git-subdir", url: "example/repo" },
          },
        ],
      }),
    ]);

    expect(report.issues.map(({ code, message }) => ({ code, message }))).toEqual([
      {
        code: "invalid-shape",
        message:
          "destination field plugins[0].name must start with a letter or digit, use only letters, digits, dots, underscores, or hyphens, and contain at most 128 characters",
      },
      {
        code: "invalid-shape",
        message:
          "destination field plugins[1].name must start with a letter or digit, use only letters, digits, dots, underscores, or hyphens, and contain at most 128 characters",
      },
      {
        code: "invalid-shape",
        message:
          "destination field plugins[2].name must start with a letter or digit, use only letters, digits, dots, underscores, or hyphens, and contain at most 128 characters",
      },
      {
        code: "invalid-shape",
        message:
          "destination field plugins[3].name must start with a letter or digit, use only letters, digits, dots, underscores, or hyphens, and contain at most 128 characters",
      },
      {
        code: "invalid-shape",
        message:
          "destination field plugins[4].name must start with a letter or digit, use only letters, digits, dots, underscores, or hyphens, and contain at most 128 characters",
      },
      {
        code: "invalid-shape",
        message:
          "destination field plugins[5].source must not traverse outside the marketplace root",
      },
      {
        code: "invalid-shape",
        message: "destination field plugins[6].source.command must not be empty",
      },
      {
        code: "invalid-shape",
        message: "destination field plugins[7].source.url must not be empty",
      },
      {
        code: "invalid-shape",
        message: "destination field plugins[8].source.path must not contain parent traversal",
      },
    ]);
  });

  it("rejects Claude marketplace mcpServers array references that are neither ./ nor absolute URLs", () => {
    const report = checkProviderFormatConformance([
      rendered(".claude-plugin/marketplace.json", {
        name: "example",
        owner: { name: "Example Team" },
        plugins: [
          {
            mcpServers: [
              "./mcp/config.json",
              "https://example.com/mcp.json",
              "not-relative",
              { local: { command: "node" } },
            ],
            name: "mcp-array",
            source: "./plugins/mcp-array",
          },
        ],
      }),
    ]);

    expect(report.issues.map(({ code, message }) => ({ code, message }))).toEqual([
      {
        code: "invalid-shape",
        message:
          "destination field plugins[0].mcpServers[2] must start with ./ or be an absolute URL",
      },
    ]);
  });

  it("rejects unknown fields in Claude marketplace dependency objects", () => {
    const report = checkProviderFormatConformance([
      rendered(".claude-plugin/marketplace.json", {
        name: "example",
        owner: { name: "Example Team" },
        plugins: [
          {
            dependencies: [
              { marketplace: "example", name: "supported", version: "1.0.0" },
              { name: "dep", unexpected: true },
            ],
            name: "dependencies",
            source: "./plugins/dependencies",
          },
        ],
      }),
    ]);

    expect(report.issues.map(({ code, message }) => ({ code, message }))).toEqual([
      {
        code: "unknown-destination-field",
        message:
          "unknown destination field plugins[0].dependencies[1].unexpected; allowed fields are marketplace, name, version",
      },
    ]);
  });

  it("rejects IPv4-mapped IPv6 loopback and link-local archive hosts", () => {
    const report = checkProviderFormatConformance([
      rendered(".claude-plugin/marketplace.json", {
        name: "example",
        owner: { name: "Example Team" },
        plugins: [
          {
            name: "mapped-loopback",
            source: { source: "archive", url: "https://[::ffff:127.0.0.1]/plugin.zip" },
          },
          {
            name: "mapped-loopback-hextets",
            source: { source: "archive", url: "https://[::ffff:7f00:1]/plugin.zip" },
          },
          {
            name: "mapped-link-local",
            source: { source: "archive", url: "https://[::ffff:169.254.169.254]/plugin.zip" },
          },
          {
            name: "expanded-loopback",
            source: { source: "archive", url: "https://[0:0:0:0:0:0:0:1]/plugin.zip" },
          },
          {
            name: "mapped-public",
            source: { source: "archive", url: "https://[::ffff:8.8.8.8]/plugin.zip" },
          },
        ],
      }),
    ]);

    expect(report.issues.map(({ code, message }) => ({ code, message }))).toEqual([
      {
        code: "invalid-shape",
        message:
          "destination field plugins[0].source.url must not use a loopback, link-local, or cloud-metadata host",
      },
      {
        code: "invalid-shape",
        message:
          "destination field plugins[1].source.url must not use a loopback, link-local, or cloud-metadata host",
      },
      {
        code: "invalid-shape",
        message:
          "destination field plugins[2].source.url must not use a loopback, link-local, or cloud-metadata host",
      },
      {
        code: "invalid-shape",
        message:
          "destination field plugins[3].source.url must not use a loopback, link-local, or cloud-metadata host",
      },
    ]);
  });

  it("rejects fully qualified archive hosts that end in a terminal dot", () => {
    const report = checkProviderFormatConformance([
      rendered(".claude-plugin/marketplace.json", {
        name: "example",
        owner: { name: "Example Team" },
        plugins: [
          {
            name: "fqdn-loopback",
            source: { source: "archive", url: "https://localhost./plugin.zip" },
          },
          {
            name: "fqdn-metadata",
            source: { source: "archive", url: "https://Metadata.Google.Internal./plugin.zip" },
          },
          {
            name: "fqdn-repeated-dots",
            source: { source: "archive", url: "https://localhost../plugin.zip" },
          },
          {
            name: "fqdn-public",
            source: { source: "archive", url: "https://example.com./plugin.zip" },
          },
        ],
      }),
    ]);

    expect(report.issues.map(({ code, message }) => ({ code, message }))).toEqual([
      {
        code: "invalid-shape",
        message:
          "destination field plugins[0].source.url must not use a loopback, link-local, or cloud-metadata host",
      },
      {
        code: "invalid-shape",
        message:
          "destination field plugins[1].source.url must not use a loopback, link-local, or cloud-metadata host",
      },
      {
        code: "invalid-shape",
        message:
          "destination field plugins[2].source.url must not use a loopback, link-local, or cloud-metadata host",
      },
    ]);
  });

  it("rejects archive URLs that cannot be parsed", () => {
    const report = checkProviderFormatConformance([
      rendered(".claude-plugin/marketplace.json", {
        name: "example",
        owner: { name: "Example Team" },
        plugins: [
          {
            name: "unparsable-host",
            source: { source: "archive", url: "https://[bad" },
          },
          {
            name: "scheme-only",
            source: { source: "archive", url: "https://" },
          },
          {
            name: "uppercase-scheme",
            source: { source: "archive", url: "HTTPS://Example.com/plugin.zip" },
          },
          {
            name: "valid",
            source: { source: "archive", url: "https://example.com/plugin.zip" },
          },
        ],
      }),
    ]);

    expect(report.issues.map(({ code, message }) => ({ code, message }))).toEqual([
      {
        code: "invalid-shape",
        message:
          "destination field plugins[0].source.url must be a parsable absolute URL",
      },
      {
        code: "invalid-shape",
        message:
          "destination field plugins[1].source.url must be a parsable absolute URL",
      },
    ]);
  });

  it("classifies skill targets by output path segments instead of substrings", () => {
    const report = checkProviderFormatConformance([
      textFile("plugins/codex-helper/claude/skills/demo/SKILL.md", [
        "---",
        "allowed-tools: Read",
        "---",
        "",
        "Use the helper.",
        "",
      ].join("\n")),
    ]);

    expect(report).toEqual({ checkedFiles: 1, issues: [], ok: true });
  });

  it("uses render-result metadata to include custom output roots", async () => {
    const root = await fixture({
      "skillset.yaml": `
skillset:
  name: provider-format-root
claude: false
codex:
  skills:
    path: generated/openai-skills
`,
      ".skillset/skills/repo-skill/SKILL.md": `
---
name: repo-skill
description: Repo skill.
---

Use the repo skill.
`,
    });
    const build = await buildSkillsetResult(root, { isolated: true });

    const files = providerFormatConformanceFiles(build.data, build.renderResults);
    const customSkill = files.find((file) =>
      file.path === ".skillset/cache/latest/generated/openai-skills/repo-skill/SKILL.md"
    );

    expect(customSkill).toMatchObject({
      destination: "skill",
      target: "codex",
    });
    expect(checkProviderFormatConformance(files)).toEqual({ checkedFiles: files.length, issues: [], ok: true });
  });
});

function rendered(path: string, value: Record<string, unknown>) {
  return {
    content: new TextEncoder().encode(`${JSON.stringify(value, null, 2)}\n`),
    path,
  };
}

function textFile(path: string, content: string) {
  return {
    content: new TextEncoder().encode(content),
    path,
  };
}

async function fixture(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "skillset-provider-format-conformance-"));
  for (const [path, content] of Object.entries(normalizeSkillsetFixtureFiles(files))) {
    await Bun.write(join(root, path), `${content.trim()}\n`);
  }
  return root;
}
