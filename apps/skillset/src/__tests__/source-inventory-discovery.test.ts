import { expect, test } from "bun:test";
import { join } from "node:path";

import { collectSourceInventory } from "../change-status";
import { contractFixture, sourceInventoryUnit } from "./contract-test-helpers";

test("source inventory includes hidden resources and ignores Finder metadata", async () => {
  const root = await contractFixture({
    "skillset.yaml":
      "skillset:\n  name: source-membership\nclaude: true\ncodex: false\n",
    ".skillset/skills/demo/SKILL.md":
      "---\nname: demo\ndescription: Demo.\n---\n\nBody.\n",
    ".skillset/skills/demo/.hidden/note.txt": "hidden\n",
    ".skillset/skills/demo/references/topic(one).txt": "visible\n",
    ".skillset/skills/demo/.DS_Store": "metadata\n",
  });
  const before = sourceInventoryUnit(
    await collectSourceInventory(root),
    "skill:demo"
  );
  expect(before.sourcePaths).toEqual([
    ".skillset/skills/demo/.hidden/note.txt",
    ".skillset/skills/demo/SKILL.md",
    ".skillset/skills/demo/references/topic(one).txt",
  ]);
  await Bun.write(
    join(root, ".skillset/skills/demo/.DS_Store"),
    "changed metadata\n"
  );
  expect(
    sourceInventoryUnit(await collectSourceInventory(root), "skill:demo")
  ).toEqual(before);
  await Bun.write(
    join(root, ".skillset/skills/demo/.hidden/note.txt"),
    "changed source\n"
  );
  const after = sourceInventoryUnit(
    await collectSourceInventory(root),
    "skill:demo"
  );
  expect(after.sourcePaths).toEqual(before.sourcePaths);
  expect(after.hash).not.toBe(before.hash);
});
