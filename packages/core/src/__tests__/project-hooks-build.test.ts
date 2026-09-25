import { describe, expect, it } from "bun:test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { buildSkillsetResult } from "../build";
import { resolveRepoOperationalCachePath } from "../operational-cache";
import { SESSION_START_COMMAND } from "../render-project-hooks";
import { createTestFixtureRoot } from "../../../../scripts/test-helpers/fixture-root";

const CONFIG = `
skillset:
  name: project-hooks-build
claude: true
codex: false
cursor: false
compile:
  session_start_hook: on
`;

const SKILL = `---
name: demo
description: Demo skill.
---

Body.
`;

describe("project SessionStart hooks at the build destination", () => {
  it("composes an isolated build from the mirror, not the live settings file", async () => {
    const { root, xdg, mirror } = await isolatedFixture();
    const live = '{"foreign":"live"}\n';
    await mkdir(join(root, ".claude"), { recursive: true });
    await writeFile(join(root, ".claude/settings.json"), live);

    const first = await buildSkillsetResult(root, { isolated: true, xdg });
    expect(first.outputState.blockers).toEqual([]);
    expect(first.ok).toBe(true);
    const mirrored = await readFile(join(mirror, ".claude/settings.json"), "utf8");
    expect(mirrored).toContain(SESSION_START_COMMAND);
    expect(mirrored).not.toContain('"live"');
    expect(await readFile(join(root, ".claude/settings.json"), "utf8")).toBe(live);
  });

  for (const live of ["garbage\n", '{"not":"a lock"}\n']) {
    it(`builds isolated output without reading a foreign live lock (${live.trim()})`, async () => {
      const { root, xdg, mirror } = await isolatedFixture();
      await writeFile(join(root, "skillset.lock"), live);

      const result = await buildSkillsetResult(root, { isolated: true, xdg });
      expect(result.outputState.blockers).toEqual([]);
      expect(result.ok).toBe(true);
      expect(await Bun.file(join(mirror, "skillset.lock")).exists()).toBe(true);
      expect(await readFile(join(root, "skillset.lock"), "utf8")).toBe(live);
    });
  }

  it("keeps foreign mirror edits across repeated isolated builds without a live file", async () => {
    const { root, xdg, mirror } = await isolatedFixture();
    expect((await buildSkillsetResult(root, { isolated: true, xdg })).ok).toBe(true);
    const settingsPath = join(mirror, ".claude/settings.json");
    const edited = (await readFile(settingsPath, "utf8")).replace("{", '{\n  "foreign": "mirror",');
    await writeFile(settingsPath, edited);

    const second = await buildSkillsetResult(root, { isolated: true, xdg });
    expect(second.outputState.blockers).toEqual([]);
    expect(second.ok).toBe(true);
    expect(await readFile(settingsPath, "utf8")).toBe(edited);
    expect(await Bun.file(join(root, ".claude/settings.json")).exists()).toBe(false);
  });
});

async function isolatedFixture(): Promise<{
  readonly mirror: string;
  readonly root: string;
  readonly xdg: { readonly env: Record<string, string>; readonly homeDir: string };
}> {
  const root = await createTestFixtureRoot("skillset-project-hooks-build-");
  await Bun.write(join(root, "skillset.yaml"), CONFIG);
  await Bun.write(join(root, ".skillset/skills/demo/SKILL.md"), SKILL);
  const xdg = { env: { XDG_CACHE_HOME: join(root, "xdg-cache") }, homeDir: root };
  return { mirror: join(resolveRepoOperationalCachePath(root, xdg), "latest"), root, xdg };
}
