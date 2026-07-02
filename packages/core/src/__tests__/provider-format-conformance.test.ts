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
