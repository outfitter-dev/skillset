import { describe, expect, test } from "bun:test";
import { access, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { createTestFixtureRoot } from "../../../../scripts/test-helpers/fixture-root";
import { buildSkillset } from "../build";
import { moveSource, planSourceMove } from "../source-move";
import { planSourceRename, renameSource } from "../source-rename";

const guidance = "# Authored guidance\nKeep the source authoritative.\n";

async function fixture() {
  const root = await createTestFixtureRoot("native-source-mutation-");
  const files = {
    "AGENTS.md": guidance,
    "skillset.yaml": "skillset:\n  name: native-mutation\ncompile:\n  targets: [claude]\n",
    ".skillset/skills/old/SKILL.md": "---\nname: old\ndescription: Old skill\n---\n\nOld skill.\n",
    ".skillset/plugins/tools/skillset.yaml": "skillset:\n  name: tools\n",
  };
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), content);
  }
  await buildSkillset(root);
  return root;
}

async function snapshot(root: string, prefix = ""): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const entry of await readdir(join(root, prefix), { withFileTypes: true })) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) Object.assign(result, await snapshot(root, path));
    else if (path !== "AGENTS.md") result[path] = (await readFile(join(root, path))).toString("base64");
  }
  return result;
}

for (const operation of [
  { name: "rename", plan: planSourceRename, apply: renameSource, to: ".skillset/skills/new" },
  { name: "move", plan: planSourceMove, apply: moveSource, to: ".skillset/plugins/tools/skills/old" },
]) {
  describe(`native source ${operation.name}`, () => {
    for (const timing of ["beforeInitialInspection", "beforeWriteInstall"] as const) {
      test(`preserves concurrent guidance and rolls back at ${timing}`, async () => {
        const root = await fixture();
        const request = { from: ".skillset/skills/old", rootPath: root, to: operation.to };
        const preview = await operation.plan(request);
        const before = await snapshot(root);
        const changed = "# Concurrent authored edit\n";
        await expect(operation.apply({
          ...request,
          expectedPlanHash: preview.planHash,
          transactionOptions: { testHooks: { [timing]: async () => {
            await writeFile(join(root, "AGENTS.md"), changed);
          } } },
        })).rejects.toThrow("read-only input changed");
        expect(await readFile(join(root, "AGENTS.md"), "utf8")).toBe(changed);
        expect(await snapshot(root)).toEqual(before);
      });
    }

    test("applies with unchanged authored guidance", async () => {
      const root = await fixture();
      const request = { from: ".skillset/skills/old", rootPath: root, to: operation.to };
      const preview = await operation.plan(request);
      const report = await operation.apply({ ...request, expectedPlanHash: preview.planHash });
      expect(report.applied).toBe(true);
      expect(await readFile(join(root, "AGENTS.md"), "utf8")).toBe(guidance);
      await expect(access(join(root, request.from))).rejects.toThrow();
      expect(await readFile(join(root, request.to, "SKILL.md"), "utf8")).toContain("Old skill.");
    });
  });
}
