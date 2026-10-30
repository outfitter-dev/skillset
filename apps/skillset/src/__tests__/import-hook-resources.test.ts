import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { buildSkillsetResult } from "@skillset/core";
import { createTestFixtureRoot } from "../../../../scripts/test-helpers/fixture-root";
import { importSource } from "../import";

for (const nested of [false, true]) {
  test(`custom hook directory preserves opaque runtime companions (nested: ${nested})`, async () => {
    const root = await createTestFixtureRoot("skillset-hook-resources-");
    const sourcePath = join(root, "original");
    const command = 'cat "$CLAUDE_PLUGIN_ROOT/config/settings.json" "$CLAUDE_PLUGIN_ROOT/config/message.md"';
    const json = JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: "command", command }] }] } });
    const settings = '{"literal":"{{skillset.source_path}}"}\r\n';
    const message = '---\r\nskillset:\r\n  preprocess: true\r\n---\r\n{{skillset.source_path}}\r\n';
    const hooks = nested ? ["./config/sub/extra.json", "./config/extra.json", "./config/extra.json"] : "./config/extra.json";
    await Bun.write(join(root, "skillset.yaml"), "compile:\n  targets: [claude, codex, cursor]\n");
    await Bun.write(join(sourcePath, ".claude-plugin/plugin.json"), JSON.stringify({ name: "native-hooks", hooks }));
    await Bun.write(join(sourcePath, "config/extra.json"), json);
    if (nested) await Bun.write(join(sourcePath, "config/sub/extra.json"), json);
    await Bun.write(join(sourcePath, "config/settings.json"), settings);
    await Bun.write(join(sourcePath, "config/message.md"), message);
    await importSource({ rootPath: root, sourcePath, kind: "plugin", provider: "claude" });
    expect((await buildSkillsetResult(root)).ok).toBe(true);
    const output = join(root, "plugins/native-hooks");
    const child = Bun.spawn(["sh", "-c", command], { env: { ...process.env, CLAUDE_PLUGIN_ROOT: output }, stdout: "pipe", stderr: "pipe" });
    expect(await new Response(child.stdout).text()).toBe(settings + message);
    expect(await child.exited).toBe(0);
    expect(await readFile(join(sourcePath, "config/message.md"), "utf8")).toBe(message);
    expect((await buildSkillsetResult(root)).ok).toBe(true);
    expect(await readFile(join(output, "config/message.md"), "utf8")).toBe(message);
  });
}

for (const path of ["extra.json", "skills/demo/extra.json", "agents/extra.json", "shared/extra.json", "subagents/extra.json", "config/extra.json"]) {
  test(`refuses unsafe hook resource directory before claim: ${path}`, async () => {
    const root = await createTestFixtureRoot("skillset-hook-resource-conflict-");
    const sourcePath = join(root, "original");
    await Bun.write(join(sourcePath, ".claude-plugin/plugin.json"), JSON.stringify({ name: "native-hooks", hooks: `./${path}` }));
    await Bun.write(join(sourcePath, path), '{"hooks":{}}');
    if (path === "config/extra.json") await Bun.write(join(sourcePath, "_claude/config/keep.md"), "keep");
    let claimed = false;
    await expect(importSource({ rootPath: root, sourcePath, kind: "plugin", provider: "claude", testHooks: { beforeClaim: async () => { claimed = true; } } })).rejects.toThrow(path === "config/extra.json" ? "native hook isolation would overwrite" : "native hook resource directory");
    expect(claimed).toBe(false);
    expect(await readFile(join(sourcePath, path), "utf8")).toBe('{"hooks":{}}');
  });
}
