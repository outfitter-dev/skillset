import { expect, test } from "bun:test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createTestFixtureRoot } from "../../../../scripts/test-helpers/fixture-root";
import { buildSkillset } from "../build";

const body = "---\nname: demo\ndescription: Argument boundary.\n---\nRun {{$ARGUMENTS.topic}}.\n";

test("a Claude named argument failure writes no planned outputs and preserves source", async () => {
  const root = await createTestFixtureRoot("skillset-named-build-");
  const sourcePath = join(root, ".skillset/skills/demo/SKILL.md");
  await mkdir(dirname(sourcePath), { recursive: true });
  await writeFile(sourcePath, body);
  const configPath = join(root, "skillset.yaml");
  await writeFile(configPath, "skillset:\n  name: arguments-test\nclaude: true\ncodex: false\ncursor: false\n");
  await expect(buildSkillset(root)).rejects.toThrow("named prompt argument");
  expect(await readFile(sourcePath, "utf8")).toBe(body);
  expect(await Bun.file(join(root, ".claude/skills/demo/SKILL.md")).exists()).toBe(false);
  expect(await Bun.file(join(root, ".agents/skills/demo/SKILL.md")).exists()).toBe(false);
  await writeFile(configPath, "skillset:\n  name: arguments-test\nclaude: false\ncodex: true\ncursor: true\n");
  await buildSkillset(root);
  const baseline = await readFile(join(root, ".agents/skills/demo/SKILL.md"), "utf8");
  expect(baseline).toContain("Run {{$ARGUMENTS.topic}}.");
  expect(baseline).toContain("Before using commands");
  const cursor = await readFile(join(root, ".cursor/skills/demo/SKILL.md"), "utf8");
  expect(cursor).toContain("Run {{$ARGUMENTS.topic}}.");
  expect(cursor).not.toContain("Before using commands");
});

test("shared plugin skills reject enabled Claude but preserve portable named markers", async () => {
  const root = await createTestFixtureRoot("skillset-named-plugin-");
  const sourcePath = join(root, ".skillset/plugins/demo/skills/demo/SKILL.md");
  await mkdir(dirname(sourcePath), { recursive: true });
  await writeFile(sourcePath, body);
  await writeFile(join(root, "skillset.yaml"), "skillset:\n  name: arguments-test\nclaude: true\ncodex: false\ncursor: false\n");
  await writeFile(join(root, ".skillset/plugins/demo/skillset.yaml"), "skillset:\n  name: demo\n");
  await expect(buildSkillset(root)).rejects.toThrow("named prompt argument");
  expect(await Bun.file(join(root, "plugins/demo/skills/demo/SKILL.md")).exists()).toBe(false);
  await writeFile(join(root, "skillset.yaml"), "skillset:\n  name: arguments-test\nclaude: false\ncodex: true\ncursor: true\n");
  await buildSkillset(root);
  const output = await readFile(join(root, "plugins/demo/skills/demo/SKILL.md"), "utf8");
  expect(output).toContain("Run {{$ARGUMENTS.topic}}.");
  expect(output).not.toContain("Before using commands");
});
