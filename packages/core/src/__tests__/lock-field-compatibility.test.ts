import { describe, expect, test } from "bun:test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { createTestFixtureRoot } from "../../../../scripts/test-helpers/fixture-root";
import { buildSkillsetResult } from "../build";
import { withLockProvenance } from "../lock-provenance";
import { renderValidatedJson } from "../structured-output";
import type { JsonValue } from "../types";

const skill = (body: string) => `---\nname: demo\ndescription: Demo\n---\n\n${body}\n`;
async function fixture(files: Record<string, string>) {
  const root = await createTestFixtureRoot("lock-field-compatibility-");
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), content);
  }
  return root;
}
const config = "skillset:\n  name: lock-fields\ncompile:\n  targets: [codex]\n";

async function expectCleanRebuild(root: string) {
  const result = await buildSkillsetResult(root);
  expect(result.ok).toBe(true);
  expect(result.diagnostics.filter((diagnostic) => diagnostic.code === "managed-output-edited")).toEqual([]);
  expect(result.writes.backupRunId).toBeUndefined();
}

describe("known generated lock fields", () => {
  for (const draft of [false, true]) {
    test(`rebuilds changed standalone ${draft ? "draft" : "live"} source without edit backups`, async () => {
      const source = `.skillset/skills/${draft ? "_drafts/" : ""}demo/SKILL.md`;
      const root = await fixture({ "skillset.yaml": config, [source]: skill("Before") });
      expect((await buildSkillsetResult(root)).ok).toBe(true);
      await writeFile(join(root, source), skill("After"));
      await expectCleanRebuild(root);
    });
  }

  for (const policy of ["live", "paired", "only", "override"] as const) {
    test(`rebuilds internal-use ${policy} without edit backups`, async () => {
      const root = await fixture({
        "skillset.yaml": config + `plugins:\n  internal_use:\n    skills:\n      tools: true\n${policy === "live" ? "" : `    drafts:\n      tools: ${policy === "paired" ? "true" : policy}\n`}`,
        ".skillset/plugins/tools/skillset.yaml": "skillset:\n  name: tools\n",
        ".skillset/plugins/tools/skills/demo/SKILL.md": skill("Live before"),
        ...(policy === "live" ? {} : { ".skillset/plugins/tools/skills/_drafts/demo/SKILL.md": skill("Draft before") }),
      });
      expect((await buildSkillsetResult(root)).ok).toBe(true);
      const source = `.skillset/plugins/tools/skills/${policy === "live" ? "" : "_drafts/"}demo/SKILL.md`;
      await writeFile(join(root, source), skill("After"));
      await expectCleanRebuild(root);
    });
  }

  for (const inventory of [false, true]) {
    test(`migrates canonical v4 ${inventory ? "with" : "without"} source inventory`, async () => {
      const root = await fixture({ "skillset.yaml": config, ".skillset/skills/demo/SKILL.md": skill("Before") });
      await buildSkillsetResult(root);
      const path = join(root, ".agents/skills/skillset.lock");
      const lock = JSON.parse(await readFile(path, "utf8")) as Record<string, JsonValue>;
      lock.schemaVersion = 4;
      delete lock.headerHash;
      for (const item of lock.items as Record<string, JsonValue>[]) delete item.provenanceHash;
      if (inventory) lock.sourceInventory = { hashSchema: "skillset-source-v1", units: [] };
      else delete lock.sourceInventory;
      await writeFile(path, renderValidatedJson(withLockProvenance(lock), path));
      await expectCleanRebuild(root);
    });
  }

  for (const scope of ["header", "item", "feature", "provenance"] as const) {
    test(`preserves recovery for an edited ${scope}`, async () => {
      const root = await fixture({ "skillset.yaml": config, ".skillset/skills/demo/SKILL.md": skill("Before") });
      await buildSkillsetResult(root);
      const path = join(root, ".agents/skills/skillset.lock");
      const lock = JSON.parse(await readFile(path, "utf8")) as Record<string, JsonValue>;
      if (scope === "header") lock.unrecognized = true;
      if (scope === "item") (lock.items as Record<string, JsonValue>[])[0]!.unrecognized = true;
      if (scope === "feature") (lock.features as Record<string, JsonValue>).unrecognized = true;
      if (scope === "provenance") lock.headerHash = `sha256:${"0".repeat(64)}`;
      await writeFile(path, renderValidatedJson(scope === "provenance" ? lock : withLockProvenance(lock), path));
      await writeFile(join(root, ".skillset/skills/demo/SKILL.md"), skill("After"));
      const result = await buildSkillsetResult(root);
      expect(result.diagnostics.some((diagnostic) => diagnostic.code === "managed-output-edited")).toBe(true);
      expect(result.writes.backupRunId).toBeDefined();
    });
  }
});
