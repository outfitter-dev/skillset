import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createTestFixtureRoot } from "../../../../scripts/test-helpers/fixture-root";
import { buildSkillsetResult } from "../build";

async function graphFixture(primary: string, files: Record<string, string>) {
  const root = await createTestFixtureRoot("skill-resource-graph-");
  await Bun.write(join(root, "skillset.yaml"), "compile:\n  targets: []\n");
  await Bun.write(join(root, ".skillset/skills/example/SKILL.md"), `---\nname: example\ndescription: Graph example.\n---\n${primary}\n`);
  for (const [name, body] of Object.entries(files)) await Bun.write(join(root, ".skillset/shared", name), body);
  return root;
}

test("linked Markdown recursively expands inline and linked dependencies", async () => {
  const root = await graphFixture("@{{shared:references/a.md}}", {
    "references/a.md": "{{> intro}}\n@{{shared:references/deep/b.md}}\n",
    "partials/intro.md": "Introduction.\n",
    "references/deep/b.md": "@{{shared:assets/picture.txt}}\n",
    "assets/picture.txt": "picture\n",
  });
  const result = await buildSkillsetResult(root);
  expect(result.ok).toBe(true);
  expect(await readFile(join(root, ".agents/skills/example/references/a.md"), "utf8")).toBe("Introduction.\n\n@deep/b.md\n");
  expect(await readFile(join(root, ".agents/skills/example/references/deep/b.md"), "utf8")).toBe("@../../assets/picture.txt\n");
  expect(await readFile(join(root, ".agents/skills/example/assets/picture.txt"), "utf8")).toBe("picture\n");
});

for (const edges of [4, 5]) test(`mixed graph ${edges} edges ${edges === 4 ? "passes" : "fails"}`, async () => {
  const files: Record<string, string> = {};
  for (let edge = 1; edge <= edges; edge++) files[`references/${edge}.md`] = edge === edges ? "End\n" : `${edge % 2 === 0 ? "{{> " : "@{{"}shared:references/${edge + 1}.md}}\n`;
  const root = await graphFixture("@{{shared:references/1.md}}", files);
  if (edges === 4) expect((await buildSkillsetResult(root)).ok).toBe(true);
  else {
    await expect(buildSkillsetResult(root)).rejects.toThrow("four-hop");
    expect(await Bun.file(join(root, ".agents/skills/example/SKILL.md")).exists()).toBe(false);
  }
});

for (const mixed of [false, true]) test(`active graph rejects ${mixed ? "inline/link" : "link"} cycle`, async () => {
  const root = await graphFixture("{{> shared:references/a.md}}", {
    "references/a.md": "@{{shared:references/b.md}}\n",
    "references/b.md": `${mixed ? "{{> " : "@{{"}shared:references/a.md}}\n`,
  });
  await expect(buildSkillsetResult(root)).rejects.toThrow(/cycle.*a\.md.*b\.md.*a\.md/s);
  expect(await Bun.file(join(root, ".agents/skills/example/SKILL.md")).exists()).toBe(false);
});

test("diamond shares one file without treating repeated nodes as a cycle", async () => {
  const root = await graphFixture("@{{shared:references/a.md}}\n@{{shared:references/b.md}}", {
    "references/a.md": "@{{shared:references/end.md}}\n",
    "references/b.md": "@{{shared:references/end.md}}\n",
    "references/end.md": "End\n",
  });
  const result = await buildSkillsetResult(root);
  expect(result.ok).toBe(true);
  expect(result.data.filter(file => file.path === ".agents/skills/example/references/end.md")).toHaveLength(1);
});

test("a short first visit cannot hide a later over-depth path", async () => {
  const root = await graphFixture("@{{shared:references/end.md}}\n@{{shared:references/a.md}}", {
    "references/a.md": "@{{shared:references/b.md}}\n",
    "references/b.md": "@{{shared:references/c.md}}\n",
    "references/c.md": "@{{shared:references/d.md}}\n",
    "references/d.md": "@{{shared:references/end.md}}\n",
    "references/end.md": "End\n",
  });
  await expect(buildSkillsetResult(root)).rejects.toThrow("four-hop");
});

test("copied Markdown opt-out preserves bytes and stops outgoing traversal", async () => {
  const literal = "\uFEFF---\r\nskillset: { preprocess: false }\r\n---\r\n@{{shared:references/absent.md}}\r\n";
  const root = await graphFixture("@{{shared:references/literal.md}}", { "references/literal.md": literal });
  expect((await buildSkillsetResult(root)).ok).toBe(true);
  expect(await readFile(join(root, ".agents/skills/example/references/literal.md"), "utf8")).toBe(literal);
});

test("transitive resources are processed in plugin packages and all project copies", async () => {
  const root = await graphFixture("unused", {
    "references/a.md": "@{{shared:references/b.md}}\n",
    "references/b.md": "{{> intro}}\n",
    "partials/intro.md": "Expanded.\n",
  });
  await Bun.write(join(root, "skillset.yaml"), "compile:\n  targets: [claude, codex, cursor]\n  unsupportedDestination: warn\n  session_start_hook: off\nplugins:\n  internal_use:\n    skills:\n      demo: true\n");
  await Bun.write(join(root, ".skillset/plugins/demo/skillset.yaml"), "skillset:\n  name: demo\n  description: Demo.\n");
  await Bun.write(join(root, ".skillset/plugins/demo/skills/plugin-example/SKILL.md"), "---\nname: plugin-example\ndescription: Example.\n---\n@{{shared:references/a.md}}\n");
  expect((await buildSkillsetResult(root)).ok).toBe(true);
  for (const output of ["plugins/demo/skills/plugin-example", ".agents/skills/plugin-example", ".claude/skills/plugin-example", ".cursor/skills/plugin-example"]) {
    expect(await readFile(join(root, output, "references/a.md"), "utf8")).toBe("@b.md\n");
    expect(await readFile(join(root, output, "references/b.md"), "utf8")).toBe("Expanded.\n\n");
  }
});

test("declared directory Markdown recursively contributes implied copies", async () => {
  const root = await graphFixture("Body", {
    "references/docs/a.md": "@{{shared:assets/file.txt}}\n",
    "assets/file.txt": "asset\n",
  });
  await Bun.write(join(root, ".skillset/skills/example/SKILL.md"), "---\nname: example\ndescription: Example.\nresources:\n  references:\n    - from: shared:references/docs\n      to: references/mapped\n---\nBody\n");
  expect((await buildSkillsetResult(root)).ok).toBe(true);
  expect(await readFile(join(root, ".agents/skills/example/references/mapped/a.md"), "utf8")).toBe("@../../assets/file.txt\n");
});
