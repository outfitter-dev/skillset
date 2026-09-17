import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { normalizeSkillsetFixtureFiles } from "../../../../scripts/test-helpers/skillset-config";
import { buildSkillsetResult } from "../build";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { force: true, recursive: true }))
  );
});

describe("legacy per-plugin bundle destinations", () => {
  it("cannot split a plugin away from the shared package root", async () => {
    const root = await mkdtemp(join(tmpdir(), "skillset-bundle-destination-"));
    roots.push(root);
    const files = normalizeSkillsetFixtureFiles({
      "skillset.yaml": `
skillset:
  name: bundle-destination
claude: true
codex: true
cursor: true
`,
      ".skillset/plugins/trails/skillset.yaml": `
skillset:
  name: trails
claude:
  bundle:
    path: custom/trails
`,
      ".skillset/plugins/trails/skills/hike/SKILL.md": `
---
name: hike
description: Plan a hike.
---

Hike.
`,
    });
    await Promise.all(
      Object.entries(files).map(([path, content]) =>
        Bun.write(join(root, path), content)
      )
    );

    await expect(buildSkillsetResult(root)).rejects.toThrow(
      ".skillset/plugins/trails/skillset.yaml.claude.bundle.path cannot split a shared plugin package"
    );
    expect(await Bun.file(join(root, "plugins/trails/plugin.json")).exists()).toBe(
      false
    );
    expect(await Bun.file(join(root, "custom/trails/plugin.json")).exists()).toBe(
      false
    );
  });
});
