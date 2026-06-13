import { describe, expect, it } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildSkillsetResult } from "@skillset/core";

const DEMO_FIXTURE: Record<string, string> = {
  ".skillset/config.yaml": `
skillset:
  name: core-build-root
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

describe("buildSkillsetResult", () => {
  it("reports actual writes and deletions instead of planned managed paths", async () => {
    const root = await fixture(DEMO_FIXTURE);
    const expectedOutput = ".claude/skills/demo/SKILL.md";
    const staleOutput = ".claude/skills/stale/SKILL.md";

    const first = await buildSkillsetResult(root);

    expect(first.writes.writtenPaths).toContain(expectedOutput);
    expect(first.writes.deletedPaths).toEqual([]);
    expect(first.writes.paths).toEqual(first.writes.writtenPaths);

    const second = await buildSkillsetResult(root);

    expect(second.writes).toEqual({
      deletedPaths: [],
      mode: "write",
      paths: [],
      writtenPaths: [],
    });

    await Bun.write(join(root, staleOutput), "stale\n");
    const third = await buildSkillsetResult(root);

    expect(third.writes.writtenPaths).toEqual([]);
    expect(third.writes.deletedPaths).toEqual([staleOutput]);
    expect(third.writes.paths).toEqual([staleOutput]);
  });
});

async function fixture(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "skillset-core-build-"));
  for (const [path, content] of Object.entries(files)) {
    await Bun.write(join(root, path), `${content.trim()}\n`);
  }
  return root;
}
