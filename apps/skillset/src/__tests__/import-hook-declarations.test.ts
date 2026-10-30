import { expect, test } from "bun:test";
import { lstat, readFile } from "node:fs/promises";
import { join } from "node:path";
import { createTestFixtureRoot } from "../../../../scripts/test-helpers/fixture-root";
import { importSource } from "../import";

const inline = { SessionStart: [{ hooks: [{ type: "command", command: "echo preserved" }] }] };
for (const [name, hooks] of Object.entries({ path: "./config/extra-hooks.json", inline, mixed: ["./config/extra-hooks.json", inline] })) {
  for (const hasDefault of [true, false]) {
    test(`rejects unpreserved ${name} hook declaration before claim (default: ${hasDefault})`, async () => {
      const root = await createTestFixtureRoot("skillset-hook-declarations-");
      const sourcePath = join(root, "original");
      const manifest = JSON.stringify({ name: "native-hooks", hooks });
      const extra = '{"hooks":{"SessionStart":[]}}\r\n';
      await Bun.write(join(sourcePath, ".claude-plugin/plugin.json"), manifest);
      await Bun.write(join(sourcePath, "config/extra-hooks.json"), extra);
      if (hasDefault) await Bun.write(join(sourcePath, "hooks/hooks.json"), extra);
      let claimed = false;
      await expect(importSource({
        rootPath: root, sourcePath, kind: "plugin", provider: "cursor",
        testHooks: { beforeClaim: async () => { claimed = true; } },
      })).rejects.toThrow("additional Claude hook declarations require explicit source configuration");
      expect(claimed).toBe(false);
      expect(await lstat(join(root, ".skillset/plugins/native-hooks")).catch(() => undefined)).toBeUndefined();
      expect(await readFile(join(sourcePath, ".claude-plugin/plugin.json"), "utf8")).toBe(manifest);
      expect(await readFile(join(sourcePath, "config/extra-hooks.json"), "utf8")).toBe(extra);
      if (hasDefault) expect(await readFile(join(sourcePath, "hooks/hooks.json"), "utf8")).toBe(extra);
    });
  }
}

test("explicit default declaration remains supported", async () => {
  const root = await createTestFixtureRoot("skillset-hook-default-declaration-");
  const sourcePath = join(root, "original");
  await Bun.write(join(sourcePath, ".claude-plugin/plugin.json"), JSON.stringify({ name: "native-hooks", hooks: "./hooks/hooks.json" }));
  await Bun.write(join(sourcePath, "hooks/hooks.json"), '{"hooks":{}}');
  const report = await importSource({ rootPath: root, sourcePath, kind: "plugin", provider: "claude" });
  expect(report.nativeHookSources?.[0]?.path).toBe(".skillset/plugins/native-hooks/_claude/hooks/hooks.json");
});

test("existing canonical source configuration remains authoritative", async () => {
  const root = await createTestFixtureRoot("skillset-hook-authored-declaration-");
  const sourcePath = join(root, "original");
  const config = "skillset:\n  name: native-hooks\nclaude:\n  manifest:\n    hooks: ./config/extra-hooks.json\n";
  await Bun.write(join(sourcePath, "skillset.yaml"), config);
  await Bun.write(join(sourcePath, ".claude-plugin/plugin.json"), JSON.stringify({ name: "native-hooks", hooks: "./config/extra-hooks.json" }));
  await Bun.write(join(sourcePath, "config/extra-hooks.json"), '{"hooks":{}}');
  const report = await importSource({ rootPath: root, sourcePath, kind: "plugin", provider: "claude" });
  expect(await readFile(join(report.targetPath, "skillset.yaml"), "utf8")).toBe(config);
});
