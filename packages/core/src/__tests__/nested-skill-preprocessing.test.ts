import { expect, test } from "bun:test";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { TARGET_NAMES } from "@skillset/schema";
import { createTestFixtureRoot } from "../../../../scripts/test-helpers/fixture-root";
import { buildSkillsetResult, diffSkillsetResult } from "../build";

async function fixture(plugin = false, targets: readonly string[] = TARGET_NAMES) {
  const root = await createTestFixtureRoot("nested-skill-preprocess-");
  const source = plugin ? ".skillset/plugins/demo/skills/example" : ".skillset/skills/example";
  await Bun.write(join(root, "skillset.yaml"), `compile:\n  targets: ${JSON.stringify(targets)}\n  session_start_hook: off\n  unsupportedDestination: warn\n${plugin ? "plugins:\n  internal_use:\n    skills:\n      demo: true\n" : ""}`);
  if (plugin) await Bun.write(join(root, ".skillset/plugins/demo/skillset.yaml"), "skillset:\n  name: demo\n  description: Demo package.\n");
  await Bun.write(join(root, source, "SKILL.md"), "---\nname: example\ndescription: Nested examples.\n---\n\n@{{shared:references/common.md}}\n");
  await Bun.write(join(root, source, "examples/walkthrough.md"), "---\ntitle: Walkthrough\n---\n\n{{> intro}}\n@{{shared:references/common.md}}\n");
  await Bun.write(join(root, ".skillset/shared/references/common.md"), "# Common\n");
  await Bun.write(join(root, ".skillset/shared/partials/intro.md"), "Shared introduction.\n");
  return { root, source };
}

for (const plugin of [false, true]) {
  test(`nested skill Markdown renders through every physical projection (plugin=${plugin})`, async () => {
    const { root, source } = await fixture(plugin);
    const result = await buildSkillsetResult(root);
    expect(result.ok).toBe(true);
    const roots = [".agents/skills/example", ".claude/skills/example", ".cursor/skills/example", ...(plugin ? ["plugins/demo/skills/example"] : [])];
    for (const output of roots) {
      const nested = await readFile(join(root, output, "examples/walkthrough.md"), "utf8");
      expect(nested).toContain("Shared introduction.");
      expect(nested).toContain("@../references/common.md");
      expect(nested).toContain("title: Walkthrough");
      expect(await readFile(join(root, output, "references/common.md"), "utf8")).toBe("# Common\n");
      expect(result.data.filter((file) => file.path === `${output}/references/common.md`)).toHaveLength(1);
    }
    const lockPath = plugin ? "plugins/skillset.lock" : ".agents/skills/skillset.lock";
    const lock = JSON.parse(await readFile(join(root, lockPath), "utf8"));
    const item = lock.items.find((entry: { sourcePath?: string }) => entry.sourcePath === `${source}/SKILL.md`);
    expect(item.preprocessDependencies).toContain(".skillset/shared/partials/intro.md");
    const previousHash = item.outputHash;
    await writeFile(join(root, ".skillset/shared/partials/intro.md"), "Updated introduction.\n");
    expect((await diffSkillsetResult(root)).data.changed.length).toBeGreaterThan(0);
    await buildSkillsetResult(root);
    const changed = JSON.parse(await readFile(join(root, lockPath), "utf8"));
    expect(changed.items.find((entry: { sourcePath?: string }) => entry.sourcePath === `${source}/SKILL.md`).outputHash).not.toBe(previousHash);
  });
}

test("portable-only skills preprocess nested files without enabling a provider", async () => {
  const { root } = await fixture(false, []);
  expect((await buildSkillsetResult(root)).ok).toBe(true);
  expect(await readFile(join(root, ".agents/skills/example/examples/walkthrough.md"), "utf8")).toContain("@../references/common.md");
  expect(await Bun.file(join(root, ".claude/skills/example/SKILL.md")).exists()).toBe(false);
});

test("nested explicit opt-out and non-Markdown bytes are preserved without implied copies", async () => {
  const { root, source } = await fixture();
  const literal = "---\r\nskillset:\r\n  preprocess: false\r\n---\r\n{{> missing}} @{{shared:references/missing.md}}\r\n";
  const binary = new Uint8Array([0, 255, 13, 10, 123, 123, 62, 125, 125]);
  await Bun.write(join(root, source, "examples/literal.md"), literal);
  await Bun.write(join(root, source, "assets/literal.bin"), binary);
  await Bun.write(join(root, source, "CHANGELOG.md"), "{{> missing-control}}\r\n");
  expect((await buildSkillsetResult(root)).ok).toBe(true);
  for (const output of [".agents/skills/example", ".claude/skills/example", ".cursor/skills/example"]) {
    expect(await readFile(join(root, output, "examples/literal.md"), "utf8")).toBe(literal);
    expect(new Uint8Array(await readFile(join(root, output, "assets/literal.bin")))).toEqual(binary);
    expect(await Bun.file(join(root, output, "references/missing.md")).exists()).toBe(false);
    expect(await Bun.file(join(root, output, "CHANGELOG.md")).exists()).toBe(false);
  }
});

test("two nested referrers share one implied resource and each uses its own relative path", async () => {
  const { root, source } = await fixture();
  await Bun.write(join(root, source, "examples/deep/other.md"), "@{{shared:assets/diagram.txt}}\n");
  await Bun.write(join(root, source, "references/other.md"), "@{{shared:assets/diagram.txt}}\n");
  await Bun.write(join(root, ".skillset/shared/assets/diagram.txt"), "diagram\n");
  const result = await buildSkillsetResult(root);
  expect(result.ok).toBe(true);
  const output = ".agents/skills/example";
  expect(await readFile(join(root, output, "examples/deep/other.md"), "utf8")).toBe("@../../assets/diagram.txt\n");
  expect(await readFile(join(root, output, "references/other.md"), "utf8")).toBe("@../assets/diagram.txt\n");
  expect(result.data.filter((file) => file.path === `${output}/assets/diagram.txt`)).toHaveLength(1);
});

test("nested preprocessing fails before any output when a declared partial is missing", async () => {
  const { root, source } = await fixture();
  await Bun.write(join(root, source, "examples/broken.md"), "{{> missing}}\n");
  await expect(buildSkillsetResult(root)).rejects.toThrow("examples/broken.md");
  expect(await Bun.file(join(root, ".agents/skills/example/SKILL.md")).exists()).toBe(false);
});

test("nested BOM opt-out preserves original bytes and active frontmatter stays verbatim", async () => {
  const { root, source } = await fixture();
  const literal = "\uFEFF---\r\nskillset: { preprocess: false }\r\n---\r\n{{> absent}}\r\n";
  const prefix = "\uFEFF---\r\n# authored comment\r\ntitle: 'Example'\r\n---\r\n";
  await Bun.write(join(root, source, "examples/bom.md"), literal);
  await Bun.write(join(root, source, "examples/active.md"), `${prefix}{{> intro}}\r\n`);
  expect((await buildSkillsetResult(root)).ok).toBe(true);
  expect(await readFile(join(root, ".agents/skills/example/examples/bom.md"), "utf8")).toBe(literal);
  expect(await readFile(join(root, ".agents/skills/example/examples/active.md"), "utf8")).toBe(`${prefix}Shared introduction.\n\n`);
});

test("invalid nested frontmatter fails with its source path before output", async () => {
  const { root, source } = await fixture();
  await Bun.write(join(root, source, "examples/bad.md"), "---\ntitle: [\n---\ntext\n");
  await expect(buildSkillsetResult(root)).rejects.toThrow("examples/bad.md");
  expect(await Bun.file(join(root, ".agents/skills/example/SKILL.md")).exists()).toBe(false);
});

test("nested ordinary resource links honor custom destination and referrer directory", async () => {
  const { root, source } = await fixture();
  await Bun.write(join(root, source, "SKILL.md"), "---\nname: example\ndescription: Example.\nresources:\n  references:\n    - from: shared:references/common.md\n      to: references/renamed.md\n---\nBody\n");
  await Bun.write(join(root, source, "examples/walkthrough.md"), "[Common](shared:references/common.md)\n");
  expect((await buildSkillsetResult(root)).ok).toBe(true);
  expect(await readFile(join(root, ".agents/skills/example/examples/walkthrough.md"), "utf8")).toBe("[Common](../references/renamed.md)\n");
});
