import { describe, expect, it } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { diffSkillsetResult } from "@skillset/core";

import { normalizeSkillsetFixtureFiles } from "../../../../scripts/test-helpers/skillset-config";
import { runQuietCoreProcess } from "./quiet-core-process";

const DEMO_FIXTURE: Record<string, string> = {
  "skillset.yaml": `
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
    const child = await runQuietCoreProcess("diff", root);
    const evidence = child.evidence as {
      readonly cwdAfter: string;
      readonly cwdBefore: string;
      readonly diff: {
        readonly added: readonly string[];
        readonly changed: readonly string[];
        readonly missing: readonly string[];
        readonly removed: readonly string[];
      };
      readonly outputExists: boolean;
      readonly processExitCode: number | null;
      readonly result: Awaited<ReturnType<typeof diffSkillsetResult>>;
    };
    const { diff, result } = evidence;

    expect(child).toMatchObject({ exitCode: 0, stderr: "", stdout: "" });
    expect(result.ok).toBe(true);
    expect(result.operation).toBe("diff");
    expect(result.writes).toEqual({
      deletedPaths: [],
      mode: "read",
      paths: [],
      writtenPaths: [],
    });
    expect(result.renderResults).toContainEqual(
      expect.objectContaining({
        featureId: "standalone-skills",
        sourceUnit: "skill:demo",
        status: "rendered",
        target: "claude",
      })
    );
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        code: "source-warning",
        severity: "warning",
      }),
    ]);
    expect(diff.added).toContain(".claude/skills/demo/SKILL.md");
    expect(diff.changed).toEqual([]);
    expect(diff.missing).toEqual([]);
    expect(diff.removed).toEqual([]);
    expect(diff).toEqual(result.data);
    expect(evidence.outputExists).toBe(false);
    expect(
      await Bun.file(join(root, ".claude/skills/demo/SKILL.md")).exists()
    ).toBe(false);
    expect(evidence.cwdAfter).toBe(evidence.cwdBefore);
    expect(evidence.processExitCode).toBeNull();
  });

  it("throws invalid source config instead of hiding it in a successful result", async () => {
    const root = await fixture({
      "skillset.yaml": `
skillset:
  name: invalid-core-diff-root
compile:
  targets:
    - nope
`,
    });

    await expect(diffSkillsetResult(root)).rejects.toThrow(
      "unsupported target"
    );
  });
});

async function fixture(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "skillset-core-diff-"));
  for (const [path, content] of Object.entries(
    normalizeSkillsetFixtureFiles(files)
  )) {
    await Bun.write(join(root, path), `${content.trim()}\n`);
  }
  return root;
}
