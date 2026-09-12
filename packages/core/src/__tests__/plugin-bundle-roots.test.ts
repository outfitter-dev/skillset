import { describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { normalizeSkillsetFixtureFiles } from "../../../../scripts/test-helpers/skillset-config";
import { buildSkillsetResult, diffSkillsetResult, verifySkillsetResult } from "../build";
import { checkMarketplaces } from "../marketplace-check";
import { providerSourceForPlugin } from "../plugin-output";

describe("plugin bundle root ownership", () => {
  it("records no-output plugin results on the independently owned bundle lock", async () => {
    const root = await fixture("plugin", "plugins");
    const config = await readFile(join(root, "skillset.yaml"), "utf8");
    await Bun.write(join(root, "skillset.yaml"), `${config}compile:\n  unsupportedDestination: warn\n`);
    const pluginConfig = await readFile(join(root, ".skillset/plugins/trails/skillset.yaml"), "utf8");
    await Bun.write(join(root, ".skillset/plugins/trails/skillset.yaml"),
      `${pluginConfig}hooks:\n  Stop:\n    - hook: stop-policy\n      match: main\n`);
    await Bun.write(join(root, ".skillset/plugins/trails/hooks/stop-policy.json"),
      JSON.stringify({ events: ["Stop"], run: { command: "echo stop" } }));
    const build = await buildSkillsetResult(root);
    expect(build.ok).toBe(true);
    const unsupported = build.renderResults.find((result) =>
      result.sourceUnit === "plugin.trails.feature:hooks" && result.target === "claude"
    );
    expect(unsupported?.status).toBe("unsupported");
    expect(unsupported?.outputs ?? []).toEqual([]);
    const lock = JSON.parse(await readFile(join(root, "plugin/skillset.lock"), "utf8"));
    expect(lock.renderResults).toContainEqual(unsupported);
  });

  it("derives sources from plugin identity relative to the marketplace", () => {
    expect(providerSourceForPlugin("plugins", "claude", { id: "trails", claudeBundlePath: "dist/plugins/custom" })).toBe("./dist/plugins/custom");
    expect(providerSourceForPlugin("dist", "claude", { id: "trails", claudeBundlePath: "dist/plugins/custom" })).toBe("./plugins/custom");
    expect(providerSourceForPlugin("dist", "claude", { id: "trails" })).toBe("./plugins/trails");
  });

  for (const [catalog, marketplaceRoot] of [["implicit", "plugins"], ["declared", "plugins"], ["implicit", "dist"], ["declared", "dist"]] as const) {
    it(`renders a ${catalog} Claude catalog without rebasing its explicit source under ${marketplaceRoot}`, async () => {
      const root = await fixture(undefined, marketplaceRoot);
      const configPath = join(root, "skillset.yaml");
      if (catalog === "implicit") {
        await writeFile(configPath, (await readFile(configPath, "utf8")).replace(
          "marketplaces:\n  local:\n    targets: [claude]\n    plugins:\n      - plugin: trails\n", ""
        ));
      }
      expect((await buildSkillsetResult(root)).ok).toBe(true);
      const marketplacePath = marketplaceRoot === "plugins" ? ".claude-plugin/marketplace.json" : "dist/.claude-plugin/marketplace.json";
      const marketplace = JSON.parse(await readFile(join(root, marketplacePath), "utf8")) as {
        readonly metadata: Record<string, unknown>;
        readonly plugins: readonly { readonly name: string; readonly source: string }[];
      };
      const expectedSource = marketplaceRoot === "plugins" ? "./plugins/trails/claude" : "./plugins/trails";
      expect(marketplace.metadata.pluginRoot).toBeUndefined();
      expect(marketplace.plugins).toContainEqual(expect.objectContaining({ name: "trails", source: expectedSource }));
    });
  }

  for (const marketplaceRoot of ["plugins", "dist"]) {
    it(`keeps nested-path marketplace and lock provenance consistent under ${marketplaceRoot}`, async () => {
      const root = await fixture("dist/plugins/custom", marketplaceRoot);
      expect((await buildSkillsetResult(root)).ok).toBe(true);
      const marketplacePath = marketplaceRoot === "plugins" ? ".claude-plugin/marketplace.json" : "dist/.claude-plugin/marketplace.json";
      const marketplace = JSON.parse(await readFile(join(root, marketplacePath), "utf8"));
      const expectedSource = marketplaceRoot === "plugins" ? "./dist/plugins/custom" : "./plugins/custom";
      expect(marketplace.plugins.find((plugin: {name: string}) => plugin.name === "trails").source).toBe(expectedSource);
      const report = await checkMarketplaces(root);
      expect(report.ok).toBe(true);
      expect(report.entries[0]?.providerSource).toBe(expectedSource);
      expect(report.entries[0]?.provenance.providerSource).toBe(expectedSource);
      expect(report.entries[0]?.lock.state).toBe("locked");
      expect((await verifySkillsetResult(root)).ok).toBe(true);
    });
  }

  it("keeps a nested independent bundle separate from a sibling default bundle", async () => {
    const root = await fixture("dist/trails", "dist", true);
    expect((await buildSkillsetResult(root)).ok).toBe(true);
    const parentLock = JSON.parse(await readFile(join(root, "dist/skillset.lock"), "utf8"));
    expect(parentLock.items.every((item: {plugin?: string;name?: string}) => item.plugin !== "trails" && item.name !== "trails")).toBe(true);
    expect((await diffSkillsetResult(root)).data.changed).toEqual([]);
    const managed = join(root, "dist/trails/skills/hike/SKILL.md");
    await writeFile(managed, "user edit\n");
    expect((await verifySkillsetResult(root)).ok).toBe(false);
    expect((await diffSkillsetResult(root)).outputState.state).toBe("output-diverged");
    // Rebuild our deliberate edit, then remove the authored skill so
    // the child lock must remove stale content without touching its sibling.
    expect((await buildSkillsetResult(root)).ok).toBe(true);
    await rm(join(root, ".skillset/plugins/trails/skills/hike"), { recursive: true });
    expect((await buildSkillsetResult(root)).ok).toBe(true);
    expect(await Bun.file(managed).exists()).toBe(false);
    expect(await Bun.file(join(root, "dist/plugins/basecamp/skills/rest/SKILL.md")).exists()).toBe(true);
    expect((await verifySkillsetResult(root)).ok).toBe(true);
  });

  for (const marketplaceRoot of ["dist/", "./dist"]) {
    it(`accepts normalized custom marketplace root ${marketplaceRoot}`, async () => {
      const root = await fixture("dist/trails", marketplaceRoot);
      expect((await buildSkillsetResult(root)).ok).toBe(true);
      const marketplace = JSON.parse(await readFile(join(root, "dist/.claude-plugin/marketplace.json"), "utf8"));
      expect(marketplace.plugins.find((plugin: {name: string}) => plugin.name === "trails").source).toBe("./trails");
      expect((await verifySkillsetResult(root)).ok).toBe(true);
    });
  }

  for (const marketplaceRoot of ["dist", "dist/", "./dist"]) {
    it(`SET-516: canonicalizes the default plugin repository README under ${marketplaceRoot}`, async () => {
      const root = await fixture(undefined, marketplaceRoot);
      const build = await buildSkillsetResult(root);

      expect(build.ok).toBe(true);
      expect(build.data.filter((file) => file.path.endsWith("/README.md")).map((file) => file.path)).toEqual([
        "dist/README.md",
      ]);
      expect(build.writes.paths).toContain("dist/README.md");
      expect(await Bun.file(join(root, "dist/README.md")).exists()).toBe(true);
      expect((await verifySkillsetResult(root)).ok).toBe(true);
      expect((await diffSkillsetResult(root)).data).toEqual({
        added: [],
        changed: [],
        missing: [],
        removed: [],
      });
    });
  }

  for (const path of ["plugin", "dist", "dist-other/trails", "parent"]) {
    it(`rejects unreferenceable or root-like custom-marketplace bundle ${path}`, async () => {
      const root = await fixture(path, path === "parent" ? "parent/marketplace" : "dist");
      await expect(buildSkillsetResult(root)).rejects.toThrow(/(output root|marketplace root)/);
    });
  }

  for (const path of ["Plugins", "PLUGINS/child", ".SKILLSET/generated", ".claude-plugin", "dist/.claude-plugin", "dist/plugins/basecamp/child"]) {
    it(`rejects portable destination conflict ${path}`, async () => {
      const root = await fixture(path, path.startsWith("dist/") ? "dist" : "plugins", true);
      await expect(buildSkillsetResult(root)).rejects.toThrow(/(output root|source root|overlap plugin)/);
    });
  }

  for (const [bundle, cursorRoot] of [
    [".cursor-plugin", "plugins"],
    [".CURSOR-PLUGIN", "plugins"],
    ["cursor-dist/.cursor-plugin", "cursor-dist"],
  ] as const) {
    it(`protects Cursor marketplace metadata from Claude bundle ${bundle}`, async () => {
      const root = await fixture(bundle, "plugins");
      const configPath = join(root, "skillset.yaml");
      await writeFile(configPath, (await readFile(configPath, "utf8")).replace(
        "cursor: false", `cursor:\n  plugins:\n    path: ${cursorRoot}`
      ));
      await expect(buildSkillsetResult(root)).rejects.toThrow(/(Cursor marketplace metadata|outputs\.plugins\.cursor)/);
      expect(await Bun.file(join(root, bundle, "skillset.lock")).exists()).toBe(false);
    });
  }
});

async function fixture(bundle: string | undefined, marketplaceRoot: string, sibling = false): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "skillset-bundle-roots-"));
  const files: Record<string, string> = {
    "skillset.yaml": `skillset:\n  name: bundles\nclaude:\n  plugins:\n    path: ${marketplaceRoot}\ncodex: false\ncursor: false\nmarketplaces:\n  local:\n    targets: [claude]\n    plugins:\n      - plugin: trails\n`,
    ".skillset/plugins/trails/skillset.yaml": bundle === undefined
      ? "skillset:\n  name: trails\n"
      : `skillset:\n  name: trails\nclaude:\n  bundle:\n    path: ${bundle}\n`,
    ".skillset/plugins/trails/skills/hike/SKILL.md": "---\nname: hike\ndescription: Plan a hike.\n---\n\nHike.\n",
  };
  if (sibling) {
    files[".skillset/plugins/basecamp/skillset.yaml"] = "skillset:\n  name: basecamp\n";
    files[".skillset/plugins/basecamp/skills/rest/SKILL.md"] = "---\nname: rest\ndescription: Rest at basecamp.\n---\n\nRest.\n";
  }
  for (const [path, content] of Object.entries(normalizeSkillsetFixtureFiles(files))) {
    await Bun.write(join(root, path), content);
  }
  return root;
}
