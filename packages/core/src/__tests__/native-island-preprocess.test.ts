import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createTestFixtureRoot } from "../../../../scripts/test-helpers/fixture-root";
import { buildSkillsetResult } from "../build";

test("structured plugin islands preprocess by default and explicitly opaque output changes provenance", async () => {
  const root = await createTestFixtureRoot("skillset-island-preprocess-");
  const config = join(root, ".skillset/plugins/demo/skillset.yaml");
  await Bun.write(join(root, "skillset.yaml"), "compile:\n  targets: [claude]\n");
  await Bun.write(config, "skillset:\n  name: demo\n");
  const original = '{"root":"{{skillset.source_path}}"}\r\n';
  await Bun.write(join(root, ".skillset/plugins/demo/_claude/config.json"), original);
  expect((await buildSkillsetResult(root)).ok).toBe(true);
  expect(await Bun.file(join(root, "plugins/demo/config.json")).json()).toEqual({ root: ".skillset/plugins/demo/_claude/config.json" });
  const before = (await Bun.file(join(root, "plugins/skillset.lock")).json()).items.find((item: { kind: string }) => item.kind === "island");
  expect(before.validation).toBe("structured");
  await Bun.write(config, "skillset:\n  name: demo\n  preprocess: false\n");
  expect((await buildSkillsetResult(root)).ok).toBe(true);
  expect(await readFile(join(root, "plugins/demo/config.json"), "utf8")).toBe(original);
  const after = (await Bun.file(join(root, "plugins/skillset.lock")).json()).items.find((item: { kind: string }) => item.kind === "island");
  expect(after.validation).toBe("opaque-copy");
  expect(after.preprocessDependencies).toEqual([]);
  expect(after.sourceHash).not.toBe(before.sourceHash);
});

test("plugin structured opt-out does not alter Markdown's document-level preprocessing", async () => {
  const root = await createTestFixtureRoot("skillset-island-markdown-control-");
  await Bun.write(join(root, "skillset.yaml"), "compile:\n  targets: [claude]\n");
  await Bun.write(join(root, ".skillset/plugins/demo/skillset.yaml"), "skillset:\n  name: demo\n  preprocess: false\n");
  await Bun.write(join(root, ".skillset/plugins/demo/_claude/commands/demo.md"), "---\nskillset:\n  preprocess: true\n---\n\nRoot {{skillset.source_path}}.\n");
  expect((await buildSkillsetResult(root)).ok).toBe(true);
  const output = await readFile(join(root, "plugins/demo/commands/demo.md"), "utf8");
  expect(output).toContain("Root .skillset/plugins/demo/_claude/commands/demo.md.");
  expect(output).not.toContain("preprocess:");
});

test("declared hook directory opacity is bounded and changes Markdown provenance", async () => {
  const root = await createTestFixtureRoot("skillset-custom-hook-opacity-");
  const configPath = join(root, ".skillset/plugins/demo/skillset.yaml");
  const config = "skillset:\n  name: demo\n  preprocess: false\n";
  const original = "---\r\nskillset:\r\n  preprocess: true\r\n---\r\nRoot {{skillset.source_path}}.\r\n";
  await Bun.write(join(root, "skillset.yaml"), "compile:\n  targets: [claude]\n");
  await Bun.write(configPath, config);
  for (const path of ["config/message.md", "config-other/message.md"]) await Bun.write(join(root, ".skillset/plugins/demo/_claude", path), original);
  expect((await buildSkillsetResult(root)).ok).toBe(true);
  const before = (await Bun.file(join(root, "plugins/skillset.lock")).json()).items.find((item: { sourcePath: string }) => item.sourcePath.endsWith("/config/message.md"));
  await Bun.write(configPath, config + 'claude:\n  manifest:\n    hooks: ["./config/./extra.json"]\n');
  expect((await buildSkillsetResult(root)).ok).toBe(true);
  expect(await readFile(join(root, "plugins/demo/config/message.md"), "utf8")).toBe(original);
  expect(await readFile(join(root, "plugins/demo/config-other/message.md"), "utf8")).toContain("Root .skillset/plugins/demo/_claude/config-other/message.md.");
  const after = (await Bun.file(join(root, "plugins/skillset.lock")).json()).items.find((item: { sourcePath: string }) => item.sourcePath.endsWith("/config/message.md"));
  expect(after.validation).toBe("opaque-copy");
  expect(after.sourceHash).not.toBe(before.sourceHash);
});
