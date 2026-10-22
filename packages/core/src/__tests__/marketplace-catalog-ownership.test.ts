import { describe, expect, test } from "bun:test";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { explainPath } from "../authoring";
import { buildSkillsetResult } from "../build";
import { normalizeSkillsetFixtureFiles } from "../../../../scripts/test-helpers/skillset-config";
import { createTestFixtureRoot } from "../../../../scripts/test-helpers/fixture-root";

const ROOT_CONFIG = `
skillset:
  name: catalog-root
claude: true
codex: false
cursor: true
`;

describe("SET-693: builds own provider marketplace catalogs", () => {
  test("lock-records the implicit Claude and Cursor catalogs", async () => {
    const root = await fixture({ "skillset.yaml": ROOT_CONFIG });
    await buildSkillsetResult(root);

    const lock = JSON.parse(await readFile(join(root, "skillset.lock"), "utf8")) as {
      readonly items: readonly Record<string, unknown>[];
    };
    for (const [target, path] of [
      ["claude", ".claude-plugin/marketplace.json"],
      ["cursor", ".cursor-plugin/marketplace.json"],
    ] as const) {
      expect(lock.items).toContainEqual(expect.objectContaining({
        feature: "marketplaces",
        files: [path],
        kind: "plugin-feature",
        name: `${target}-marketplace`,
        outputPath: path,
        owner: { target },
      }));
      const explained = await explainPath(root, path);
      expect(explained.kind).toBe("generated");
      expect(explained.notes).not.toContainEqual(expect.stringContaining("No lock entry"));
    }
  });

  test("switching from the implicit catalog to a declared one rebuilds without a collision", async () => {
    const root = await fixture({ "skillset.yaml": ROOT_CONFIG });
    await buildSkillsetResult(root);

    await writeFile(join(root, "skillset.yaml"), `${ROOT_CONFIG.trim()}
marketplaces:
  team:
    description: Team plugins.
    targets: [claude, cursor]
    plugins:
      - plugin: tools
`);
    const rebuilt = await buildSkillsetResult(root);

    expect(rebuilt.ok).toBe(true);
    expect(rebuilt.diagnostics).not.toContainEqual(
      expect.objectContaining({ code: "unmanaged-output-collision" })
    );
    const catalog = JSON.parse(
      await readFile(join(root, ".claude-plugin/marketplace.json"), "utf8")
    ) as { readonly name: string };
    expect(catalog.name).toBe("team");
  });
});

async function fixture(files: Record<string, string>): Promise<string> {
  const root = await createTestFixtureRoot("skillset-catalog-ownership-");
  for (const [path, content] of Object.entries(normalizeSkillsetFixtureFiles({
    ...files,
    ".skillset/plugins/tools/skillset.yaml": `
skillset:
  name: tools
`,
    ".skillset/plugins/tools/skills/demo/SKILL.md": `
---
name: demo
description: Demo skill.
---

Use this demo skill.
`,
  }))) {
    await Bun.write(join(root, path), `${content.trim()}\n`);
  }
  return root;
}
