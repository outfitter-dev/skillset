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

async function contractFixture(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "skillset-contract-"));
  for (const [path, content] of Object.entries(files)) {
    await Bun.write(join(root, path), `${content.trim()}\n`);
  }
  return root;
}
