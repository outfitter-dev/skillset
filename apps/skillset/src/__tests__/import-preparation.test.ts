import { expect, test } from "bun:test";
import { mkdir, readFile, readdir, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createTestFixtureRoot } from "../../../../scripts/test-helpers/fixture-root";
import { prepareImportSource } from "../import";

async function fixture() {
  const root = await createTestFixtureRoot("skillset-import-preparation-");
  const sourcePath = join(root, ".claude/skills/demo");
  await mkdir(sourcePath, { recursive: true });
  await writeFile(join(sourcePath, "SKILL.md"), "---\nname: demo\ndescription: Demo.\n---\n\nOriginal.\n");
  return { root, sourcePath };
}

test("preparing an import leaves config, source and release state untouched", async () => {
  const { root, sourcePath } = await fixture();
  const prepared = await prepareImportSource({ rootPath: root, sourcePath, kind: "skill", provider: "claude" });
  try {
    expect(await readdir(root)).toEqual([".claude"]);
    expect(await readFile(join(prepared.stagingPath, "SKILL.md"), "utf8")).toContain("Original.");
    expect(prepared.targetPath).toBe(join(root, ".skillset/skills/demo"));
  } finally {
    await prepared.dispose();
  }
  expect(await readdir(root)).toEqual([".claude"]);
  await expect(readFile(join(prepared.stagingPath, "SKILL.md"))).rejects.toThrow();
});

test("commit imports the prepared bytes and retains original provenance", async () => {
  const { root, sourcePath } = await fixture();
  const prepared = await prepareImportSource({ rootPath: root, sourcePath, kind: "skill", provider: "claude", sourceOrigin: () => ({ path: ".claude/skills/demo/SKILL.md" }) });
  try {
    await writeFile(join(sourcePath, "SKILL.md"), "Changed after preparation.");
    const report = await prepared.commit();
    expect(report.sourcePath).toBe(sourcePath);
    const content = await readFile(join(report.targetPath, "SKILL.md"), "utf8");
    expect(content).toContain("Original.");
    expect(content).toContain(".claude/skills/demo/SKILL.md");
    expect(content).not.toContain(prepared.stagingPath);
    await expect(prepared.commit()).rejects.toThrow("already");
  } finally {
    await prepared.dispose();
  }
});

test("a destination appearing after preparation is preserved", async () => {
  const { root, sourcePath } = await fixture();
  const prepared = await prepareImportSource({ rootPath: root, sourcePath, kind: "skill" });
  try {
    await mkdir(prepared.targetPath, { recursive: true });
    await writeFile(join(prepared.targetPath, "keep"), "winner");
    await expect(prepared.commit()).rejects.toThrow();
    expect(await readdir(prepared.targetPath)).toEqual(["keep"]);
    expect(await readFile(join(prepared.targetPath, "keep"), "utf8")).toBe("winner");
  } finally {
    await prepared.dispose();
  }
});

test("plugin preparation retains logical paths while isolating native hooks", async () => {
  const root = await createTestFixtureRoot("skillset-plugin-preparation-");
  await mkdir(join(root, ".claude-plugin"));
  await mkdir(join(root, "hooks"));
  await writeFile(join(root, ".claude-plugin/plugin.json"), JSON.stringify({ name: "demo", version: "1.2.3" }));
  await writeFile(join(root, "hooks/hooks.json"), JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: "command", command: "echo ready" }] }] } }));
  const before = await readdir(root);
  const prepared = await prepareImportSource({ rootPath: root, sourcePath: root, kind: "plugin", provider: "claude", sourceOrigin: (_source, file) => ({ path: file ?? "." }) });
  try {
    expect(await readdir(root)).toEqual(before);
    const report = await prepared.commit();
    expect(report.sourcePath).toBe(root);
    expect(report.targetPath).toBe(join(root, ".skillset/plugins/demo"));
    expect(report.nativeHookSources?.[0]?.path).toBe(".skillset/plugins/demo/_claude/hooks/hooks.json");
    expect(JSON.stringify(report)).not.toContain(prepared.stagingPath);
    expect(await readFile(join(report.targetPath, "_claude/hooks/hooks.json"), "utf8")).toContain("echo ready");
    expect(await readFile(join(root, "hooks/hooks.json"), "utf8")).toContain("echo ready");
  } finally {
    await prepared.dispose();
  }
});

for (const component of [".skillset/skills/demo", ".skillset/skills", ".skillset/skills/demo/SKILL.md"]) {
  test(`prepared merge refuses symlink ${component} before reading its contents`, async () => {
    const { root, sourcePath } = await fixture();
    const outside = await createTestFixtureRoot("skillset-import-outside-");
    const prepared = await prepareImportSource({ rootPath: root, sourcePath, kind: "skill", mergeTargetNativeSkill: true });
    try {
      const link = join(root, component);
      const parent = component.slice(0, component.lastIndexOf("/"));
      await mkdir(join(root, parent), { recursive: true });
      await mkdir(join(outside, "demo"));
      const malformed = "---\nname: [unclosed\n---\n";
      await writeFile(join(outside, "SKILL.md"), malformed);
      await writeFile(join(outside, "demo/SKILL.md"), malformed);
      await symlink(component.endsWith("SKILL.md") ? join(outside, "SKILL.md") : outside, link);
      await expect(prepared.commit()).rejects.toThrow("symbolic link");
      expect(await readFile(join(outside, "SKILL.md"), "utf8")).toBe(malformed);
    } finally {
      await prepared.dispose();
    }
  });
}
