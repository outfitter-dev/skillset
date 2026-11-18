import { expect, test } from "bun:test";
import { lstat, readFile, symlink } from "node:fs/promises";
import { join } from "node:path";
import { buildSkillsetResult } from "@skillset/core";
import { recordImportedFindings } from "@skillset/core/internal/adoption-findings";
import { createTestFixtureRoot } from "../../../../scripts/test-helpers/fixture-root";
import { importSource } from "../import";

const eventMap = { SessionStart: [{ hooks: [{ type: "command", command: 'echo "{{skillset.source_path}}"' }] }] };
const rawHooks = JSON.stringify({ hooks: eventMap }, null, 2).replaceAll("\n", "\r\n") + "\r\n";

for (const withDefault of [true, false]) {
  test(`preserves additional files and inline declaration order (default: ${withDefault})`, async () => {
    const root = await createTestFixtureRoot("skillset-hook-preservation-");
    const sourcePath = join(root, "original");
    const hooks = ["./config/extra-hooks.json", eventMap, "./config/extra-hooks.json", eventMap];
    const manifest = JSON.stringify({ name: "native-hooks", hooks });
    await Bun.write(join(root, "skillset.yaml"), "compile:\n  targets: [claude, codex, cursor]\n");
    await Bun.write(join(sourcePath, ".claude-plugin/plugin.json"), manifest);
    await Bun.write(join(sourcePath, "config/extra-hooks.json"), rawHooks);
    if (withDefault) await Bun.write(join(sourcePath, "hooks/hooks.json"), rawHooks);
    const imported = await importSource({ rootPath: root, sourcePath, kind: "plugin", provider: "claude",
      sourceOrigin: (_root, path) => ({ path: `upstream/${path}`, repo: "https://example.test/hooks.git", ref: "immutable-ref" }),
    });
    expect(imported.nativeHookSources?.map((source) => source.path)).toEqual([
      ".skillset/plugins/native-hooks/.claude-plugin/plugin.json",
      ".skillset/plugins/native-hooks/_claude/config/extra-hooks.json",
      ...(withDefault ? [".skillset/plugins/native-hooks/_claude/hooks/hooks.json"] : []),
    ]);
    const findings = await recordImportedFindings(root, { nativeHooks: imported.nativeHookSources ?? [] });
    expect(findings.flags).toHaveLength(withDefault ? 4 : 3);
    const inlineFlags = findings.flags.filter((flag) => flag.source.path.endsWith(".claude-plugin/plugin.json"));
    expect(new Set(inlineFlags.map((flag) => flag.id)).size).toBe(2);
    for (const index of [1, 3]) expect(inlineFlags.some((flag) => flag.evidence.some((item) => item.summary.includes(`#/hooks/${index}/SessionStart/0`)))).toBe(true);
    expect(findings.flags.every((flag) => flag.evidence.some((item) => item.reference === "https://example.test/hooks.git"))).toBe(true);
    expect(findings.flags.every((flag) => flag.origin?.path.startsWith("upstream/"))).toBe(true);
    expect(imported.renderResults.some((result) => result.diagnostics?.some((item) => item.path?.includes("#/hooks/1/SessionStart/0")))).toBe(true);
    expect((await buildSkillsetResult(root)).ok).toBe(true);
    const output = join(root, "plugins/native-hooks");
    expect((await Bun.file(join(output, ".claude-plugin/plugin.json")).json()).hooks).toEqual(hooks);
    expect(await readFile(join(output, "config/extra-hooks.json"), "utf8")).toBe(rawHooks);
    expect(await Bun.file(join(output, ".cursor-plugin/hooks.json")).exists()).toBe(false);
    expect((await Bun.file(join(output, ".cursor-plugin/plugin.json")).json()).hooks).toEqual(withDefault ? {} : undefined);
    expect((await Bun.file(join(output, "plugin.json")).json()).extensions?.["com.openai"]?.hooks).toBeUndefined();
    expect(await readFile(join(sourcePath, ".claude-plugin/plugin.json"), "utf8")).toBe(manifest);
    expect(await readFile(join(sourcePath, "config/extra-hooks.json"), "utf8")).toBe(rawHooks);
  });
}

test("inline-only hooks stay in the generated Claude manifest and raw source sidecar", async () => {
  const root = await createTestFixtureRoot("skillset-inline-hooks-");
  const sourcePath = join(root, "original");
  await Bun.write(join(root, "skillset.yaml"), "compile:\n  targets: [claude, codex, cursor]\n");
  await Bun.write(join(sourcePath, ".claude-plugin/plugin.json"), JSON.stringify({ name: "native-hooks", hooks: eventMap }));
  const imported = await importSource({ rootPath: root, sourcePath, kind: "plugin", provider: "claude" });
  expect(imported.nativeHookSources).toEqual([{ path: ".skillset/plugins/native-hooks/.claude-plugin/plugin.json", targets: ["claude"], providers: ["claude"], pointers: ["/hooks"] }]);
  expect((await buildSkillsetResult(root)).ok).toBe(true);
  expect((await Bun.file(join(root, "plugins/native-hooks/.claude-plugin/plugin.json")).json()).hooks).toEqual(eventMap);
  expect(await Bun.file(join(root, "plugins/native-hooks/hooks/hooks.json")).exists()).toBe(false);
});

for (const path of ["../escape.json", "./../escape.json", "./missing.json", "./config/not-json.md", "./plugin.json"]) {
  test(`rejects unusable hook path before claim: ${path}`, async () => {
    const root = await createTestFixtureRoot("skillset-hook-path-rejection-");
    const sourcePath = join(root, "original");
    const manifest = JSON.stringify({ name: "native-hooks", hooks: path });
    await Bun.write(join(sourcePath, ".claude-plugin/plugin.json"), manifest);
    let claimed = false;
    await expect(importSource({ rootPath: root, sourcePath, kind: "plugin", provider: "claude", testHooks: { beforeClaim: async () => { claimed = true; } } })).rejects.toThrow();
    expect(claimed).toBe(false);
    expect(await lstat(join(root, ".skillset/plugins/native-hooks")).catch(() => undefined)).toBeUndefined();
    expect(await readFile(join(sourcePath, ".claude-plugin/plugin.json"), "utf8")).toBe(manifest);
  });
}

for (const conflict of ["island", "dual-provider", "symlink", "directory"] as const) {
  test(`unsafe additional source fails before claim: ${conflict}`, async () => {
    const root = await createTestFixtureRoot("skillset-hook-scope-conflict-");
    const sourcePath = join(root, "original");
    const manifest = JSON.stringify({ name: "native-hooks", hooks: "./config/extra.json" });
    await Bun.write(join(sourcePath, ".claude-plugin/plugin.json"), manifest);
    if (conflict === "directory") await Bun.write(join(sourcePath, "config/extra.json/keep"), "keep");
    else if (conflict === "symlink") {
      await Bun.write(join(sourcePath, "config/real.json"), rawHooks);
      await symlink("real.json", join(sourcePath, "config/extra.json"));
    } else await Bun.write(join(sourcePath, "config/extra.json"), rawHooks);
    if (conflict === "island") await Bun.write(join(sourcePath, "_claude/config/extra.json"), "keep");
    if (conflict === "dual-provider") await Bun.write(join(sourcePath, ".cursor-plugin/plugin.json"), '{"name":"native-hooks"}');
    let claimed = false;
    await expect(importSource({ rootPath: root, sourcePath, kind: "plugin", provider: "claude", testHooks: { beforeClaim: async () => { claimed = true; } } })).rejects.toThrow();
    expect(claimed).toBe(false);
    expect(await readFile(join(sourcePath, ".claude-plugin/plugin.json"), "utf8")).toBe(manifest);
  });
}

test("additional config under hooks moves once with opaque companions and keeps runtime reads", async () => {
  const root = await createTestFixtureRoot("skillset-hook-overlap-");
  const sourcePath = join(root, "original");
  const command = 'cat "$CLAUDE_PLUGIN_ROOT/hooks/message.md" "$CLAUDE_PLUGIN_ROOT/hooks/extra.json"';
  const hooks = { hooks: { SessionStart: [{ hooks: [{ type: "command", command }] }] } };
  const json = JSON.stringify(hooks);
  const message = "---\r\nskillset:\r\n  preprocess: true\r\n---\r\n{{skillset.source_path}}\r\n";
  await Bun.write(join(root, "skillset.yaml"), "compile:\n  targets: [claude, codex, cursor]\n");
  await Bun.write(join(sourcePath, ".claude-plugin/plugin.json"), '{"name":"native-hooks","hooks":["./hooks/extra.json","./hooks/./extra.json"]}');
  await Bun.write(join(sourcePath, "hooks/hooks.json"), rawHooks);
  await Bun.write(join(sourcePath, "hooks/extra.json"), json);
  await Bun.write(join(sourcePath, "hooks/message.md"), message);
  const imported = await importSource({ rootPath: root, sourcePath, kind: "plugin", provider: "claude" });
  expect(imported.nativeHookSources).toHaveLength(2);
  expect((await buildSkillsetResult(root)).ok).toBe(true);
  const output = join(root, "plugins/native-hooks");
  const child = Bun.spawn(["sh", "-c", command], { env: { ...process.env, CLAUDE_PLUGIN_ROOT: output }, stdout: "pipe", stderr: "pipe" });
  expect(await new Response(child.stdout).text()).toBe(message + json);
  expect(await child.exited).toBe(0);
});

for (const content of [rawHooks, "{ malformed JSON"]) {
  test(`inferred Claude ownership preserves a path-only declaration: ${content === rawHooks ? "valid" : "malformed"}`, async () => {
    const root = await createTestFixtureRoot("skillset-hook-path-only-");
    const sourcePath = join(root, "original");
    await Bun.write(join(root, "skillset.yaml"), "compile:\n  targets: [claude, codex, cursor]\n");
    await Bun.write(join(sourcePath, ".claude-plugin/plugin.json"), '{"name":"native-hooks","hooks":"./config//extra.json"}');
    await Bun.write(join(sourcePath, "config/extra.json"), content);
    const imported = await importSource({ rootPath: root, sourcePath, kind: "plugin" });
    expect(imported.nativeHookSources?.[0]?.path).toBe(".skillset/plugins/native-hooks/_claude/config/extra.json");
    if (content !== rawHooks) expect(imported.renderResults.some((result) => result.diagnostics?.some((item) => item.code === "import-native-hook-lift-unclassified"))).toBe(true);
    expect((await buildSkillsetResult(root)).ok).toBe(true);
    expect((await Bun.file(join(root, "plugins/native-hooks/.claude-plugin/plugin.json")).json()).hooks).toBe("./config//extra.json");
    expect(await readFile(join(root, "plugins/native-hooks/config/extra.json"), "utf8")).toBe(content);
  });
}
