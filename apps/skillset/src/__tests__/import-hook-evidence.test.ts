import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createTestFixtureRoot } from "../../../../scripts/test-helpers/fixture-root";
import { importSource } from "../import";

for (const selection of [{ provider: "cursor" as const }, { providers: ["codex" as const] }]) {
  test(`native hook diagnostics honor explicit provider selection ${JSON.stringify(selection)}`, async () => {
    const root = await createTestFixtureRoot("skillset-import-hook-evidence-");
    const sourcePath = join(root, "original");
    await Bun.write(join(sourcePath, ".claude-plugin/plugin.json"), '{"name":"native-hooks"}\n');
    const hooks = JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: "command", command: '"${CLAUDE_PLUGIN_ROOT}"/check.sh' }] }] } }, null, 2);
    await Bun.write(join(sourcePath, "hooks/hooks.json"), hooks);
    const report = await importSource({ ...selection, rootPath: root, sourcePath, kind: "plugin" });
    const results = report.renderResults.filter((item) => item.featureId === "plugin-hooks");
    expect(results.map((item) => item.target)).toEqual(selection.providers ?? [selection.provider!]);
    expect(results[0]).toMatchObject({
      status: "target_native",
      diagnostics: [expect.objectContaining({ code: "import-native-hook-runtime-unverified", message: expect.stringContaining("command runtime semantics have not been verified") })],
    });
    expect(await readFile(join(sourcePath, "hooks/hooks.json"), "utf8")).toBe(hooks);
    expect(await readFile(join(report.targetPath, "hooks/hooks.json"), "utf8")).toBe(hooks);
  });
}

test("hook source carries the importer's per-file provenance without reconstructing it", async () => {
  const root = await createTestFixtureRoot("skillset-import-hook-origin-");
  const sourcePath = join(root, "prepared");
  await Bun.write(join(sourcePath, ".claude-plugin/plugin.json"), '{"name":"native-hooks"}\n');
  await Bun.write(join(sourcePath, "hooks/hooks.json"), '{"hooks":{"SessionStart":[{"hooks":[{"type":"command","command":"echo original"}]}]}}');
  const origin = { path: "actual-provider-root/hooks/hooks.json", repo: "https://example.com/source.git", ref: "a".repeat(40) };
  const report = await importSource({
    rootPath: root, sourcePath, kind: "plugin", provider: "claude",
    sourceOrigin: (_path, file) => file === "hooks/hooks.json" ? origin : { path: "canonical-plugin" },
  });
  expect(report.nativeHookSource).toEqual({ path: ".skillset/plugins/native-hooks/hooks/hooks.json", targets: ["claude"], origin });
});

test("empty hook groups retain explicit assessment targets without emitted diagnostics", async () => {
  const root = await createTestFixtureRoot("skillset-import-empty-hook-");
  const sourcePath = join(root, "original");
  await Bun.write(join(sourcePath, ".claude-plugin/plugin.json"), '{"name":"native-hooks"}\n');
  await Bun.write(join(sourcePath, "hooks/hooks.json"), '{"hooks":{"SessionStart":[]}}');
  const report = await importSource({ rootPath: root, sourcePath, kind: "plugin", providers: ["cursor"] });
  expect(report.nativeHookSource?.targets).toEqual(["cursor"]);
  expect(report.renderResults.filter((result) => result.featureId === "plugin-hooks")).toEqual([]);
});
