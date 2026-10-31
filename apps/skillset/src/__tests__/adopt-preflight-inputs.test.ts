import { expect, test } from "bun:test";
import { readFile, symlink } from "node:fs/promises";
import { join } from "node:path";
import { createTestFixtureRoot } from "../../../../scripts/test-helpers/fixture-root";
import { adoptSkillset } from "../adopt";
import { preflightAdoptionSkills } from "../adopt-skill-preflight";
const skill = "---\nname: demo\ndescription: Demo.\n---\n\nBody.\n";

test("an unrelated symlink beside selected skills is preserved without blocking adoption", async () => {
  const root = await createTestFixtureRoot("adopt-unrelated-link-");
  const outside = await createTestFixtureRoot("adopt-readme-target-");
  await Bun.write(join(outside, "README.md"), "Outside.\n");
  await Bun.write(join(root, ".claude/skills/demo/SKILL.md"), skill);
  await symlink(join(outside, "README.md"), join(root, ".claude/skills/README.md"));
  const result = await adoptSkillset(root, { write: true });
  expect(result.ok).toBe(true);
  expect(await readFile(join(root, ".skillset/skills/demo/SKILL.md"), "utf8")).toContain("Body.");
  expect(await readFile(join(outside, "README.md"), "utf8")).toBe("Outside.\n");
});

test("new skill membership invalidates a preflight that fingerprints selected units", async () => {
  const root = await createTestFixtureRoot("adopt-new-unit-");
  await Bun.write(join(root, ".claude/skills/demo/SKILL.md"), skill);
  const candidates = [{ kind: "skills" as const, path: ".claude/skills" }];
  const preflight = await preflightAdoptionSkills(root, candidates, async (candidate) => ({ rootPath: root, sourcePath: join(root, candidate.path), kind: "skills", mergeTargetNativeSkill: true }));
  try {
    expect(preflight.errors).toEqual([]);
    await Bun.write(join(root, ".claude/skills/second/SKILL.md"), skill.replace("name: demo", "name: second"));
    await expect(preflight.assertUnchanged()).rejects.toThrow("after preflight");
  } finally { await preflight.dispose(); }
});
