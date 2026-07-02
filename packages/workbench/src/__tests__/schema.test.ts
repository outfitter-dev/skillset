import { describe, expect, test } from "bun:test";

import {
  checkWorkbenchSourceContract,
  formatWorkbenchDiagnostic,
} from "../index";

describe("workbench source contract schema checks", () => {
  test("accepts representative valid source documents", () => {
    expect(checkWorkbenchSourceContract({
      content:
        "compile:\n  targets: [claude, codex]\n  unsupportedDestination: error\nskillset:\n  name: skillset\n  schema: 1\n  version: 0.1.0\nsupports:\n  packages: []\n",
      kind: "workspace-config",
      path: "skillset.yaml",
    })).toEqual([]);

    expect(checkWorkbenchSourceContract({
      content: "---\ndescription: Demo skill.\nname: demo\nresources: {}\n---\nUse this skill.\n",
      kind: "skill",
      path: ".skillset/skills/demo/SKILL.md",
    })).toEqual([]);

    expect(checkWorkbenchSourceContract({
      content:
        "---\ndescription: Review agent.\nskills:\n  - review\ncodex:\n  model: gpt-5.5\n---\nReview the change.\n",
      kind: "agent",
      path: ".skillset/agents/reviewer.md",
    })).toEqual([]);

    expect(checkWorkbenchSourceContract({
      content: "---\nname: root\ndialect: claude\nclaude:\n  paths:\n    - src/**\n---\nFollow the repo.\n",
      kind: "instruction",
      path: ".skillset/rules/root.md",
    })).toEqual([]);

    expect(checkWorkbenchSourceContract({
      content: JSON.stringify({
        hooks: {
          SessionStart: [{ hooks: [{ command: "./run.sh", type: "command" }] }],
        },
      }),
      kind: "hook",
      path: ".skillset/plugins/demo/hooks/hooks.json",
    })).toEqual([]);
  });

  test("reports skill frontmatter and body contract diagnostics", () => {
    const diagnostics = checkWorkbenchSourceContract({
      content: "---\nname: 12\ntargets: [codex]\nresources: ./refs\n---\n\n",
      kind: "skill",
      path: ".skillset/skills/demo/SKILL.md",
    });

    expect(diagnostics.map(formatWorkbenchDiagnostic)).toEqual([
      ".skillset/skills/demo/SKILL.md:2: error: schema/skill-frontmatter: name must be a non-empty string",
      ".skillset/skills/demo/SKILL.md:2: error: schema/skill-frontmatter: skill needs description, summary, title, or skillset descriptive metadata",
      ".skillset/skills/demo/SKILL.md:3: error: schema/skill-frontmatter: skills must remove targets; use root compile.targets and provider-specific blocks for file-level behavior",
      ".skillset/skills/demo/SKILL.md:6: error: schema/skill-body: skill body is required",
    ]);
    expect(diagnostics.find((diagnostic) => diagnostic.message.startsWith("skills must remove targets"))?.fix).toEqual({
      kind: "suggestion",
      message: "Move provider selection to `skillset.yaml` as `compile:\\n  targets: [claude, codex, cursor]`; keep file-level behavior in provider-specific blocks.",
    });
  });

  test("reports Markdown warnings alongside schema diagnostics", () => {
    const diagnostics = checkWorkbenchSourceContract({
      content: [
        "---",
        "name: demo",
        "---",
        "```markdown",
        "Use this example:",
        "```ts",
        "console.log('hello');",
        "```",
        "```",
        "",
      ].join("\n"),
      kind: "skill",
      path: ".skillset/skills/demo/SKILL.md",
    });

    expect(diagnostics.map(formatWorkbenchDiagnostic)).toEqual([
      ".skillset/skills/demo/SKILL.md:2: error: schema/skill-frontmatter: skill needs description, summary, title, or skillset descriptive metadata",
      ".skillset/skills/demo/SKILL.md:4:1: warning: markdown/code-fence-nesting: outer 3-backtick fence is not long enough for inner 3-backtick fence on line 6",
    ]);
  });

  test("accepts derivable skill descriptions and rejects nested skill identity", () => {
    expect(checkWorkbenchSourceContract({
      content: "---\ntitle: Demo Skill\n---\nUse this skill.\n",
      kind: "skill",
      path: ".skillset/skills/demo/SKILL.md",
    })).toEqual([]);
    expect(checkWorkbenchSourceContract({
      content: "---\nskillset:\n  summary: Demo skill.\n---\nUse this skill.\n",
      kind: "skill",
      path: ".skillset/skills/demo/SKILL.md",
    })).toEqual([]);

    expect(checkWorkbenchSourceContract({
      content: "---\nskillset:\n  name: demo\n  id: demo\n  version: 1.0.0\n  summary: Demo skill.\n---\nUse it.\n",
      kind: "skill",
      path: ".skillset/skills/demo/SKILL.md",
    }).map(formatWorkbenchDiagnostic)).toEqual([
      ".skillset/skills/demo/SKILL.md:3: error: schema/skill-frontmatter: skillset.name is unsupported in skills; use top-level name",
      ".skillset/skills/demo/SKILL.md:4: error: schema/skill-frontmatter: skillset.id is unsupported in skills; use top-level name",
      ".skillset/skills/demo/SKILL.md:5: error: schema/skill-frontmatter: skillset.version is unsupported in skills; use top-level version",
    ]);
  });

  test("reports agent frontmatter and body contract diagnostics", () => {
    const diagnostics = checkWorkbenchSourceContract({
      content: "---\ndescription: ''\nskills: write-docs\nclaude: nope\ninitialPrompt: 7\ntargets: [claude]\n---\n",
      kind: "agent",
      path: ".skillset/agents/writer.md",
    });

    expect(diagnostics.map(formatWorkbenchDiagnostic)).toEqual([
      ".skillset/agents/writer.md:2: error: schema/agent-frontmatter: description is required and must be a non-empty string",
      ".skillset/agents/writer.md:3: error: schema/agent-frontmatter: skills must be a string array when present",
      ".skillset/agents/writer.md:4: error: schema/agent-frontmatter: claude must be true, false, or an object when present",
      ".skillset/agents/writer.md:5: error: schema/agent-frontmatter: initialPrompt must be a non-empty string",
      ".skillset/agents/writer.md:6: error: schema/agent-frontmatter: agents must remove targets; use root compile.targets and provider-specific blocks for file-level behavior",
      ".skillset/agents/writer.md:8: error: schema/agent-body: agent body is required",
    ]);
    expect(diagnostics.find((diagnostic) => diagnostic.message.startsWith("description is required"))?.fix).toEqual({
      kind: "suggestion",
      message: "Add `description: <what this agent does>` to the agent frontmatter.",
    });
  });

  test("reports instruction frontmatter contract diagnostics", () => {
    const diagnostics = checkWorkbenchSourceContract({
      content: "---\ndialect: codex\nclaude: nope\nsupports:\n  tools: []\n---\nFollow the repo.\n",
      kind: "instruction",
      path: ".skillset/rules/root.md",
    });

    expect(diagnostics.map(formatWorkbenchDiagnostic)).toEqual([
      ".skillset/rules/root.md:2: error: schema/instruction-frontmatter: dialect must be claude when present",
      ".skillset/rules/root.md:3: error: schema/instruction-frontmatter: claude must be true, false, or an object when present",
      ".skillset/rules/root.md:5: error: schema/instruction-frontmatter: unsupported supports key tools; v1 supports packages",
    ]);
  });

  test("reports workspace config contract diagnostics", () => {
    const diagnostics = checkWorkbenchSourceContract({
      content:
        "targets: [codex]\nskillset:\n  id: demo\n  name: ''\n  schema: v1\nsupports:\n  tools: []\ntests: true\ncompile:\n  build: sometimes\n  targets: [codex, nope, codex]\n  unsupportedDestination: later\n  extra: true\n  features:\n    promptArguments: yes\n    other: true\n  skillset:\n    metadata: nope\n    extra: true\nunknown: true\n",
      kind: "workspace-config",
      path: "skillset.yaml",
    });

    expect(diagnostics.map(formatWorkbenchDiagnostic)).toEqual([
      "skillset.yaml:1: error: schema/workspace-config: unsupported workspace config key targets",
      "skillset.yaml:1: error: schema/workspace-config: workspace config must use compile.targets instead of targets",
      "skillset.yaml:3: error: schema/workspace-config: skillset.id is unsupported; use skillset.name",
      "skillset.yaml:4: error: schema/workspace-config: skillset.name must be a non-empty string when present",
      "skillset.yaml:5: error: schema/workspace-config: skillset.schema must be a positive integer when present",
      "skillset.yaml:7: error: schema/workspace-config: unsupported supports key tools; v1 supports packages",
      "skillset.yaml:8: error: schema/workspace-config: unsupported workspace config key tests",
      "skillset.yaml:10: error: schema/workspace-config: compile.build must be one of all, updated",
      "skillset.yaml:11: error: schema/workspace-config: duplicate compile target codex",
      "skillset.yaml:11: error: schema/workspace-config: unsupported compile target nope",
      "skillset.yaml:12: error: schema/workspace-config: compile.unsupportedDestination must be error",
      "skillset.yaml:13: error: schema/workspace-config: unsupported compile key extra",
      "skillset.yaml:15: error: schema/workspace-config: compile.features.promptArguments must be a boolean",
      "skillset.yaml:16: error: schema/workspace-config: unsupported compile feature key other",
      "skillset.yaml:18: error: schema/workspace-config: compile.skillset.metadata must be a boolean",
      "skillset.yaml:19: error: schema/workspace-config: unsupported compile skillset key extra",
      "skillset.yaml:20: error: schema/workspace-config: unsupported workspace config key unknown",
    ]);
    expect(diagnostics.find((diagnostic) => diagnostic.message === "workspace config must use compile.targets instead of targets")?.fix).toEqual({
      kind: "suggestion",
      message: "Replace top-level `targets` with `compile:\\n  targets: [claude, codex, cursor]`.",
    });
  });

  test("reports workspace cache key diagnostics", () => {
    const diagnostics = checkWorkbenchSourceContract({
      content: "workspace:\n  cacheKey: ' acme'\n  other: true\n",
      kind: "workspace-config",
      path: "skillset.yaml",
    });

    expect(diagnostics.map(formatWorkbenchDiagnostic)).toEqual([
      "skillset.yaml:2: error: schema/workspace-config: workspace.cacheKey must be a lowercase repo cache key",
      "skillset.yaml:3: error: schema/workspace-config: unsupported workspace key other",
    ]);
    expect(diagnostics.find((diagnostic) => diagnostic.message.startsWith("workspace.cacheKey"))?.fix).toEqual({
      kind: "suggestion",
      message: "Remove `workspace.cacheKey` to use the automatic XDG cache key, or set a lowercase key such as `team--repo`.",
    });

    expect(checkWorkbenchSourceContract({
      content: "workspace:\n  cacheKey: acme--docs-cli\n",
      kind: "workspace-config",
      path: "skillset.yaml",
    })).toEqual([]);
  });

  test("reports workspace target block diagnostics from the shared schema", () => {
    expect(checkWorkbenchSourceContract({
      content: "claude: nope\ncodex: []\n",
      kind: "workspace-config",
      path: "skillset.yaml",
    }).map(formatWorkbenchDiagnostic)).toEqual([
      "skillset.yaml:1: error: schema/workspace-config: claude must be true, false, or an object when present",
      "skillset.yaml:2: error: schema/workspace-config: codex must be true, false, or an object when present",
    ]);
  });

  test("reports missing workspace supports package collection", () => {
    expect(checkWorkbenchSourceContract({
      content: "supports: {}\n",
      kind: "workspace-config",
      path: "skillset.yaml",
    }).map(formatWorkbenchDiagnostic)).toEqual([
      "skillset.yaml:1: error: schema/workspace-config: supports object form must include packages as an array",
    ]);
  });

  test("reports stricter workspace diagnostics from the shared schema", () => {
    expect(checkWorkbenchSourceContract({
      content: "skillset:\n  schema: 2\n",
      kind: "workspace-config",
      path: "skillset.yaml",
    }).map(formatWorkbenchDiagnostic)).toEqual([
      "skillset.yaml:2: error: schema/workspace-config: skillset.schema must be 1",
    ]);

    expect(checkWorkbenchSourceContract({
      content: "compile:\n  unsupportedDestination: later\n",
      kind: "workspace-config",
      path: "skillset.yaml",
    }).map(formatWorkbenchDiagnostic)).toEqual([
      "skillset.yaml:2: error: schema/workspace-config: compile.unsupportedDestination must be error",
    ]);
  });

  test("rejects deferred unsupportedDestination policies", () => {
    expect(checkWorkbenchSourceContract({
      content: "compile:\n  unsupportedDestination: warn\n",
      kind: "workspace-config",
      path: "skillset.yaml",
    }).map(formatWorkbenchDiagnostic)).toEqual([
      "skillset.yaml:2: error: schema/workspace-config: compile.unsupportedDestination warn, skip, and force are reserved; use error",
    ]);
  });

  test("reports hook source contract diagnostics", () => {
    const diagnostics = checkWorkbenchSourceContract({
      content: JSON.stringify({
        hooks: {
          ConfigChange: [{ hooks: ["bad", { command: "echo hi" }] }],
          SessionStart: { hooks: [] },
          Stop: ["bad", { hooks: {} }],
        },
      }),
      kind: "hook",
      path: ".skillset/plugins/demo/hooks/hooks.json",
    });

    expect(diagnostics.map(formatWorkbenchDiagnostic)).toEqual([
      ".skillset/plugins/demo/hooks/hooks.json:1: error: schema/hook: hook event ConfigChange hook handlers must be objects",
      ".skillset/plugins/demo/hooks/hooks.json:1: error: schema/hook: hook event ConfigChange hook handlers must include a non-empty string type",
      ".skillset/plugins/demo/hooks/hooks.json:1: error: schema/hook: hook event SessionStart must be an array",
      ".skillset/plugins/demo/hooks/hooks.json:1: error: schema/hook: hook event Stop entries must be objects",
      ".skillset/plugins/demo/hooks/hooks.json:1: error: schema/hook: hook event Stop hooks must be an array",
    ]);
  });

  test("reports invalid top-level hooks containers", () => {
    expect(checkWorkbenchSourceContract({
      content: JSON.stringify({ hooks: [] }),
      kind: "hook",
      path: ".skillset/plugins/demo/hooks/hooks.json",
    }).map(formatWorkbenchDiagnostic)).toEqual([
      ".skillset/plugins/demo/hooks/hooks.json:1: error: schema/hook: hooks must be an object when present",
    ]);
  });

  test("returns syntax diagnostics before schema diagnostics", () => {
    expect(checkWorkbenchSourceContract({
      content: "---\ndescription: [\n---\n",
      kind: "skill",
      path: ".skillset/skills/demo/SKILL.md",
    })).toEqual([
      expect.objectContaining({
        ruleId: "syntax/markdown-frontmatter",
      }),
    ]);

    expect(checkWorkbenchSourceContract({
      content: "[]",
      kind: "hook",
      path: ".skillset/plugins/demo/hooks/hooks.json",
    }).map(formatWorkbenchDiagnostic)).toEqual([
      ".skillset/plugins/demo/hooks/hooks.json:1: error: schema/hook: hook file must contain a JSON object",
    ]);
  });
});
