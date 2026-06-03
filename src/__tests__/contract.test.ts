import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { expect, test } from "bun:test";

import { loadBuildGraph } from "../resolver";

// SET-3: skillset.schema separates the source-contract schema from content
// version (skillset.version), generated metadata.version, and lock provenance.

test("SET-3: source builds when skillset.schema is absent (default schema)", async () => {
  const root = await contractFixture({
    ".skillset/config.yaml": `
skillset:
  name: schema-default
  version: 0.2.0
claude: true
codex: true
`,
    ".skillset/skills/demo/SKILL.md": `
---
name: demo
description: Demo skill without an explicit schema.
---

Demo.
`,
  });

  const graph = await loadBuildGraph(root);
  expect(graph.root.metadata.schema).toBeUndefined();
  expect(graph.root.metadata.version).toBe("0.2.0");
});

test("SET-3: source accepts an explicit supported skillset.schema alongside a version", async () => {
  const root = await contractFixture({
    ".skillset/config.yaml": `
skillset:
  schema: 1
  name: schema-explicit
  version: 0.2.0
claude: true
codex: true
`,
    ".skillset/skills/demo/SKILL.md": `
---
name: demo
description: Demo skill with an explicit schema.
---

Demo.
`,
  });

  const graph = await loadBuildGraph(root);
  expect(graph.root.metadata.schema).toBe(1);
  expect(graph.root.metadata.version).toBe("0.2.0");
});

test("SET-3: unsupported root skillset.schema fails with a clear diagnostic", async () => {
  const root = await contractFixture({
    ".skillset/config.yaml": `
skillset:
  schema: 2
  name: schema-future
claude: true
codex: true
`,
    ".skillset/skills/demo/SKILL.md": `
---
name: demo
description: Demo skill.
---

Demo.
`,
  });

  await expect(loadBuildGraph(root)).rejects.toThrow("unsupported source schema 2");
});

test("SET-3: a semver-style skillset.schema is rejected, not confused with version", async () => {
  const root = await contractFixture({
    ".skillset/config.yaml": `
skillset:
  schema: "1.0.0"
  name: schema-semver
claude: true
codex: true
`,
    ".skillset/skills/demo/SKILL.md": `
---
name: demo
description: Demo skill.
---

Demo.
`,
  });

  await expect(loadBuildGraph(root)).rejects.toThrow("skillset.schema is the source schema marker");
});

test("SET-3: unsupported plugin skillset.schema fails", async () => {
  const root = await contractFixture({
    ".skillset/config.yaml": `
skillset:
  name: schema-root
claude: true
codex: true
`,
    ".skillset/plugins/alpha/skillset.yaml": `
skillset:
  schema: 9
  name: alpha
`,
    ".skillset/plugins/alpha/skills/demo/SKILL.md": `
---
name: demo
description: Demo skill.
---

Demo.
`,
  });

  await expect(loadBuildGraph(root)).rejects.toThrow("unsupported source schema 9");
});

// SET-4: identity derives from directory names; skillset.name / skillset.id are
// explicit overrides and compatibility aliases with loud conflict diagnostics.

test("SET-4: plugin and skill identity derive from directory names", async () => {
  const root = await contractFixture({
    ".skillset/config.yaml": `
skillset:
  name: id-root
claude: true
codex: true
`,
    ".skillset/plugins/derived-plugin/skillset.yaml": `
skillset: {}
`,
    ".skillset/plugins/derived-plugin/skills/derived-skill/SKILL.md": `
---
description: A skill whose id comes from its directory.
---

Body.
`,
  });

  const graph = await loadBuildGraph(root);
  expect(graph.plugins[0]?.id).toBe("derived-plugin");
  expect(graph.plugins[0]?.skills[0]?.id).toBe("derived-skill");
});

test("SET-4: skillset.id is accepted as a compatibility alias", async () => {
  const root = await contractFixture({
    ".skillset/config.yaml": `
skillset:
  name: id-root
claude: true
codex: true
`,
    ".skillset/plugins/alias-plugin/skillset.yaml": `
skillset:
  id: alias-plugin
`,
    ".skillset/plugins/alias-plugin/skills/aliased/SKILL.md": `
---
name: aliased
description: Skill using a name.
skillset:
  id: aliased
---

Body.
`,
  });

  const graph = await loadBuildGraph(root);
  expect(graph.plugins[0]?.id).toBe("alias-plugin");
  expect(graph.plugins[0]?.skills[0]?.id).toBe("aliased");
});

test("SET-4: conflicting skillset.name and skillset.id fails", async () => {
  const root = await contractFixture({
    ".skillset/config.yaml": `
skillset:
  name: conflict-root
  id: different-root
claude: true
codex: true
`,
    ".skillset/skills/demo/SKILL.md": `
---
name: demo
description: Demo.
---

Body.
`,
  });

  await expect(loadBuildGraph(root)).rejects.toThrow("conflicting skillset.name and skillset.id");
});

test("SET-4: a skill top-level name conflicting with skillset.name fails", async () => {
  const root = await contractFixture({
    ".skillset/config.yaml": `
skillset:
  name: id-root
claude: true
codex: true
`,
    ".skillset/skills/demo/SKILL.md": `
---
name: top-name
description: Demo with conflicting identity.
skillset:
  name: skillset-name
---

Body.
`,
  });

  await expect(loadBuildGraph(root)).rejects.toThrow("conflicting top-level name");
});

test("SET-4: a plugin directory that disagrees with skillset.name fails", async () => {
  const root = await contractFixture({
    ".skillset/config.yaml": `
skillset:
  name: id-root
claude: true
codex: true
`,
    ".skillset/plugins/real-dir/skillset.yaml": `
skillset:
  name: other-name
`,
    ".skillset/plugins/real-dir/skills/demo/SKILL.md": `
---
name: demo
description: Demo.
---

Body.
`,
  });

  await expect(loadBuildGraph(root)).rejects.toThrow("does not match skillset.name");
});

async function contractFixture(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "skillset-contract-"));
  for (const [path, content] of Object.entries(files)) {
    await Bun.write(join(root, path), `${content.trim()}\n`);
  }
  return root;
}
