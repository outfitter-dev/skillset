import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { buildSkillsetResult } from "@skillset/core";
import { createTestFixtureRoot } from "../../../../scripts/test-helpers/fixture-root";
import { importSource } from "../import";

const nativePath = "_claude/hooks/hooks.json";

test("Claude native hooks keep bytes and runtime roots without cross-provider hook outputs", async () => {
  const root = await createTestFixtureRoot("skillset-import-hook-boundary-");
  const sourcePath = join(root, "original");
  await Bun.write(join(root, "skillset.yaml"), "compile:\n  targets: [claude, codex, cursor]\n");
  await Bun.write(join(sourcePath, ".claude-plugin/plugin.json"), '{"name":"native-hooks"}\n');
  const hooks = '{"hooks":{"SessionStart":[{"hooks":[{"type":"command","command":"\\\"${CLAUDE_PLUGIN_ROOT}\\\"/scripts/check.sh"}]}]}}\n';
  const script = '#!/bin/sh\ncat "$CLAUDE_PLUGIN_ROOT/hooks/hooks.json"\n';
  await Bun.write(join(sourcePath, "hooks/hooks.json"), hooks);
  await Bun.write(join(sourcePath, "scripts/check.sh"), script);
  await Bun.write(join(sourcePath, "hooks/helper.sh"), script);
  const imported = await importSource({ rootPath: root, sourcePath, kind: "plugin", provider: "claude" });
  expect(imported.nativeHookSource?.path).toBe(`.skillset/plugins/native-hooks/${nativePath}`);
  expect(imported.copiedFiles).toContain(nativePath);
  expect(imported.copiedFiles).not.toContain("hooks/hooks.json");
  expect(await readFile(join(sourcePath, "hooks/hooks.json"), "utf8")).toBe(hooks);
  expect(await readFile(join(imported.targetPath, nativePath), "utf8")).toBe(hooks);
  expect(imported.renderResults.some((result) => result.diagnostics?.some((item) => item.code === "import-native-hook-provider-scoped"))).toBe(true);
  const build = await buildSkillsetResult(root);
  expect(build.ok).toBe(true);
  const output = join(root, "plugins/native-hooks");
  expect(await readFile(join(output, "hooks/hooks.json"), "utf8")).toBe(hooks);
  expect(await readFile(join(output, "scripts/check.sh"), "utf8")).toBe(script);
  expect(await readFile(join(output, "hooks/helper.sh"), "utf8")).toBe(script);
  const child = Bun.spawn(["sh", join(output, "scripts/check.sh")], {
    env: { ...process.env, CLAUDE_PLUGIN_ROOT: output }, stdout: "pipe", stderr: "pipe",
  });
  expect(await new Response(child.stdout).text()).toBe(hooks);
  expect(await child.exited).toBe(0);
  expect(await Bun.file(join(output, "hooks/hooks.json")).exists()).toBe(true);
  expect(await Bun.file(join(output, ".cursor-plugin/hooks.json")).exists()).toBe(false);
  expect((await Bun.file(join(output, ".claude-plugin/plugin.json")).json()).hooks).toBeUndefined();
  expect((await Bun.file(join(output, ".cursor-plugin/plugin.json")).json()).hooks).toEqual({});
  expect((await Bun.file(join(output, "plugin.json")).json()).extensions?.["com.openai"]?.hooks).toBeUndefined();
});

for (const scenario of ["unknown", "multiple", "custom-declaration"] as const) {
  test(`hook scoping preserves unresolved ${scenario} source`, async () => {
    const root = await createTestFixtureRoot("skillset-hook-unresolved-");
    const sourcePath = join(root, "original");
    const hooks = '{"hooks":{"SessionStart":[]}}';
    await Bun.write(join(sourcePath, "hooks/hooks.json"), hooks);
    if (scenario !== "unknown") {
      await Bun.write(join(sourcePath, ".claude-plugin/plugin.json"), JSON.stringify({ name: "native-hooks", ...(scenario === "custom-declaration" ? { hooks: "./custom-hooks.json" } : {}) }));
    }
    const report = await importSource({
      rootPath: root, sourcePath, kind: "plugin", name: "native-hooks",
      ...(scenario === "multiple" ? { providers: ["claude", "codex"] as const } : {}),
    });
    expect(report.nativeHookSource?.path).toBe(".skillset/plugins/native-hooks/hooks/hooks.json");
    expect(await readFile(join(report.targetPath, "hooks/hooks.json"), "utf8")).toBe(hooks);
    expect(report.renderResults.some((result) => result.diagnostics?.some((item) => item.code === "import-native-hook-provider-scoped"))).toBe(false);
    expect(await Bun.file(join(report.targetPath, nativePath)).exists()).toBe(false);
  });
}

test("a native island collision fails before claiming source and preserves original files", async () => {
  const root = await createTestFixtureRoot("skillset-hook-island-collision-");
  const sourcePath = join(root, "original");
  await Bun.write(join(sourcePath, ".claude-plugin/plugin.json"), '{"name":"native-hooks"}');
  await Bun.write(join(sourcePath, "hooks/hooks.json"), '{"hooks":{}}');
  await Bun.write(join(sourcePath, "_claude/hooks/keep.sh"), "original");
  await expect(importSource({ rootPath: root, sourcePath, kind: "plugin", provider: "claude" })).rejects.toThrow("would overwrite _claude/hooks");
  expect(await Bun.file(join(root, ".skillset/plugins/native-hooks/skillset.yaml")).exists()).toBe(false);
  expect(await readFile(join(sourcePath, "_claude/hooks/keep.sh"), "utf8")).toBe("original");
});

test("Cursor authored inline hooks replace fallback while Claude island output keeps its path", async () => {
  const root = await createTestFixtureRoot("skillset-native-hook-discovery-");
  await Bun.write(join(root, "skillset.yaml"), "compile:\n  targets: [claude, codex, cursor]\n");
  await Bun.write(join(root, ".skillset/plugins/demo/skillset.yaml"), "skillset:\n  name: demo\ncursor:\n  manifest:\n    hooks:\n      afterFileEdit: []\n");
  const hooks = '{"hooks":{"SessionStart":[]}}\n';
  await Bun.write(join(root, ".skillset/plugins/demo/_claude/hooks/hooks.json"), hooks);
  const report = await buildSkillsetResult(root);
  expect(report.ok).toBe(true);
  expect((await Bun.file(join(root, "plugins/demo/.cursor-plugin/plugin.json")).json()).hooks).toEqual({ afterFileEdit: [] });
  expect(await readFile(join(root, "plugins/demo/hooks/hooks.json"), "utf8")).toBe(hooks);
});

test("malformed hook JSON reports scoping evidence as well as parse uncertainty", async () => {
  const root = await createTestFixtureRoot("skillset-hook-malformed-boundary-");
  const sourcePath = join(root, "original");
  await Bun.write(join(sourcePath, ".claude-plugin/plugin.json"), '{"name":"native-hooks"}');
  const original = "{ malformed JSON";
  await Bun.write(join(sourcePath, "hooks/hooks.json"), original);
  const report = await importSource({ rootPath: root, sourcePath, kind: "plugin", provider: "claude" });
  const codes = report.renderResults.flatMap((result) => result.diagnostics?.map((item) => item.code) ?? []);
  expect(codes).toContain("import-native-hook-lift-unclassified");
  expect(codes).toContain("import-native-hook-provider-scoped");
  expect(await readFile(join(report.targetPath, nativePath), "utf8")).toBe(original);
});
