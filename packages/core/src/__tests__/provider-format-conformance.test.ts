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
claude: true
codex: true
cursor: true
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
    expect(report.issues.map((issue) => issue.message).join("\n")).toContain("Codex plugin manifest structure is currently documented in prose");
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
          { name: "archive", source: { source: "archive", url: "https://example.com/plugin.zip" } },
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
