import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, test } from "bun:test";

import {
  renderProjectSessionStartHooks,
  SESSION_START_COMMAND,
} from "../render-project-hooks";

function graph(rootPath: string, mode: "on" | "off") {
  return {
    rootPath,
    rootConfigPath: join(rootPath, "skillset.yaml"),
    root: {
      compile: { sessionStartHook: mode },
      targets: {
        claude: { enabled: true, options: {} },
        codex: { enabled: true, options: {} },
        cursor: { enabled: false, options: {} },
      },
    },
  } as never;
}

describe("project SessionStart hook rendering", () => {
  test("preserves foreign entries while composing Claude and Codex shapes", async () => {
    const root = await mkdtemp(join(tmpdir(), "skillset-project-hooks-"));
    try {
      await writeFile(join(root, "skillset.yaml"), "{}\n");
      await mkdir(join(root, ".claude"), { recursive: true });
      await mkdir(join(root, ".codex"), { recursive: true });
      await writeFile(join(root, ".claude/settings.local.json"), JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: "command", command: "foreign" }] }], PostToolUse: [{ hooks: [{ type: "command", command: "keep" }] }] } }, null, 2));
      await writeFile(join(root, ".codex/hooks.json"), JSON.stringify({ hooks: { PostToolUse: [{ hooks: [{ type: "command", command: "keep" }] }] } }, null, 2));
      const rendered = await renderProjectSessionStartHooks(graph(root, "on"));
      expect(rendered).toHaveLength(2);
      const claude = rendered.find((item) => item.target === "claude");
      const codex = rendered.find((item) => item.target === "codex");
      expect(claude?.ownership.keyPath).toBe("hooks.SessionStart[*].hooks[*].command");
      expect(claude?.file.partialOwnership).toBe("settings-entry");
      expect(new TextDecoder().decode(claude?.file.content)).toContain("foreign");
      expect(new TextDecoder().decode(claude?.file.content)).toContain(SESSION_START_COMMAND);
      expect(new TextDecoder().decode(codex?.file.content)).toContain(SESSION_START_COMMAND);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("deduplicates an exact owned entry and rejects divergent ownership", async () => {
    const root = await mkdtemp(join(tmpdir(), "skillset-project-hooks-integrity-"));
    try {
      await writeFile(join(root, "skillset.yaml"), "{}\n");
      await mkdir(join(root, ".claude"), { recursive: true });
      await writeFile(
        join(root, ".claude/settings.local.json"),
        JSON.stringify({
          hooks: {
            SessionStart: [
              { hooks: [{ type: "command", command: SESSION_START_COMMAND }] },
              { hooks: [{ type: "command", command: SESSION_START_COMMAND }] },
            ],
          },
        })
      );
      const rendered = await renderProjectSessionStartHooks(graph(root, "on"));
      const content = new TextDecoder().decode(rendered.find((item) => item.target === "claude")?.file.content);
      expect([...content.matchAll(new RegExp(SESSION_START_COMMAND, "g"))]).toHaveLength(1);

      await writeFile(
        join(root, ".claude/settings.local.json"),
        JSON.stringify({
          hooks: {
            SessionStart: [{ hooks: [{ type: "command", command: SESSION_START_COMMAND, timeout: 10 }] }],
          },
        })
      );
      await expect(renderProjectSessionStartHooks(graph(root, "on"))).rejects.toThrow(
        "contains a divergent SessionStart command entry"
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("off removes only the owned command and keeps foreign settings", async () => {
    const root = await mkdtemp(join(tmpdir(), "skillset-project-hooks-off-"));
    try {
      await writeFile(join(root, "skillset.yaml"), "{}\n");
      await mkdir(join(root, ".claude"), { recursive: true });
      await writeFile(join(root, ".claude/settings.local.json"), JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: "command", command: "foreign" }] }, { hooks: [{ type: "command", command: SESSION_START_COMMAND }] }], PostToolUse: [{ hooks: [{ type: "command", command: "keep" }] }] } }, null, 2));
      const input = graph(root, "off") as { root: { targets: Record<string, unknown> } };
      input.root.targets.codex = { enabled: false, options: {} };
      const rendered = await renderProjectSessionStartHooks(input as never);
      expect(rendered).toHaveLength(1);
      const content = new TextDecoder().decode(rendered[0]!.file.content);
      expect(content).toContain("foreign");
      expect(content).toContain("keep");
      expect(content).not.toContain(SESSION_START_COMMAND);
      expect(rendered[0]!.managed).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("rejects defined foreign hooks shapes before composing either provider", async () => {
    const cases = [
      [".claude/settings.local.json", { hooks: { SessionStart: { foreign: "keep" } } }, "hooks.SessionStart"],
      [".codex/hooks.json", { hooks: [{ foreign: "keep-hooks-array" }] }, "hooks"],
    ] as const;
    for (const [relativePath, value, label] of cases) {
      const root = await mkdtemp(join(tmpdir(), "skillset-project-hooks-shape-"));
      try {
        await writeFile(join(root, "skillset.yaml"), "{}\n");
        await mkdir(join(root, relativePath.split("/")[0]!), { recursive: true });
        await writeFile(join(root, relativePath), JSON.stringify(value, null, 2));
        await expect(renderProjectSessionStartHooks(graph(root, "on"))).rejects.toThrow(
          `${relativePath} has an unsupported ${label} shape`
        );
        expect(JSON.parse(await Bun.file(join(root, relativePath)).text())).toEqual(value);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    }
  });
});
