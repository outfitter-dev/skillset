import { describe, expect, it } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { diffSkillset } from "@skillset/core";

const DEMO_FIXTURE: Record<string, string> = {
  ".skillset/config.yaml": `
skillset:
  name: core-diff-root
claude: true
codex: false
`,
  ".skillset/skills/demo/SKILL.md": `
---
name: demo
description: Demo skill.
model: claude-sonnet
---

Body.
`,
};

describe("diffSkillset", () => {
  it("returns structured drift without writing output or printing", async () => {
    const root = await fixture(DEMO_FIXTURE);
    const previousExitCode = process.exitCode;
    const calls: string[] = [];
    const originalLog = console.log;
    const originalWarn = console.warn;

    process.exitCode = undefined;
    console.log = (...args: unknown[]) => {
      calls.push(`log:${args.join(" ")}`);
    };
    console.warn = (...args: unknown[]) => {
      calls.push(`warn:${args.join(" ")}`);
    };

    try {
      const diff = await diffSkillset(root);

      expect(diff.added).toContain(".claude/skills/demo/SKILL.md");
      expect(diff.changed).toEqual([]);
      expect(diff.missing).toEqual([]);
      expect(diff.removed).toEqual([]);
      expect(await Bun.file(join(root, ".claude/skills/demo/SKILL.md")).exists()).toBe(false);
      expect(calls).toEqual([]);
      expect(process.exitCode).toBeUndefined();
    } finally {
      console.log = originalLog;
      console.warn = originalWarn;
      process.exitCode = previousExitCode;
    }
  });
});

async function fixture(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "skillset-core-diff-"));
  for (const [path, content] of Object.entries(files)) {
    await Bun.write(join(root, path), `${content.trim()}\n`);
  }
  return root;
}
