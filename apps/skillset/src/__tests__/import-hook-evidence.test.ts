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
