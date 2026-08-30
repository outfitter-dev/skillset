import { describe, expect, it } from "bun:test";
import { chmod, mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { normalizeSkillsetFixtureFiles } from "../../../../scripts/test-helpers/skillset-config";
import {
  buildSkillsetResult,
  diffSkillsetResult,
  verifySkillsetResult,
} from "../build";
import { supportsGeneratedFileModes } from "../generated-file-mode";

const TRAILS_HOOKS = `{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "\${CLAUDE_PLUGIN_ROOT}/hooks/detect-trails.sh",
            "timeout": 3000
          }
        ]
      }
    ]
  }
}`;

const TRAILS_FIXTURE: Record<string, string> = {
  "skillset.yaml": `
skillset:
  name: bundle-root
codex: false
cursor: false
`,
  ".skillset/plugins/trails/skillset.yaml": `
skillset:
  name: trails
  description: Trails tooling plugin.
claude:
  bundle:
    path: plugin
`,
  ".skillset/plugins/trails/hooks/hooks.json": TRAILS_HOOKS,
  ".skillset/plugins/trails/hooks/detect-trails.sh": `#!/usr/bin/env bash
echo trails
`,
  ".skillset/plugins/trails/skills/hike/SKILL.md": `
---
name: hike
description: Plan a hike with Trails.
---

Use Trails to plan hikes.
`,
};

describe("per-plugin claude bundle destinations", () => {
  it("renders the complete bundle at the plugin-owned root with the marketplace at the repo root", async () => {
    const root = await fixture(TRAILS_FIXTURE);
    await chmod(join(root, ".skillset/plugins/trails/hooks/detect-trails.sh"), 0o755);

    const result = await buildSkillsetResult(root);
    expect(result.ok).toBe(true);

    const paths = result.writes.paths;
    expect(paths).toContain(".claude-plugin/marketplace.json");
    expect(paths).toContain("plugin/.claude-plugin/plugin.json");
    expect(paths).toContain("plugin/skills/hike/SKILL.md");
    expect(paths).toContain("plugin/hooks/hooks.json");
    expect(paths).toContain("plugin/hooks/detect-trails.sh");
    expect(paths).toContain("plugin/skillset.lock");

    // The bundle owns its exact destination: no implicit plugins/<id> or
    // provider segment anywhere.
    expect(paths.filter((path) => path.startsWith("plugin/plugins/"))).toEqual([]);
    expect(paths.filter((path) => path.startsWith("plugin/claude/"))).toEqual([]);
    expect(paths.filter((path) => path.startsWith("plugins/trails/"))).toEqual([]);

    const marketplace = JSON.parse(
      await readFile(join(root, ".claude-plugin/marketplace.json"), "utf8")
    ) as { plugins: readonly { name: string; source: string }[] };
    expect(marketplace.plugins).toHaveLength(1);
    expect(marketplace.plugins[0]).toMatchObject({
      name: "trails",
      source: "./plugin",
    });

    const hooks = JSON.parse(
      await readFile(join(root, "plugin/hooks/hooks.json"), "utf8")
    ) as {
      hooks: {
        SessionStart: readonly {
          hooks: readonly { command: string; timeout: number; type: string }[];
        }[];
      };
    };
    expect(hooks.hooks.SessionStart[0]?.hooks[0]).toEqual({
      command: "${CLAUDE_PLUGIN_ROOT}/hooks/detect-trails.sh",
      timeout: 3000,
      type: "command",
    });

    if (supportsGeneratedFileModes()) {
      const script = await stat(join(root, "plugin/hooks/detect-trails.sh"));
      expect(script.mode & 0o777).toBe(0o755);
      const skill = await stat(join(root, "plugin/skills/hike/SKILL.md"));
      expect(skill.mode & 0o777).toBe(0o644);
    }

    const lock = JSON.parse(
      await readFile(join(root, "plugin/skillset.lock"), "utf8")
    ) as {
      items: readonly { kind?: string; name?: string; plugin?: string }[];
      outputRoot: string;
      target: string;
    };
    expect(lock.outputRoot).toBe("plugin");
    expect(lock.target).toBe("claude");
    expect(lock.items.length).toBeGreaterThan(0);
    expect(
      lock.items.every(
        (item) =>
          item.plugin === "trails" ||
          (item.kind === "plugin" && item.name === "trails")
      )
    ).toBe(true);

    const drift = await diffSkillsetResult(root);
    expect(drift.ok).toBe(true);
    expect([
      ...drift.data.added,
      ...drift.data.changed,
      ...drift.data.missing,
      ...drift.data.removed,
    ]).toEqual([]);

    if (supportsGeneratedFileModes()) {
      await chmod(join(root, "plugin/hooks/detect-trails.sh"), 0o644);
      const modeDrift = await verifySkillsetResult(root);
      expect(modeDrift.ok).toBe(false);
    }
  });

  it("rejects bundle destinations nesting inside an active output root", async () => {
    const root = await fixture({
      ...TRAILS_FIXTURE,
      ".skillset/plugins/trails/skillset.yaml": `
skillset:
  name: trails
claude:
  bundle:
    path: plugins/nested
`,
      ".skillset/plugins/basecamp/skillset.yaml": `
skillset:
  name: basecamp
`,
      ".skillset/plugins/basecamp/skills/rest/SKILL.md": `
---
name: rest
description: Rest at basecamp.
---

Body.
`,
    });

    await expect(buildSkillsetResult(root)).rejects.toThrow(
      "plugins.trails.claude.bundle (plugins/nested) must not overlap output root outputs.plugins.claude (plugins)"
    );
  });

  it("rejects two plugins sharing one bundle destination", async () => {
    const root = await fixture({
      ...TRAILS_FIXTURE,
      ".skillset/plugins/switchback/skillset.yaml": `
skillset:
  name: switchback
claude:
  bundle:
    path: plugin
`,
      ".skillset/plugins/switchback/skills/climb/SKILL.md": `
---
name: climb
description: Plan a climb.
---

Body.
`,
    });

    await expect(buildSkillsetResult(root)).rejects.toThrow(
      "reuses output root plugin; already used by plugins.switchback.claude.bundle"
    );
  });

  it("rejects a bundle destination equal to a configured output root", async () => {
    const root = await fixture({
      ...TRAILS_FIXTURE,
      ".skillset/plugins/trails/skillset.yaml": `
skillset:
  name: trails
claude:
  bundle:
    path: plugins
`,
    });

    await expect(buildSkillsetResult(root)).rejects.toThrow(
      /plugins\.trails\.claude\.bundle reuses output root plugins; already used by outputs\.plugins\./
    );
  });
});

async function fixture(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "skillset-bundle-destination-"));
  for (const [path, content] of Object.entries(
    normalizeSkillsetFixtureFiles(files)
  )) {
    await Bun.write(join(root, path), `${content.trim()}\n`);
  }
  return root;
}
