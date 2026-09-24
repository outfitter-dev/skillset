import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createTestFixtureRoot } from "../../../../scripts/test-helpers/fixture-root";

import { describe, expect, test } from "bun:test";
import { getProviderHookEvidence, getProviderRuntimeHookDestination } from "@skillset/registry";
import { createTestGitFixtureRoot } from "../../../../scripts/test-helpers/git-remote";

import {
  renderProjectSessionStartHooks,
  projectSessionStartEntry,
  projectSessionStartPath,
  SESSION_START_COMMAND,
} from "../render-project-hooks";

function graph(rootPath: string, mode: "auto" | "on" | "off") {
  return {
    rootPath,
    rootConfigPath: join(rootPath, "skillset.yaml"),
    root: {
      compile: { sessionStartHook: mode },
      outputs: {
        skills: {
          claude: ".claude/skills",
          codex: ".agents/skills",
          cursor: ".cursor/skills",
        },
      },
      targets: {
        claude: { enabled: true, options: {} },
        codex: { enabled: true, options: {} },
        cursor: { enabled: false, options: {} },
      },
    },
  } as never;
}

describe("project SessionStart hook rendering", () => {
  test("takes Codex destination and context limit from checked-in provider evidence", () => {
    const destination = getProviderRuntimeHookDestination("codex");
    expect(destination.status).toBe("verified");
    if (destination.status !== "verified") return;
    expect(projectSessionStartPath("codex")).toBe(destination.path.replace("<project>/", ""));
    const configuredLimit = getProviderHookEvidence("codex").outputLimits.find((limit) => limit.kind === "configured-example" && limit.field === "additionalContext");
    expect(configuredLimit).toBeDefined();
    const entry = projectSessionStartEntry("codex");
    const handler = (entry.hooks as Array<Record<string, unknown>>)[0];
    expect(handler?.additionalContextLimit).toBe(configuredLimit?.value);
  });
  test("auto follows every enabled skill root, not the hook files", async () => {
    const root = await createTestFixtureRoot("skillset-project-hooks-auto-");
    await writeFile(join(root, "skillset.yaml"), "{}\n");
    execFileSync("git", ["init", "-q", root]);
    await writeFile(
      join(root, ".gitignore"),
      ".claude/settings.json\n.codex/hooks.json\n"
    );
    expect(await renderProjectSessionStartHooks(graph(root, "auto"))).toEqual([]);

    await writeFile(
      join(root, ".gitignore"),
      ".claude/skills/\n.agents/skills/\n.cursor/skills/\n"
    );
    expect(await renderProjectSessionStartHooks(graph(root, "auto"))).toHaveLength(2);

    const withCursor = graph(root, "auto") as {
      root: { targets: Record<string, { enabled: boolean; options: object }> };
    };
    withCursor.root.targets.cursor = { enabled: true, options: {} };
    await writeFile(join(root, ".gitignore"), ".claude/skills/\n.agents/skills/\n.claude/settings.json\n.codex/hooks.json\n");
    expect(await renderProjectSessionStartHooks(withCursor as never)).toEqual([]);
  });

  test("preserves foreign entries while composing Claude and Codex shapes", async () => {
    const root = await createTestFixtureRoot("skillset-project-hooks-");
    await writeFile(join(root, "skillset.yaml"), "{}\n");
    await mkdir(join(root, ".claude"), { recursive: true });
    await mkdir(join(root, ".codex"), { recursive: true });
    await writeFile(join(root, ".claude/settings.json"), JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: "command", command: "foreign" }] }], PostToolUse: [{ hooks: [{ type: "command", command: "keep" }] }] } }, null, 2));
    await writeFile(join(root, ".codex/hooks.json"), JSON.stringify({ hooks: { PostToolUse: [{ hooks: [{ type: "command", command: "keep" }] }] } }, null, 2));
    const rendered = await renderProjectSessionStartHooks(graph(root, "on"));
    expect(rendered).toHaveLength(2);
    const claude = rendered.find((item) => item.target === "claude");
    const codex = rendered.find((item) => item.target === "codex");
    expect(claude?.ownership.keyPath).toBe("hooks.SessionStart[*].hooks[*].command");
    expect(claude?.file.partialOwnership).toBe("settings-entry");
    expect(claude?.file.path).toBe(".claude/settings.json");
    expect(codex?.file.path).toBe(".codex/hooks.json");
    const claudeSettings = JSON.parse(new TextDecoder().decode(claude?.file.content));
    const codexSettings = JSON.parse(new TextDecoder().decode(codex?.file.content));
    expect(claudeSettings.hooks.SessionStart.at(-1)).toEqual(projectSessionStartEntry("claude"));
    expect(codexSettings.hooks.SessionStart.at(-1)).toEqual(projectSessionStartEntry("codex"));
    expect(new TextDecoder().decode(claude?.file.content)).toContain("foreign");
    expect(new TextDecoder().decode(claude?.file.content)).toContain(SESSION_START_COMMAND);
    expect(new TextDecoder().decode(codex?.file.content)).toContain(SESSION_START_COMMAND);
  });

  test("deduplicates an exact owned entry and rejects divergent ownership", async () => {
    const root = await createTestFixtureRoot("skillset-project-hooks-integrity-");
    await writeFile(join(root, "skillset.yaml"), "{}\n");
    await mkdir(join(root, ".claude"), { recursive: true });
    await writeFile(
      join(root, ".claude/settings.json"),
      JSON.stringify({
        hooks: {
          SessionStart: [
            projectSessionStartEntry("claude"),
            projectSessionStartEntry("claude"),
          ],
        },
      })
    );
    const rendered = await renderProjectSessionStartHooks(graph(root, "on"));
    const content = new TextDecoder().decode(rendered.find((item) => item.target === "claude")?.file.content);
    expect([...content.matchAll(new RegExp(SESSION_START_COMMAND, "g"))]).toHaveLength(1);

    await writeFile(
      join(root, ".claude/settings.json"),
      JSON.stringify({
        hooks: {
          SessionStart: [{ ...projectSessionStartEntry("claude"), hooks: [{ type: "command", command: SESSION_START_COMMAND, timeout: 10 }] }],
        },
      })
    );
    await expect(renderProjectSessionStartHooks(graph(root, "on"))).rejects.toThrow(
      "contains a divergent SessionStart command entry"
    );
  });

  test("off removes only the owned command and keeps foreign settings", async () => {
    const root = await createTestFixtureRoot("skillset-project-hooks-off-");
    await writeFile(join(root, "skillset.yaml"), "{}\n");
    await mkdir(join(root, ".claude"), { recursive: true });
    await writeFile(join(root, ".claude/settings.json"), JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: "command", command: "foreign" }] }, projectSessionStartEntry("claude")], PostToolUse: [{ hooks: [{ type: "command", command: "keep" }] }] } }, null, 2));
    const input = graph(root, "off") as { root: { targets: Record<string, unknown> } };
    input.root.targets.codex = { enabled: false, options: {} };
    const rendered = await renderProjectSessionStartHooks(input as never);
    expect(rendered).toHaveLength(1);
    const content = new TextDecoder().decode(rendered[0]!.file.content);
    expect(content).toContain("foreign");
    expect(content).toContain("keep");
    expect(content).not.toContain(SESSION_START_COMMAND);
    expect(rendered[0]!.managed).toBe(false);
  });

  test("rejects defined foreign hooks shapes before composing either provider", async () => {
    const cases = [
      [".claude/settings.json", { hooks: { SessionStart: { foreign: "keep" } } }, "hooks.SessionStart"],
      [".codex/hooks.json", { hooks: [{ foreign: "keep-hooks-array" }] }, "hooks"],
    ] as const;
    for (const [relativePath, value, label] of cases) {
      const root = await createTestFixtureRoot("skillset-project-hooks-shape-");
      await writeFile(join(root, "skillset.yaml"), "{}\n");
      await mkdir(join(root, relativePath.split("/")[0]!), { recursive: true });
      await writeFile(join(root, relativePath), JSON.stringify(value, null, 2));
      await expect(renderProjectSessionStartHooks(graph(root, "on"))).rejects.toThrow(
        `${relativePath} has an unsupported ${label} shape`
      );
      expect(JSON.parse(await Bun.file(join(root, relativePath)).text())).toEqual(value);
    }
  });

  test("rejects duplicate settings keys before editing the owned JSON span", async () => {
    const root = await createTestFixtureRoot("skillset-project-hooks-duplicate-");
    await writeFile(join(root, "skillset.yaml"), "{}\n");
    await mkdir(join(root, ".claude"), { recursive: true });
    const settings = '{"hooks":{"SessionStart":[]},"hooks":{"PostToolUse":[]}}';
    await writeFile(join(root, ".claude/settings.json"), settings);
    const input = graph(root, "on") as { root: { targets: Record<string, unknown> } };
    input.root.targets.codex = { enabled: false, options: {} };
    await expect(renderProjectSessionStartHooks(input as never)).rejects.toThrow('duplicate settings object key "hooks"');
    expect(await readFile(join(root, ".claude/settings.json"), "utf8")).toBe(settings);
  });

  test("withholds previous ownership from untrusted provenance without hiding the lock", async () => {
    const root = await createTestGitFixtureRoot("skillset-project-hooks-provenance-");
    await writeFile(join(root, "skillset.yaml"), "{}\n");
    await writeFile(
      join(root, "skillset.lock"),
      JSON.stringify({
        generatedBy: "skillset@0.1.0",
        items: [],
        outputRoot: ".",
        provenanceHash: `sha256:${"a".repeat(64)}`,
        schemaVersion: 4,
        standardProfileEvidence: {},
        selectedStandards: [],
        selectedTargets: [],
        target: "workspace",
      }),
      "utf8"
    );

    await expect(renderProjectSessionStartHooks(graph(root, "on"))).resolves.toHaveLength(2);
  });

  test("fails closed on a corrupt workspace lock during ownership checks", async () => {
    const root = await createTestGitFixtureRoot("skillset-project-hooks-lock-");
    await writeFile(join(root, "skillset.yaml"), "{}\n");
    await writeFile(join(root, "skillset.lock"), "{ not valid json", "utf8");

    await expect(renderProjectSessionStartHooks(graph(root, "on"))).rejects.toThrow(
      "workspace lock skillset.lock cannot guard generated state because it is not valid JSON"
    );
    await expect(renderProjectSessionStartHooks(graph(root, "on"))).rejects.toThrow(
      "Restore it from a clean build (skillset build) or remove it deliberately before rebuilding."
    );
    expect(await readFile(join(root, "skillset.lock"), "utf8")).toBe("{ not valid json");
  });

  test("blocks a former local Claude SessionStart entry before composing the committed destination", async () => {
    const root = await createTestFixtureRoot("skillset-project-hooks-legacy-");
    await writeFile(join(root, "skillset.yaml"), "{}\n");
    await mkdir(join(root, ".claude"), { recursive: true });
    const legacy = JSON.stringify({ hooks: { SessionStart: [projectSessionStartEntry("claude")] }, foreign: "keep" });
    await writeFile(join(root, ".claude/settings.local.json"), legacy);
    const input = graph(root, "on") as { root: { targets: Record<string, unknown> } };
    input.root.targets.codex = { enabled: false, options: {} };
    await expect(renderProjectSessionStartHooks(input as never)).rejects.toThrow("still contains the former SessionStart command");
    expect(await readFile(join(root, ".claude/settings.local.json"), "utf8")).toBe(legacy);
  });
});
