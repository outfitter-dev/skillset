import { expect, test } from "bun:test";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { buildSkillsetResult } from "@skillset/core";
import { withLockProvenance } from "@skillset/core/internal/lock-provenance";
import { createTestFixtureRoot } from "../../../../scripts/test-helpers/fixture-root";
import { adoptSkillset } from "../adopt";
import { planImports } from "../import";
import { preflightAdoptionSkills } from "../adopt-skill-preflight";

const skill = "---\nname: demo\ndescription: Demo.\n---\n\nDemo.\n";
async function fixture() {
  const root = await createTestFixtureRoot("adopt-empty-managed-");
  await Bun.write(join(root, "skillset.yaml"), "compile:\n  targets: [codex]\n  session_start_hook: off\n");
  await Bun.write(join(root, ".skillset/skills/demo/SKILL.md"), skill);
  expect((await buildSkillsetResult(root)).ok).toBe(true);
  await rm(join(root, ".agents/skills/demo"), { recursive: true });
  return root;
}

for (const state of ["empty", "missing-unit", "invalid"] as const) {
  test(`${state} lock-only root is inspected before unrelated skills are adopted`, async () => {
    const root = await fixture();
    const lockPath = join(root, ".agents/skills/skillset.lock");
    if (state === "empty") {
      const lock = JSON.parse(await readFile(lockPath, "utf8"));
      lock.items = [];
      await writeFile(lockPath, JSON.stringify(withLockProvenance(lock)));
      await rm(join(root, ".skillset/skills/demo"), { recursive: true });
    }
    if (state === "invalid") await writeFile(lockPath, "{}");
    await Bun.write(join(root, ".claude/skills/new/SKILL.md"), skill.replace("name: demo", "name: new"));
    const result = await adoptSkillset(root, { write: true });
    expect(result.ok).toBe(state === "empty");
    if (state === "empty") {
      expect(result.imports.flatMap((entry) => entry.units).map((unit) => unit.name)).toEqual(["new"]);
      expect(await readFile(join(root, ".skillset/skills/new/SKILL.md"), "utf8")).toContain("name: new");
    } else {
      expect(result.writtenPaths).toEqual([]);
      expect(result.imports).toEqual([]);
    }
  });
}

test("an empty root gaining a skill invalidates prepared adoption; explicit import still refuses empty collections", async () => {
  const root = await fixture();
  const lockPath = join(root, ".agents/skills/skillset.lock");
  const lock = JSON.parse(await readFile(lockPath, "utf8"));
  lock.items = [];
  await writeFile(lockPath, JSON.stringify(withLockProvenance(lock)));
  await rm(join(root, ".skillset/skills/demo"), { recursive: true });
  await expect(planImports(join(root, ".agents/skills"), "skills")).rejects.toThrow("child skill directories");
  const preflight = await preflightAdoptionSkills(root, [{ kind: "skills", path: ".agents/skills" }], async (candidate) => ({ rootPath: root, sourcePath: join(root, candidate.path), kind: "skills" }));
  try {
    expect(preflight.errors).toEqual([]);
    await Bun.write(join(root, ".agents/skills/demo/SKILL.md"), skill);
    await expect(preflight.assertUnchanged()).rejects.toThrow("membership changed");
  } finally { await preflight.dispose(); }
});
