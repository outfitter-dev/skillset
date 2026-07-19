import { describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { normalizeSkillsetFixtureFiles } from "../../../../scripts/test-helpers/skillset-config";

import {
  resolveAdaptiveHookAttachments,
  type SourceAdaptiveHook,
  type SourceHookAttachment,
} from "@skillset/core";
import {
  adaptiveHookIntentIsRenderable,
  classifyAdaptiveHookIntent,
} from "../adaptive-hook-classifier";
import { renderBuildGraph } from "../render";
import { loadBuildGraph } from "../resolver";
import { targetNames } from "../targets";
import type { JsonRecord } from "../types";
import { parseMarkdown } from "../yaml";

describe("adaptive hook attachment resolution", () => {
  test("resolves nearest definitions and expands auto attachments", () => {
    const root = hook("shared", ["SessionStart"], { kind: "root" }, "root/hooks/shared.json");
    const plugin = hook("shared", ["Stop"], { kind: "plugin", pluginId: "demo" }, "plugins/demo/hooks/shared.json");
    const skill = hook("shared", ["PreToolUse"], { kind: "skill", pluginId: "demo", skillId: "writer" }, "plugins/demo/skills/writer/hooks/shared.json");
    const attachments: SourceHookAttachment[] = [
      { event: "PreToolUse", hook: "shared", scope: { kind: "skill", pluginId: "demo", skillId: "writer" }, sourcePath: "plugins/demo/skills/writer/SKILL.md" },
      { hook: "shared", scope: { kind: "plugin", pluginId: "demo" }, sourcePath: "plugins/demo/skillset.yaml" },
      { hook: "shared", scope: { kind: "agent", agentId: "helper" }, sourcePath: "agents/helper.md" },
    ];

    const resolution = resolveAdaptiveHookAttachments([root, plugin, skill], attachments);
    expect(resolution.issues).toEqual([]);
    expect(resolution.resolved.map((item) => `${item.definition.sourcePath}:${item.event}`)).toEqual([
      "root/hooks/shared.json:SessionStart",
      "plugins/demo/skills/writer/hooks/shared.json:PreToolUse",
      "plugins/demo/hooks/shared.json:Stop",
    ]);
  });

  test("reports missing, broadening, ambiguous, and duplicate attachment problems", () => {
    const root = hook("shared", ["SessionStart"], { kind: "root" }, "hooks/shared.json");
    const duplicateRoot = hook("shared", ["Stop"], { kind: "root" }, "hooks/shared-again.json");
    const attachment = { event: "PreToolUse", hook: "shared", scope: { kind: "agent", agentId: "helper" }, sourcePath: "agents/helper.md" } satisfies SourceHookAttachment;
    const missing = { event: "Stop", hook: "missing", scope: { kind: "agent", agentId: "helper" }, sourcePath: "agents/helper.md" } satisfies SourceHookAttachment;

    expect(resolveAdaptiveHookAttachments([root, duplicateRoot], [attachment, missing]).issues.map((issue) => issue.code)).toEqual([
      "adaptive-hook-attachment-ambiguous",
      "adaptive-hook-attachment-missing",
      "adaptive-hook-duplicate-name",
    ]);
    expect(resolveAdaptiveHookAttachments([root], [attachment]).issues).toContainEqual(expect.objectContaining({
      code: "adaptive-hook-attachment-event",
    }));
  });
});

describe("adaptive hook graph loading", () => {
  test("preserves every canonical attachment provider in author order", async () => {
    const providers = [...targetNames()].reverse();
    const graph = await loadBuildGraph(await fixture({
      "skillset.yaml": `
skillset:
  name: adaptive-hook-provider-order
claude: true
codex: true
cursor: true
`,
      ".skillset/plugins/demo/skillset.yaml": `
skillset:
  name: demo
hooks:
  Stop:
    - hook: shell-policy
      providers: [${providers.join(", ")}]
`,
      ".skillset/plugins/demo/hooks/shell-policy.json": JSON.stringify({
        events: ["Stop"],
        run: { command: "echo ok" },
      }),
    }));

    expect(graph.hookAttachments).toContainEqual(expect.objectContaining({
      hook: "shell-policy",
      providers,
    }));
  });

  test("keeps Cursor-only attachments scoped through rendering", async () => {
    const graph = await loadBuildGraph(await fixture({
      "skillset.yaml": `
skillset:
  name: adaptive-hook-cursor-provider
claude: true
codex: true
cursor: true
`,
      ".skillset/plugins/demo/skillset.yaml": `
skillset:
  name: demo
hooks:
  Stop:
    - hook: shell-policy
      providers: [cursor]
`,
      ".skillset/plugins/demo/hooks/shell-policy.json": JSON.stringify({
        events: ["Stop"],
        run: { command: "echo ok" },
      }),
    }));

    expect(graph.hookAttachments).toContainEqual(expect.objectContaining({
      hook: "shell-policy",
      providers: ["cursor"],
    }));
    const resolution = resolveAdaptiveHookAttachments(graph.adaptiveHooks, graph.hookAttachments);
    expect(resolution.issues).toEqual([]);
    const classification = classifyAdaptiveHookIntent(resolution.resolved[0]!, "cursor", "plugin");
    expect(classification).toEqual(expect.objectContaining({
      reason: "Adaptive hook shell-policy is scoped to cursor.",
      status: "provider-scoped-adaptive",
      target: "cursor",
    }));
    expect(adaptiveHookIntentIsRenderable(classification)).toBe(true);
    const hookOutputs = (await renderBuildGraph(graph))
      .map((file) => file.path)
      .filter((path) => path.endsWith("/hooks/hooks.json"));
    expect(hookOutputs).toEqual(["plugins/demo/cursor/hooks/hooks.json"]);
  });

  test("keeps omitted attachment providers enabled for every configured target", async () => {
    const graph = await loadBuildGraph(await fixture({
      "skillset.yaml": `
skillset:
  name: adaptive-hook-omitted-providers
claude: true
codex: true
cursor: true
`,
      ".skillset/plugins/demo/skillset.yaml": `
skillset:
  name: demo
hooks:
  Stop:
    - shell-policy
`,
      ".skillset/plugins/demo/hooks/shell-policy.json": JSON.stringify({
        events: ["Stop"],
        run: { command: "echo ok" },
      }),
    }));

    expect(graph.hookAttachments.find((attachment) => attachment.hook === "shell-policy")?.providers).toBeUndefined();
    const hookOutputs = (await renderBuildGraph(graph))
      .map((file) => file.path)
      .filter((path) => path.endsWith("/hooks/hooks.json"));
    expect(hookOutputs).toEqual([
      "plugins/demo/claude/hooks/hooks.json",
      "plugins/demo/codex/hooks/hooks.json",
      "plugins/demo/cursor/hooks/hooks.json",
    ]);
  });

  test("rejects invalid plugin attachment providers through schema diagnostics", async () => {
    await expect(loadBuildGraph(await fixture({
      "skillset.yaml": `
skillset:
  name: adaptive-hook-invalid-provider
claude: true
codex: true
cursor: true
`,
      ".skillset/plugins/demo/skillset.yaml": `
skillset:
  name: demo
hooks:
  Stop:
    - hook: shell-policy
      providers: [bad]
`,
      ".skillset/plugins/demo/hooks/shell-policy.json": JSON.stringify({
        events: ["Stop"],
        run: { command: "echo ok" },
      }),
    }))).rejects.toMatchObject({
      code: "plugin-manifest-invalid",
      featureId: "plugin-manifests",
      message: expect.stringContaining("hook attachment providers entries must be claude, codex, or cursor"),
    });
  });

  test("loads root, plugin, and skill-local definitions plus frontmatter attachments", async () => {
    const graph = await loadBuildGraph(await fixture({
      "skillset.yaml": `
skillset:
  name: adaptive-hook-graph
claude: true
codex: false
`,
      ".skillset/hooks/session.json": JSON.stringify({ events: ["SessionStart"], run: { command: "node ./session.js" } }),
      ".skillset/plugins/demo/skillset.yaml": `
skillset:
  name: demo
hooks:
  Stop:
    - shell
`,
      ".skillset/plugins/demo/hooks/shell.json": JSON.stringify({ events: ["Stop"], run: { command: "node ./shell.js" } }),
      ".skillset/plugins/demo/skills/writer/SKILL.md": `
---
name: writer
description: Demo writer.
hooks:
  PreToolUse:
    - local-shell
  Stop:
    - shell
  auto:
    - session
---

Body.
`,
      ".skillset/plugins/demo/skills/writer/hooks/local-shell.json": JSON.stringify({ events: ["PreToolUse"], run: { command: "node ./local.js" } }),
    }));

    expect(graph.adaptiveHooks.map((hook) => hook.name)).toEqual(["session", "shell", "local-shell"]);
    expect(graph.hookAttachments.map((attachment) => `${attachment.event ?? "auto"}:${attachment.hook}`)).toEqual([
      "Stop:shell",
      "PreToolUse:local-shell",
      "Stop:shell",
      "auto:session",
    ]);
  });

  test("loads project-agent local hook definitions from a sibling hook directory", async () => {
    const graph = await loadBuildGraph(await fixture({
      "skillset.yaml": `
skillset:
  name: adaptive-agent-hooks
claude: true
codex: false
`,
      ".skillset/agents/helper.md": `
---
description: Demo helper.
hooks:
  SessionStart:
    - helper-session
---

Body.
`,
      ".skillset/agents/helper/hooks/helper-session.json": JSON.stringify({ events: ["SessionStart"], run: { command: "node ./session.js" } }),
    }));

    expect(graph.adaptiveHooks.map((hook) => `${hook.scope.kind}:${hook.name}`)).toEqual(["agent:helper-session"]);
    expect(graph.hookAttachments.map((attachment) => `${attachment.scope.kind}:${attachment.event}:${attachment.hook}`)).toEqual(["agent:SessionStart:helper-session"]);
  });

  test("rejects unresolved hook attachments while loading the graph", async () => {
    const root = await fixture({
      "skillset.yaml": `
skillset:
  name: adaptive-hook-missing
claude: true
codex: false
`,
      ".skillset/skills/demo/SKILL.md": `
---
name: demo
description: Demo skill.
hooks:
  PreToolUse:
    - missing
---

Body.
`,
    });

    await expect(loadBuildGraph(root)).rejects.toThrow("adaptive hook attachment references missing hook missing");
  });

  test("resolves hook-local and shared script references", async () => {
    const root = await fixture({
      "skillset.yaml": `
skillset:
  name: adaptive-hook-scripts
claude: true
codex: false
`,
      ".skillset/hooks/session.json": JSON.stringify({ events: ["SessionStart"], run: { script: "{{scripts.dir}}/session.js" } }),
      ".skillset/scripts/session.js": "process.exit(0);\n",
      ".skillset/plugins/demo/skillset.yaml": `
skillset:
  name: demo
`,
      ".skillset/plugins/demo/hooks/shell/hook.json": JSON.stringify({ events: ["PreToolUse"], run: { script: "./check.js" } }),
      ".skillset/plugins/demo/hooks/shell/check.js": "process.exit(0);\n",
    });
    const graph = await loadBuildGraph(root);

    expect(graph.adaptiveHooks.flatMap((hook) =>
      hook.scriptReferences.map((reference) => `${hook.name}:${reference.kind}:${reference.runtimePath}:${relative(root, reference.sourcePath)}`)
    )).toEqual([
      "session:scripts-dir:{{scripts.dir}}/session.js:.skillset/scripts/session.js",
      "shell:hook-local:./check.js:.skillset/plugins/demo/hooks/shell/check.js",
    ]);
  });

  test("rejects missing hook script references", async () => {
    const root = await fixture({
      "skillset.yaml": `
skillset:
  name: adaptive-hook-missing-script
claude: true
codex: false
`,
      ".skillset/plugins/demo/skillset.yaml": `
skillset:
  name: demo
`,
      ".skillset/plugins/demo/hooks/shell/hook.json": JSON.stringify({ events: ["PreToolUse"], run: { script: "./missing.js" } }),
    });

    await expect(loadBuildGraph(root)).rejects.toThrow("adaptive hook run.script ./missing.js does not resolve to an existing source file");
  });

  test("rejects hook-local script references from flat hook units", async () => {
    const root = await fixture({
      "skillset.yaml": `
skillset:
  name: adaptive-hook-flat-script
claude: true
codex: false
`,
      ".skillset/plugins/demo/skillset.yaml": `
skillset:
  name: demo
`,
      ".skillset/plugins/demo/hooks/shell.json": JSON.stringify({ events: ["PreToolUse"], run: { script: "./check.js" } }),
      ".skillset/plugins/demo/hooks/check.js": "process.exit(0);\n",
    });

    await expect(loadBuildGraph(root)).rejects.toThrow("hook-local scripts require a directory hook unit");
  });

  test("omits adaptive plugin hooks with render fields that are not supported yet", async () => {
    const graph = await loadBuildGraph(await fixture({
      "skillset.yaml": `
skillset:
  name: adaptive-hook-unsupported-render-fields
claude: true
codex: false
`,
      ".skillset/plugins/demo/skillset.yaml": `
skillset:
  name: demo
hooks:
  Stop:
    - shell-policy
`,
      ".skillset/plugins/demo/hooks/shell-policy.json": JSON.stringify({
        claude: { status: "Checking" },
        events: ["Stop"],
        run: { command: "echo ok" },
      }),
    }));

    const rendered = await renderBuildGraph(graph);
    expect(rendered.map((file) => file.path)).not.toContain("plugins/demo/claude/hooks/hooks.json");
  });

  test("renders plugin-level adaptive hooks to native Claude and Codex hook files", async () => {
    const graph = await loadBuildGraph(await fixture({
      "skillset.yaml": `
skillset:
  name: adaptive-hook-render
claude: true
codex: true
`,
      ".skillset/plugins/demo/skillset.yaml": `
skillset:
  name: demo
hooks:
  PreToolUse:
    - hook: shell-policy
      match: Bash
      status: Checking shell command
      providers: [claude, codex]
`,
      ".skillset/plugins/demo/hooks/shell-policy.json": JSON.stringify({
        events: ["PreToolUse"],
        run: {
          env: {
            CHECK: "1",
            MESSAGE: "two words",
          },
          script: "{{scripts.dir}}/check.sh",
        },
      }),
      ".skillset/plugins/demo/scripts/check.sh": "#!/bin/sh\nexit 0\n",
    }));

    const rendered = await renderBuildGraph(graph);
    const claudeHooks = renderedJson(rendered, "plugins/demo/claude/hooks/hooks.json");
    const codexHooks = renderedJson(rendered, "plugins/demo/codex/hooks/hooks.json");
    const claudeManifest = renderedJson(rendered, "plugins/demo/claude/.claude-plugin/plugin.json");
    const codexManifest = renderedJson(rendered, "plugins/demo/codex/.codex-plugin/plugin.json");

    expect(claudeManifest.hooks).toBe("./hooks/hooks.json");
    expect(codexManifest.hooks).toBe("./hooks/hooks.json");
    expect(claudeHooks).toEqual({
      hooks: {
        PreToolUse: [{
          hooks: [{ command: "env CHECK=1 MESSAGE='two words' sh -c '$CLAUDE_PLUGIN_ROOT/scripts/check.sh'", type: "command" }],
          matcher: "Bash",
          statusMessage: "Checking shell command",
        }],
      },
    });
    expect(codexHooks).toEqual({
      hooks: {
        PreToolUse: [{
          hooks: [{ command: "env CHECK=1 MESSAGE='two words' sh -c '$PLUGIN_ROOT/scripts/check.sh'", type: "command" }],
          matcher: "Bash",
          statusMessage: "Checking shell command",
        }],
      },
    });
    expect(rendered.map((file) => file.path)).toEqual(expect.arrayContaining([
      "plugins/demo/claude/scripts/check.sh",
      "plugins/demo/codex/scripts/check.sh",
    ]));
  });

  test("rejects plugin adaptive hook run.env keys that cannot render as shell assignments", async () => {
    const graph = await loadBuildGraph(await fixture({
      "skillset.yaml": `
skillset:
  name: adaptive-hook-env-key
claude: true
codex: false
`,
      ".skillset/plugins/demo/skillset.yaml": `
skillset:
  name: demo
hooks:
  Stop:
    - shell-policy
`,
      ".skillset/plugins/demo/hooks/shell-policy.json": JSON.stringify({
        events: ["Stop"],
        run: { command: "echo ok", env: { "BAD-NAME": "1" } },
      }),
    }));

    await expect(renderBuildGraph(graph)).rejects.toThrow("run.env key BAD-NAME is not a valid shell environment variable name");
  });

  test("renders plugin hook run.env around the whole shell command", async () => {
    const graph = await loadBuildGraph(await fixture({
      "skillset.yaml": `
skillset:
  name: adaptive-hook-env-command
claude: true
codex: false
`,
      ".skillset/plugins/demo/skillset.yaml": `
skillset:
  name: demo
hooks:
  Stop:
    - shell-policy
`,
      ".skillset/plugins/demo/hooks/shell-policy.json": JSON.stringify({
        events: ["Stop"],
        run: {
          command: "echo \"$CHECK\" && ./check.sh",
          env: { CHECK: "1" },
        },
      }),
    }));

    const rendered = await renderBuildGraph(graph);
    const claudeHooks = renderedJson(rendered, "plugins/demo/claude/hooks/hooks.json");
    expect(claudeHooks).toEqual({
      hooks: {
        Stop: [{
          hooks: [{ command: "env CHECK=1 sh -c 'echo \"$CHECK\" && ./check.sh'", type: "command" }],
        }],
      },
    });
  });

  test("renders inline hook context for plugin-level adaptive hooks", async () => {
    const graph = await loadBuildGraph(await fixture({
      "skillset.yaml": `
skillset:
  name: adaptive-hook-context-render
claude: true
codex: true
`,
      ".skillset/plugins/demo/skillset.yaml": `
skillset:
  name: demo
hooks:
  Stop:
    - session-summary
`,
      ".skillset/plugins/demo/hooks/session-summary.json": JSON.stringify({
        context: {
          env: ["provider", "hook.event", "session.id"],
          strategy: "inline",
        },
        events: ["Stop"],
        run: { command: "node ./session-summary.js" },
      }),
    }));

    const rendered = await renderBuildGraph(graph);
    const claudeHooks = renderedJson(rendered, "plugins/demo/claude/hooks/hooks.json");
    const codexHooks = renderedJson(rendered, "plugins/demo/codex/hooks/hooks.json");

    expect(claudeHooks).toEqual({
      hooks: {
        Stop: [{
          hooks: [{
            command: 'SKILLSET_PROVIDER=claude SKILLSET_HOOK_EVENT=Stop SKILLSET_SESSION_ID="${CLAUDE_SESSION_ID:-}" node ./session-summary.js',
            type: "command",
          }],
        }],
      },
    });
    expect(codexHooks).toEqual({
      hooks: {
        Stop: [{
          hooks: [{
            command: 'SKILLSET_PROVIDER=codex SKILLSET_HOOK_EVENT=Stop SKILLSET_SESSION_ID="${CODEX_SESSION_ID:-}" node ./session-summary.js',
            type: "command",
          }],
        }],
      },
    });
  });

  test("renders toolkit hook context for plugin-level adaptive hooks", async () => {
    const graph = await loadBuildGraph(await fixture({
      "skillset.yaml": `
skillset:
  name: adaptive-hook-toolkit-context-render
claude: true
codex: true
`,
      ".skillset/plugins/demo/skillset.yaml": `
skillset:
  name: demo
hooks:
  Stop:
    - session-summary
`,
      ".skillset/plugins/demo/hooks/session-summary.json": JSON.stringify({
        context: {
          env: ["provider", "hook.event", "session.id"],
          strategy: "toolkit",
        },
        events: ["Stop"],
        run: { command: "cat" },
      }),
    }));

    const rendered = await renderBuildGraph(graph);
    const claudeHooks = renderedJson(rendered, "plugins/demo/claude/hooks/hooks.json");
    const codexHooks = renderedJson(rendered, "plugins/demo/codex/hooks/hooks.json");

    expect(claudeHooks).toEqual({
      hooks: {
        Stop: [{
          hooks: [{
            command: 'eval "$(SKILLSET_PROVIDER=claude SKILLSET_HOOK_EVENT=Stop skillset-toolkit runtime context --event Stop --format env --fields \'provider,hook.event,session.id\')" && cat',
            type: "command",
          }],
        }],
      },
    });
    expect(codexHooks).toEqual({
      hooks: {
        Stop: [{
          hooks: [{
            command: 'eval "$(SKILLSET_PROVIDER=codex SKILLSET_HOOK_EVENT=Stop skillset-toolkit runtime context --event Stop --format env --fields \'provider,hook.event,session.id\')" && cat',
            type: "command",
          }],
        }],
      },
    });

    const command = ((claudeHooks.hooks as JsonRecord).Stop as readonly JsonRecord[])[0]?.hooks as readonly JsonRecord[];
    expect(await runGeneratedHookCommand(String(command[0]?.command))).toEqual({
      exitCode: 0,
      stderr: "",
      stdout: "payload",
    });
  });

  test("renders Claude skill and project-agent adaptive hooks into frontmatter", async () => {
    const graph = await loadBuildGraph(await fixture({
      "skillset.yaml": `
skillset:
  name: adaptive-hook-frontmatter-render
claude: true
codex: false
`,
      ".skillset/skills/writer/SKILL.md": `
---
name: writer
description: Demo writer.
hooks:
  PreToolUse:
    - hook: local-shell
      match: Bash
      status: Checking skill shell
---

Body.
`,
      ".skillset/skills/writer/hooks/local-shell.json": JSON.stringify({
        events: ["PreToolUse"],
        run: { command: "echo skill" },
      }),
      ".skillset/agents/helper.md": `
---
description: Demo helper.
hooks:
  Stop:
    - hook: local-stop
      status: Checking agent stop
---

Body.
`,
      ".skillset/agents/helper/hooks/local-stop.json": JSON.stringify({
        events: ["Stop"],
        run: { command: "echo agent" },
      }),
    }));

    const rendered = await renderBuildGraph(graph);
    const skillFrontmatter = renderedMarkdown(rendered, ".claude/skills/writer/SKILL.md").frontmatter;
    const agentFrontmatter = renderedMarkdown(rendered, ".claude/agents/helper.md").frontmatter;

    expect(skillFrontmatter.hooks).toEqual({
      PreToolUse: [{
        hooks: [{ command: "echo skill", type: "command" }],
        matcher: "Bash",
        statusMessage: "Checking skill shell",
      }],
    });
    expect(agentFrontmatter.hooks).toEqual({
      Stop: [{
        hooks: [{ command: "echo agent", type: "command" }],
        statusMessage: "Checking agent stop",
      }],
    });
  });

  test("renders inline hook context for Claude frontmatter adaptive hooks", async () => {
    const graph = await loadBuildGraph(await fixture({
      "skillset.yaml": `
skillset:
  name: adaptive-hook-frontmatter-context
claude: true
codex: false
`,
      ".skillset/skills/writer/SKILL.md": `
---
name: writer
description: Demo writer.
hooks:
  Stop:
    - local-stop
---

Body.
`,
      ".skillset/skills/writer/hooks/local-stop.json": JSON.stringify({
        context: {
          env: ["provider", "hook.event"],
          strategy: "inline",
        },
        events: ["Stop"],
        run: { command: "echo skill" },
      }),
    }));

    const rendered = await renderBuildGraph(graph);
    const skillFrontmatter = renderedMarkdown(rendered, ".claude/skills/writer/SKILL.md").frontmatter;

    expect(skillFrontmatter.hooks).toEqual({
      Stop: [{
        hooks: [{
          command: "SKILLSET_PROVIDER=claude SKILLSET_HOOK_EVENT=Stop echo skill",
          type: "command",
        }],
      }],
    });
  });

  test("renders toolkit hook context for Claude frontmatter adaptive hooks", async () => {
    const graph = await loadBuildGraph(await fixture({
      "skillset.yaml": `
skillset:
  name: adaptive-hook-frontmatter-toolkit-context
claude: true
codex: false
`,
      ".skillset/skills/writer/SKILL.md": `
---
name: writer
description: Demo writer.
hooks:
  Stop:
    - local-stop
---

Body.
`,
      ".skillset/skills/writer/hooks/local-stop.json": JSON.stringify({
        context: {
          env: ["provider", "hook.event"],
          strategy: "toolkit",
        },
        events: ["Stop"],
        run: { command: "echo skill" },
      }),
    }));

    const rendered = await renderBuildGraph(graph);
    const skillFrontmatter = renderedMarkdown(rendered, ".claude/skills/writer/SKILL.md").frontmatter;

    expect(skillFrontmatter.hooks).toEqual({
      Stop: [{
        hooks: [{
          command: 'eval "$(SKILLSET_PROVIDER=claude SKILLSET_HOOK_EVENT=Stop skillset-toolkit runtime context --event Stop --format env --fields \'provider,hook.event\')" && echo skill',
          type: "command",
        }],
      }],
    });
  });

  test("omits frontmatter adaptive hook scripts without stable path proof", async () => {
    const graph = await loadBuildGraph(await fixture({
      "skillset.yaml": `
skillset:
  name: adaptive-hook-frontmatter-script
claude: true
codex: false
`,
      ".skillset/skills/writer/SKILL.md": `
---
name: writer
description: Demo writer.
hooks:
  Stop:
    - local-stop
---

Body.
`,
      ".skillset/skills/writer/hooks/local-stop/hook.json": JSON.stringify({
        events: ["Stop"],
        run: { script: "./stop.sh" },
      }),
      ".skillset/skills/writer/hooks/local-stop/stop.sh": "#!/bin/sh\nexit 0\n",
    }));

    const rendered = await renderBuildGraph(graph);
    const skillFrontmatter = renderedMarkdown(rendered, ".claude/skills/writer/SKILL.md").frontmatter;
    expect(skillFrontmatter.hooks).toBeUndefined();
  });

  test("rejects adaptive plugin hook output colliding with native hooks aggregate", async () => {
    await expect(loadBuildGraph(await fixture({
      "skillset.yaml": `
skillset:
  name: adaptive-hook-collision
claude: true
codex: false
`,
      ".skillset/plugins/demo/skillset.yaml": `
skillset:
  name: demo
hooks:
  Stop:
    - shell-policy
`,
      ".skillset/plugins/demo/hooks/hooks.json": JSON.stringify({ hooks: { Stop: [] } }),
      ".skillset/plugins/demo/hooks/shell-policy.json": JSON.stringify({ events: ["Stop"], run: { command: "echo ok" } }),
    }))).rejects.toThrow("native aggregate source and cannot be combined with adaptive hook units");
  });
});

function hook(
  name: string,
  events: readonly string[],
  scope: SourceAdaptiveHook["scope"],
  sourcePath: string
): SourceAdaptiveHook {
  return {
    events,
    frontmatter: { events: [...events], run: { command: "node ./hook.js" } },
    name,
    scriptReferences: [],
    scope,
    sourcePath,
  };
}

async function fixture(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "skillset-adaptive-hooks-"));
  for (const [path, content] of Object.entries(normalizeSkillsetFixtureFiles(files))) {
    await Bun.write(join(root, path), `${content.trim()}\n`);
  }
  return root;
}

function renderedJson(files: readonly { readonly content: Uint8Array; readonly path: string }[], path: string): JsonRecord {
  const file = files.find((candidate) => candidate.path === path);
  expect(file).toBeDefined();
  return JSON.parse(new TextDecoder().decode(file?.content)) as JsonRecord;
}

function renderedMarkdown(files: readonly { readonly content: Uint8Array; readonly path: string }[], path: string) {
  const file = files.find((candidate) => candidate.path === path);
  expect(file).toBeDefined();
  return parseMarkdown(new TextDecoder().decode(file?.content), path);
}

async function runGeneratedHookCommand(command: string): Promise<{
  readonly exitCode: number;
  readonly stderr: string;
  readonly stdout: string;
}> {
  const root = await mkdtemp(join(tmpdir(), "skillset-generated-hook-"));
  const binDir = join(root, "bin");
  await mkdir(binDir);
  const shim = join(binDir, "skillset-toolkit");
  await Bun.write(
    shim,
    `#!/bin/sh\nexec ${shellQuote(process.execPath)} ${shellQuote(join(process.cwd(), "packages/toolkit/src/cli.ts"))} "$@"\n`
  );
  await chmod(shim, 0o755);
  const proc = Bun.spawn({
    cmd: ["/bin/sh", "-c", `printf payload | (${command})`],
    cwd: root,
    env: {
      HOME: process.env.HOME ?? "",
      PATH: `${binDir}:${process.env.PATH ?? ""}`,
      TMPDIR: process.env.TMPDIR ?? "/tmp",
    },
    stderr: "pipe",
    stdout: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { exitCode, stderr, stdout };
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\"'\"'")}'`;
}
