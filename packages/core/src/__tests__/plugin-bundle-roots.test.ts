import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { normalizeSkillsetFixtureFiles } from "../../../../scripts/test-helpers/skillset-config";
import { buildSkillsetResult, verifySkillsetResult } from "../build";
import {
  pluginManifestPath,
  pluginPathPartsForOutput,
  pluginTargetRoot,
  providerSourceForPlugin,
} from "../plugin-output";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { force: true, recursive: true }))
  );
});

describe("shared plugin package root ownership", () => {
  it("keeps package and manifest paths fixed across marketplace roots", () => {
    const plugin = { id: "trails" };
    for (const outputRoot of ["plugins", "dist", "generated/openai"]) {
      expect(pluginTargetRoot(outputRoot, "claude", plugin.id)).toBe(
        "plugins/trails"
      );
      expect(pluginManifestPath(outputRoot, "claude", plugin)).toBe(
        "plugins/trails/.claude-plugin/plugin.json"
      );
      expect(pluginManifestPath(outputRoot, "codex", plugin)).toBe(
        "plugins/trails/plugin.json"
      );
      expect(pluginManifestPath(outputRoot, "cursor", plugin)).toBe(
        "plugins/trails/.cursor-plugin/plugin.json"
      );
      expect(providerSourceForPlugin(outputRoot, "claude", plugin)).toBe(
        "./plugins/trails"
      );
    }
  });

  it("recovers package-relative paths without provider segments", () => {
    expect(
      pluginPathPartsForOutput(
        {} as never,
        "dist",
        "cursor",
        "plugins/trails/skills/hike/SKILL.md"
      )
    ).toEqual({
      pluginId: "trails",
      pluginPath: "skills/hike/SKILL.md",
    });
    expect(
      pluginPathPartsForOutput(
        {} as never,
        "plugins",
        "claude",
        "plugins/trails/.claude-plugin/plugin.json"
      )
    ).toEqual({
      pluginId: "trails",
      pluginPath: ".claude-plugin/plugin.json",
    });
  });

  it("renders one fixed package with a default-root marketplace", async () => {
    const root = await fixture("plugins");
    const result = await buildSkillsetResult(root);
    expect(result.ok).toBe(true);
    expect(result.data.map((file) => file.path)).toEqual(
      expect.arrayContaining([
        "plugins/trails/plugin.json",
        "plugins/trails/.claude-plugin/plugin.json",
        "plugins/trails/.cursor-plugin/plugin.json",
        "plugins/trails/skills/hike/SKILL.md",
      ])
    );
    expect(
      result.data.some((file) =>
        /plugins\/trails\/(?:agents|chatgpt|claude|cursor)\//u.test(file.path)
      )
    ).toBe(false);

    const marketplace = JSON.parse(
      await readFile(join(root, ".claude-plugin/marketplace.json"), "utf8")
    ) as {
      readonly plugins: readonly {
        readonly name: string;
        readonly source: string;
      }[];
    };
    expect(marketplace.plugins).toContainEqual(
      expect.objectContaining({
        name: "trails",
        source: "./plugins/trails",
      })
    );
    expect((await verifySkillsetResult(root)).ok).toBe(true);
  });

  it.each(["claude", "codex", "cursor"] as const)(
    "refuses a nondefault %s plugin root before any output writes",
    async (target) => {
      const root = await fixture("dist", undefined, target);
      await expect(buildSkillsetResult(root)).rejects.toThrow(
        `custom package placement via ${target}.plugins.path or --dist is unsupported until SET-561`
      );
      expect(await Bun.file(join(root, "plugins/trails/plugin.json")).exists()).toBe(false);
      expect(await Bun.file(join(root, "dist/.claude-plugin/marketplace.json")).exists()).toBe(false);
    }
  );

  it("refuses --dist when a shared package would be emitted", async () => {
    const root = await fixture("plugins", undefined, "claude", true);
    await expect(buildSkillsetResult(root, { distDir: "dist" })).rejects.toThrow(
      "custom package placement via claude.plugins.path or --dist is unsupported until SET-561"
    );
    expect(await Bun.file(join(root, "plugins/trails/plugin.json")).exists()).toBe(false);
  });

  it("rejects a legacy Claude bundle path before writing", async () => {
    const root = await fixture("plugins", "dist/trails");
    await expect(buildSkillsetResult(root)).rejects.toThrow(
      "cannot split a shared plugin package"
    );
    expect(await Bun.file(join(root, "plugins/trails/plugin.json")).exists()).toBe(
      false
    );
    expect(await Bun.file(join(root, "dist/trails/skillset.lock")).exists()).toBe(
      false
    );
  });
});

async function fixture(
  marketplaceRoot: string,
  claudeBundlePath?: string,
  customTarget: "claude" | "codex" | "cursor" = "claude",
  implicitRoots = false
): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "skillset-package-roots-"));
  roots.push(root);
  const outputConfig = implicitRoots
    ? "claude: true\ncodex: true\ncursor: true"
    : `claude:
  plugins:
    path: ${customTarget === "claude" ? marketplaceRoot : "plugins"}
codex:
  plugins:
    path: ${customTarget === "codex" ? marketplaceRoot : "plugins"}
cursor:
  plugins:
    path: ${customTarget === "cursor" ? marketplaceRoot : "plugins"}`;
  const files = normalizeSkillsetFixtureFiles({
    "skillset.yaml": `
skillset:
  name: packages
${outputConfig}
marketplaces:
  local:
    targets: [claude, codex, cursor]
    plugins:
      - plugin: trails
`,
    ".skillset/plugins/trails/skillset.yaml": `
skillset:
  name: trails
${claudeBundlePath === undefined ? "" : `claude:
  bundle:
    path: ${claudeBundlePath}
`}`,
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
  return root;
}
