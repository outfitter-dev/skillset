import { describe, expect, it } from "bun:test";
import { chmod, mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { normalizeSkillsetFixtureFiles } from "../../../../scripts/test-helpers/skillset-config";
import { explainPath } from "../authoring";
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

const TRAILS_NATIVE_LICENSE = new TextEncoder().encode(
  "Trails native license terms.\r\n"
);
const TRAILS_CRLF_RULES = new TextEncoder().encode(
  "allow git status\r\ndeny destructive commands\r\n"
);
const TRAILS_OPAQUE_RULES = new Uint8Array([0, 255, 13, 10, 20, 30]);

const TRAILS_FIXTURE: Record<string, string> = {
  "skillset.yaml": `
skillset:
  name: bundle-root
  license: none
codex: false
cursor: false
`,
  ".skillset/plugins/trails/skillset.yaml": `
skillset:
  name: trails
  description: Trails tooling plugin.
  license: none
claude:
  bundle:
    path: plugin
`,
  ".skillset/plugins/trails/agents/trail-guide.md": `
# Trail Guide

Review proposed routes.
`,
  ".skillset/plugins/trails/bin/trails": `#!/usr/bin/env bash
echo trails
`,
  ".skillset/plugins/trails/hooks/hooks.json": TRAILS_HOOKS,
  ".skillset/plugins/trails/hooks/detect-trails.sh": `#!/usr/bin/env bash
echo trails
`,
  ".skillset/plugins/trails/scripts/inspect-trail.sh": `#!/usr/bin/env bash
echo inspect
`,
  ".skillset/plugins/trails/skills/hike/SKILL.md": `
---
name: hike
description: Plan a hike with Trails.
skillset:
  license: none
---

Use Trails to plan hikes.
`,
};

describe("per-plugin claude bundle destinations", () => {
  it("renders the complete bundle at the plugin-owned root with the marketplace at the repo root", async () => {
    const root = await fixture(TRAILS_FIXTURE);
    const sourcePaths = {
      bin: join(root, ".skillset/plugins/trails/bin/trails"),
      hook: join(root, ".skillset/plugins/trails/hooks/detect-trails.sh"),
      license: join(root, ".skillset/plugins/trails/_claude/LICENSE"),
      opaqueRules: join(
        root,
        ".skillset/plugins/trails/_claude/rules/opaque.bin"
      ),
      script: join(root, ".skillset/plugins/trails/scripts/inspect-trail.sh"),
      windowsRules: join(
        root,
        ".skillset/plugins/trails/_claude/rules/windows.raw"
      ),
    };
    await Bun.write(sourcePaths.license, TRAILS_NATIVE_LICENSE);
    await Bun.write(sourcePaths.windowsRules, TRAILS_CRLF_RULES);
    await Bun.write(sourcePaths.opaqueRules, TRAILS_OPAQUE_RULES);
    await chmod(sourcePaths.bin, 0o755);
    await chmod(sourcePaths.hook, 0o755);
    await chmod(sourcePaths.script, 0o755);

    const result = await buildSkillsetResult(root);
    expect(result.ok).toBe(true);

    const paths = result.writes.paths;
    const expectedBundlePaths = [
      ".claude-plugin/marketplace.json",
      "plugin/.claude-plugin/plugin.json",
      "plugin/LICENSE",
      "plugin/agents/trail-guide.md",
      "plugin/bin/trails",
      "plugin/hooks/hooks.json",
      "plugin/hooks/detect-trails.sh",
      "plugin/rules/opaque.bin",
      "plugin/rules/windows.raw",
      "plugin/scripts/inspect-trail.sh",
      "plugin/skills/hike/SKILL.md",
      "plugin/skillset.lock",
    ];
    for (const path of expectedBundlePaths) {
      expect(paths).toContain(path);
    }

    // The bundle owns its exact destination: no implicit plugins/<id> or
    // provider segment anywhere.
    expect(paths.filter((path) => path.startsWith("plugin/plugins/"))).toEqual(
      []
    );
    expect(paths.filter((path) => path.startsWith("plugin/claude/"))).toEqual(
      []
    );
    expect(paths.filter((path) => path.startsWith("plugins/trails/"))).toEqual(
      []
    );

    // All adaptive license scopes opt out. The provider-native LICENSE island
    // is selected once at the bundle root without synthesizing LICENSE.txt.
    expect(paths.filter((path) => path.includes("LICENSE"))).toEqual([
      "plugin/LICENSE",
    ]);
    expect([...(await readFile(join(root, "plugin/LICENSE")))]).toEqual([
      ...TRAILS_NATIVE_LICENSE,
    ]);
    expect(await Bun.file(join(root, "plugin/LICENSE.txt")).exists()).toBe(
      false
    );
    expect(
      await Bun.file(join(root, "plugin/skills/hike/LICENSE.txt")).exists()
    ).toBe(false);

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

    expect([
      ...(await readFile(join(root, "plugin/rules/windows.raw"))),
    ]).toEqual([...TRAILS_CRLF_RULES]);
    expect([
      ...(await readFile(join(root, "plugin/rules/opaque.bin"))),
    ]).toEqual([...TRAILS_OPAQUE_RULES]);

    if (supportsGeneratedFileModes()) {
      for (const path of [
        "plugin/bin/trails",
        "plugin/hooks/detect-trails.sh",
        "plugin/scripts/inspect-trail.sh",
      ]) {
        expect((await stat(join(root, path))).mode & 0o777).toBe(0o755);
      }
      for (const path of [
        "plugin/agents/trail-guide.md",
        "plugin/rules/opaque.bin",
        "plugin/rules/windows.raw",
        "plugin/skills/hike/SKILL.md",
      ]) {
        expect((await stat(join(root, path))).mode & 0o777).toBe(0o644);
      }
    }

    const lock = JSON.parse(
      await readFile(join(root, "plugin/skillset.lock"), "utf8")
    ) as {
      items: readonly {
        fileModes?: Readonly<Record<string, string>>;
        kind?: string;
        name?: string;
        plugin?: string;
        validation?: string;
      }[];
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
    expect(lock.items).toContainEqual(
      expect.objectContaining({
        kind: "island",
        validation: "opaque-copy",
      })
    );
    expect(lock.items).toContainEqual(
      expect.objectContaining({
        feature: "bin",
        fileModes: expect.objectContaining({ "bin/trails": "0755" }),
        kind: "plugin-feature",
      })
    );

    const sourceIsland = await explainPath(
      root,
      ".skillset/plugins/trails/_claude/rules/opaque.bin"
    );
    expect(sourceIsland.kind).toBe("source-island");
    expect(sourceIsland.entries).toContainEqual(
      expect.objectContaining({
        outputPath: "plugin/rules/opaque.bin",
        outputRoot: "plugin",
        sourcePath: ".skillset/plugins/trails/_claude/rules/opaque.bin",
        target: "claude",
        validation: "opaque-copy",
      })
    );
    const generatedIsland = await explainPath(root, "plugin/rules/opaque.bin");
    expect(generatedIsland.kind).toBe("generated");
    expect(generatedIsland.entries).toContainEqual(
      expect.objectContaining({
        outputRoot: "plugin",
        sourcePath: ".skillset/plugins/trails/_claude/rules/opaque.bin",
      })
    );
    const generatedLicense = await explainPath(root, "plugin/LICENSE");
    expect(generatedLicense.kind).toBe("generated");
    expect(generatedLicense.entries).toContainEqual(
      expect.objectContaining({
        outputPath: "plugin/LICENSE",
        outputRoot: "plugin",
        sourcePath: ".skillset/plugins/trails/_claude/LICENSE",
        validation: "opaque-copy",
      })
    );
    const generatedAgent = await explainPath(
      root,
      "plugin/agents/trail-guide.md"
    );
    expect(generatedAgent.kind).toBe("generated");
    expect(generatedAgent.entries).toContainEqual(
      expect.objectContaining({
        kind: "plugin",
        outputRoot: "plugin",
        sourcePath: ".skillset/plugins/trails",
      })
    );

    const drift = await diffSkillsetResult(root);
    expect(drift.ok).toBe(true);
    expect([
      ...drift.data.added,
      ...drift.data.changed,
      ...drift.data.missing,
      ...drift.data.removed,
    ]).toEqual([]);

    if (supportsGeneratedFileModes()) {
      await chmod(join(root, "plugin/scripts/inspect-trail.sh"), 0o644);
      const modeDrift = await verifySkillsetResult(root);
      expect(modeDrift.ok).toBe(false);
      expect(modeDrift.data.failures).toContain(
        "stale generated file mode: plugin/scripts/inspect-trail.sh; expected 0755, found 0644"
      );
      expect((await diffSkillsetResult(root)).data.changed).toContain(
        "plugin/scripts/inspect-trail.sh"
      );
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
      /plugins\.trails\.claude\.bundle \(plugins\/nested\) must not overlap output root standards\.agent-plugins-1\.0 \(plugins\)/
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
      /plugins\.(switchback|trails)\.claude\.bundle \(plugin\) must not overlap plugin (switchback|trails) Claude bundle \(plugin\)/
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
      /plugins\.trails\.claude\.bundle reuses output root plugins; already used by standards\.agent-plugins-1\.0 \(plugins\)/
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
