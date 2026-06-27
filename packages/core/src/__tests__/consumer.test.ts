import { describe, expect, it } from "bun:test";
import { normalizeSkillsetFixtureFiles } from "../../../../scripts/test-helpers/skillset-config";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  verifySkillset,
  buildSkillsetResult,
  verifySkillsetResult,
  diffSkillsetResult,
} from "@skillset/core";

const DEMO_FIXTURE: Record<string, string> = {
  "skillset.yaml": `
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

const SECOND_SKILL = `
---
name: keeper
description: Keeper skill.
---

Keep the source graph valid.
`;

describe("@skillset/core consumer API", () => {
  it("supports a quiet preview-build-verify loop through public result APIs", async () => {
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

      const verified = await verifySkillsetResult(root);
      expect(verified.operation).toBe("verify");
      expect(verified.ok).toBe(true);
      expect(verified.writes).toEqual({
        deletedPaths: [],
        mode: "read",
        paths: [],
        writtenPaths: [],
      });
      expect(verified.data.checkedFiles).toBe(build.data.length);
      expect(verified.data.failures).toEqual([]);
      expect(verified.diagnostics).toEqual([]);

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

  it("returns structured verify drift while preserving the throwing convenience helper", async () => {
    const root = await fixture(DEMO_FIXTURE);
    const expectedOutput = ".claude/skills/demo/SKILL.md";
    await buildSkillsetResult(root);
    await Bun.write(join(root, expectedOutput), "stale\n");

    const result = await verifySkillsetResult(root);

    expect(result.ok).toBe(false);
    expect(result.operation).toBe("verify");
    expect(result.writes.mode).toBe("read");
    expect(result.data.checkedFiles).toBeGreaterThan(0);
    expect(result.data.failures).toHaveLength(1);
    expect(result.data.failures[0]).toContain(expectedOutput);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "generated-output-changed",
        outputPath: expectedOutput,
        severity: "error",
      })
    );
    await expect(verifySkillset(root)).rejects.toThrow("skillset: generated output is not current");
  });

  it("classifies missing generated output before a first build", async () => {
    const root = await fixture(DEMO_FIXTURE);
    const expectedOutput = ".claude/skills/demo/SKILL.md";

    const result = await verifySkillsetResult(root);

    expect(result.ok).toBe(false);
    expect(result.data.failures).toContain(`missing generated file: ${expectedOutput}`);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "generated-output-missing",
        outputPath: expectedOutput,
        severity: "error",
      })
    );
  });

  it("classifies deleted managed generated output", async () => {
    const root = await fixture(DEMO_FIXTURE);
    const expectedOutput = ".claude/skills/demo/SKILL.md";
    await buildSkillsetResult(root);
    await rm(join(root, expectedOutput));

    const result = await verifySkillsetResult(root);

    expect(result.ok).toBe(false);
    expect(result.data.failures).toEqual([`missing managed generated file: ${expectedOutput}`]);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "generated-output-missing-managed",
        outputPath: expectedOutput,
        severity: "error",
      })
    );
  });

  it("classifies stale generated output for removed source units", async () => {
    const root = await fixture({
      ...DEMO_FIXTURE,
      ".skillset/skills/keeper/SKILL.md": SECOND_SKILL,
    });
    const expectedOutput = ".claude/skills/demo/SKILL.md";
    await buildSkillsetResult(root);
    await rm(join(root, ".skillset/skills/demo"), { recursive: true });

    const result = await verifySkillsetResult(root);

    expect(result.ok).toBe(false);
    expect(result.data.failures).toContain(`stale generated file: ${expectedOutput}`);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "generated-output-removed",
        outputPath: expectedOutput,
        severity: "error",
      })
    );
  });

  it("still rejects invalid source config as an exceptional error", async () => {
    const root = await fixture({
      "skillset.yaml": `
skillset:
  name: invalid-core-check-root
compile:
  targets:
    - nope
`,
    });

    await expect(verifySkillsetResult(root)).rejects.toThrow("unsupported target");
  });
});

async function fixture(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "skillset-core-consumer-"));
  for (const [path, content] of Object.entries(normalizeSkillsetFixtureFiles(files))) {
    await Bun.write(join(root, path), `${content.trim()}\n`);
  }
  return root;
}
