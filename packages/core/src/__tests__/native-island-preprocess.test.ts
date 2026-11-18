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
