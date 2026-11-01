import { expect, test } from "bun:test";
import { mkdir, readFile, readdir, rename, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createTestGitFixtureRoot, initializeTestGitRepository } from "../../../../scripts/test-helpers/git-remote";
import { buildSkillsetResult } from "../build";
import { updateMarketplaces } from "../marketplace-update";

for (const introduced of ["before preview", "after preview"] as const) {
  test(`marketplace update refuses a catalog parent symlink introduced ${introduced}`, async () => {
    const fixture = await createTestGitFixtureRoot("marketplace-containment-");
    const root = join(fixture, "workspace");
    const sentinel = join(fixture, "sentinel");
    await mkdir(sentinel);
    const files = {
      "skillset.yaml": "skillset:\n  name: catalog-root\ncompile:\n  targets: [claude]\n  session_start_hook: off\nmarketplaces:\n  team:\n    targets: [claude]\n    plugins:\n      - plugin: tools\n",
      ".skillset/plugins/tools/skillset.yaml": "skillset:\n  name: tools\n",
      ".skillset/plugins/tools/skills/demo/SKILL.md": "---\nname: demo\ndescription: Demo skill\n---\nUse this skill.\n",
    };
    for (const [path, content] of Object.entries(files)) await Bun.write(join(root, path), content);
    await initializeTestGitRepository(root, { disposableRoot: fixture });
    await buildSkillsetResult(root);
    const lock = await readFile(join(root, "skillset.lock"), "utf8");
    const catalog = join(root, ".claude-plugin");
    const original = await readFile(join(catalog, "marketplace.json"), "utf8");
    const redirect = async () => {
      await rename(catalog, join(fixture, "saved-catalog"));
      await writeFile(join(sentinel, "marketplace.json"), `${original} `);
      await symlink(sentinel, catalog, "dir");
    };
    if (introduced === "before preview") await redirect();
    const preview = await updateMarketplaces(root, { name: "team" });
    expect(preview.ok).toBe(true);
    if (preview.planHash === undefined) throw new Error("expected concrete marketplace plan");
    if (introduced === "after preview") await redirect();
    await expect(updateMarketplaces(root, { name: "team", write: true, expectedPlanHash: preview.planHash })).rejects.toThrow("symbolic link");
    expect(await readFile(join(sentinel, "marketplace.json"), "utf8")).toBe(`${original} `);
    expect(await readdir(sentinel)).toEqual(["marketplace.json"]);
    expect(await readFile(join(root, "skillset.lock"), "utf8")).toBe(lock);
    expect((await readdir(root)).filter((name) => name.startsWith(".skillset-marketplace-"))).toEqual([]);
  });
}
