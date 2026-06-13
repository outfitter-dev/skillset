import { describe, expect, it } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  buildSkillsetResult,
  checkSkillsetResult,
  diffSkillsetResult,
} from "@skillset/core";

const DEMO_FIXTURE: Record<string, string> = {
  ".skillset/config.yaml": `
skillset:
  name: core-consumer-root
claude: true
codex: false
`,
  ".skillset/skills/demo/SKILL.md": `
---
name: demo
description: Demo skill.
---

Body.
`,
};

describe("@skillset/core consumer API", () => {
  it("supports a quiet preview-build-check loop through public result APIs", async () => {
    const root = await fixture(DEMO_FIXTURE);
    const expectedOutput = ".claude/skills/demo/SKILL.md";
    const cwd = process.cwd();
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
      const preview = await diffSkillsetResult(root);
      expect(preview.operation).toBe("diff");
      expect(preview.writes).toEqual({
        deletedPaths: [],
        mode: "read",
        paths: [],
        writtenPaths: [],
      });
      expect(preview.diagnostics).toEqual([]);
      expect(preview.data.added).toContain(expectedOutput);
      expect(await Bun.file(join(root, expectedOutput)).exists()).toBe(false);

      const build = await buildSkillsetResult(root);
      expect(build.operation).toBe("build");
      expect(build.writes.mode).toBe("write");
      expect(build.writes.paths).toContain(expectedOutput);
      expect(build.diagnostics).toEqual([]);
      expect(await Bun.file(join(root, expectedOutput)).exists()).toBe(true);

      const checked = await checkSkillsetResult(root);
      expect(checked.operation).toBe("check");
      expect(checked.writes).toEqual({
        deletedPaths: [],
        mode: "read",
        paths: [],
        writtenPaths: [],
      });
      expect(checked.data.checkedFiles).toBe(build.data.length);
      expect(checked.diagnostics).toEqual([]);

      const clean = await diffSkillsetResult(root);
      expect(clean.data).toEqual({ added: [], changed: [], missing: [], removed: [] });
      expect(calls).toEqual([]);
      expect(process.cwd()).toBe(cwd);
      expect(process.exitCode).toBeUndefined();
    } finally {
      console.log = originalLog;
      console.warn = originalWarn;
      process.exitCode = previousExitCode;
    }
  });
});

async function fixture(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "skillset-core-consumer-"));
  for (const [path, content] of Object.entries(files)) {
    await Bun.write(join(root, path), `${content.trim()}\n`);
  }
  return root;
}
