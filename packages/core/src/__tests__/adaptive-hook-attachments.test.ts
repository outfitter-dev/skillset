import { describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
