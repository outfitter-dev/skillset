import { describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { normalizeSkillsetFixtureFiles } from "../../../../scripts/test-helpers/skillset-config";

import {
  resolveAdaptiveHookAttachments,
  type SourceAdaptiveHook,
  type SourceHookAttachment,
} from "@skillset/core";
import { loadBuildGraph } from "../resolver";

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
  test("loads root, plugin, and skill-local definitions plus frontmatter attachments", async () => {
    const graph = await loadBuildGraph(await fixture({
      ".skillset/config.yaml": `
skillset:
  name: adaptive-hook-graph
claude: true
codex: false
`,
      ".skillset/src/hooks/session.json": JSON.stringify({ events: ["SessionStart"], run: { command: "node ./session.js" } }),
      ".skillset/src/plugins/demo/skillset.yaml": `
skillset:
  name: demo
`,
      ".skillset/src/plugins/demo/hooks/shell.json": JSON.stringify({ events: ["Stop"], run: { command: "node ./shell.js" } }),
      ".skillset/src/plugins/demo/skills/writer/SKILL.md": `
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
      ".skillset/src/plugins/demo/skills/writer/hooks/local-shell.json": JSON.stringify({ events: ["PreToolUse"], run: { command: "node ./local.js" } }),
    }));

    expect(graph.adaptiveHooks.map((hook) => hook.name)).toEqual(["session", "shell", "local-shell"]);
    expect(graph.hookAttachments.map((attachment) => `${attachment.event ?? "auto"}:${attachment.hook}`)).toEqual([
      "PreToolUse:local-shell",
      "Stop:shell",
      "auto:session",
    ]);
  });

  test("loads project-agent local hook definitions from a sibling hook directory", async () => {
    const graph = await loadBuildGraph(await fixture({
      ".skillset/config.yaml": `
skillset:
  name: adaptive-agent-hooks
claude: true
codex: false
`,
      ".skillset/src/agents/helper.md": `
---
description: Demo helper.
hooks:
  SessionStart:
    - helper-session
---

Body.
`,
      ".skillset/src/agents/helper/hooks/helper-session.json": JSON.stringify({ events: ["SessionStart"], run: { command: "node ./session.js" } }),
    }));

    expect(graph.adaptiveHooks.map((hook) => `${hook.scope.kind}:${hook.name}`)).toEqual(["agent:helper-session"]);
    expect(graph.hookAttachments.map((attachment) => `${attachment.scope.kind}:${attachment.event}:${attachment.hook}`)).toEqual(["agent:SessionStart:helper-session"]);
  });

  test("rejects unresolved hook attachments while loading the graph", async () => {
    const root = await fixture({
      ".skillset/config.yaml": `
skillset:
  name: adaptive-hook-missing
claude: true
codex: false
`,
      ".skillset/src/skills/demo/SKILL.md": `
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
      ".skillset/config.yaml": `
skillset:
  name: adaptive-hook-scripts
claude: true
codex: false
`,
      ".skillset/src/hooks/session.json": JSON.stringify({ events: ["SessionStart"], run: { script: "{{scripts.dir}}/session.js" } }),
      ".skillset/src/scripts/session.js": "process.exit(0);\n",
      ".skillset/src/plugins/demo/skillset.yaml": `
skillset:
  name: demo
`,
      ".skillset/src/plugins/demo/hooks/shell/hook.json": JSON.stringify({ events: ["PreToolUse"], run: { script: "./check.js" } }),
      ".skillset/src/plugins/demo/hooks/shell/check.js": "process.exit(0);\n",
    });
    const graph = await loadBuildGraph(root);

    expect(graph.adaptiveHooks.flatMap((hook) =>
      hook.scriptReferences.map((reference) => `${hook.name}:${reference.kind}:${reference.runtimePath}:${relative(root, reference.sourcePath)}`)
    )).toEqual([
      "session:scripts-dir:{{scripts.dir}}/session.js:.skillset/src/scripts/session.js",
      "shell:hook-local:./check.js:.skillset/src/plugins/demo/hooks/shell/check.js",
    ]);
  });

  test("rejects missing hook script references", async () => {
    const root = await fixture({
      ".skillset/config.yaml": `
skillset:
  name: adaptive-hook-missing-script
claude: true
codex: false
`,
      ".skillset/src/plugins/demo/skillset.yaml": `
skillset:
  name: demo
`,
      ".skillset/src/plugins/demo/hooks/shell/hook.json": JSON.stringify({ events: ["PreToolUse"], run: { script: "./missing.js" } }),
    });

    await expect(loadBuildGraph(root)).rejects.toThrow("adaptive hook run.script ./missing.js does not resolve to an existing source file");
  });

  test("rejects hook-local script references from flat hook units", async () => {
    const root = await fixture({
      ".skillset/config.yaml": `
skillset:
  name: adaptive-hook-flat-script
claude: true
codex: false
`,
      ".skillset/src/plugins/demo/skillset.yaml": `
skillset:
  name: demo
`,
      ".skillset/src/plugins/demo/hooks/shell.json": JSON.stringify({ events: ["PreToolUse"], run: { script: "./check.js" } }),
      ".skillset/src/plugins/demo/hooks/check.js": "process.exit(0);\n",
    });

    await expect(loadBuildGraph(root)).rejects.toThrow("hook-local scripts require a directory hook unit");
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
