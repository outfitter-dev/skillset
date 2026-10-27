import { describe, expect, test } from "bun:test";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { buildSkillsetResult, verifySkillsetResult } from "../build";
import { parseCurrentGeneratedLock } from "../generated-lock";
import { hasValidLockProvenance, withLockProvenance } from "../lock-provenance";
import type { JsonRecord } from "../types";
import {
  createTestGitFixtureRoot,
  initializeTestGitRepository,
  runTestGit,
} from "../../../../scripts/test-helpers/git-remote";
import { normalizeSkillsetFixtureFiles } from "../../../../scripts/test-helpers/skillset-config";

function item(name: string, outputHash: string): JsonRecord {
  return {
    files: [`${name}/SKILL.md`],
    kind: "skill",
    name,
    outputHash,
    outputPath: `${name}/SKILL.md`,
  };
}

function v5Lock(items: readonly JsonRecord[]): JsonRecord {
  return withLockProvenance({
    generatedBy: "skillset@0.1.0",
    items: [...items],
    outputRoot: ".claude/skills",
    renderResults: [],
    schemaVersion: 5,
    target: "claude",
  });
}

const HASH_A = `sha256:${"a".repeat(64)}`;
const HASH_B = `sha256:${"b".repeat(64)}`;
const HASH_C = `sha256:${"c".repeat(64)}`;

describe("ADR-0045: per-entry lock provenance", () => {
  test("a v5 lock carries a header hash and one hash per item, and no document hash", () => {
    const lock = v5Lock([item("alpha", HASH_A), item("beta", HASH_B)]);

    expect(lock.provenanceHash).toBeUndefined();
    expect(lock.headerHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    for (const entry of lock.items as JsonRecord[]) {
      expect(entry.provenanceHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    }
    expect(hasValidLockProvenance(lock)).toBe(true);
  });

  test("changing one item changes only that item's hash", () => {
    const before = v5Lock([item("alpha", HASH_A), item("beta", HASH_B)]);
    const after = v5Lock([item("alpha", HASH_C), item("beta", HASH_B)]);
    const [beforeAlpha, beforeBeta] = before.items as JsonRecord[];
    const [afterAlpha, afterBeta] = after.items as JsonRecord[];

    expect(after.headerHash).toBe(before.headerHash);
    expect(afterBeta?.provenanceHash).toBe(beforeBeta?.provenanceHash);
    expect(afterAlpha?.provenanceHash).not.toBe(beforeAlpha?.provenanceHash);
  });

  test("render results stay outside the header hash", () => {
    const lock = v5Lock([item("alpha", HASH_A)]);
    const withResults = { ...lock, renderResults: [{ note: "unhashed" }] };

    expect(hasValidLockProvenance(withResults)).toBe(true);
  });

  test("a hand-edited item, header field, or leftover document hash fails verification", () => {
    const lock = v5Lock([item("alpha", HASH_A), item("beta", HASH_B)]);
    const [alpha, beta] = lock.items as JsonRecord[];

    expect(hasValidLockProvenance({
      ...lock,
      items: [{ ...alpha, outputHash: HASH_C }, beta] as JsonRecord[],
    })).toBe(false);
    expect(hasValidLockProvenance({ ...lock, outputRoot: ".agents/skills" })).toBe(false);
    expect(hasValidLockProvenance({ ...lock, provenanceHash: HASH_A })).toBe(false);
    expect(() =>
      parseCurrentGeneratedLock({ ...lock, outputRoot: ".agents/skills" })
    ).toThrow(/headerHash and every item provenanceHash must verify/);
  });

  test("v4 locks keep verifying their document hash", () => {
    const v4 = withLockProvenance({
      generatedBy: "skillset@0.1.0",
      items: [item("alpha", HASH_A)],
      outputRoot: ".claude/skills",
      schemaVersion: 4,
      target: "claude",
    });

    expect(v4.provenanceHash).toMatch(/^sha256:/);
    expect(v4.headerHash).toBeUndefined();
    expect(hasValidLockProvenance(v4)).toBe(true);
    expect(hasValidLockProvenance({ ...v4, outputRoot: ".agents/skills" })).toBe(false);
  });
});

describe("ADR-0045: locks from branches that change different skills merge as text", () => {
  test("a plain git merge yields a lock that verifies and matches a fresh build", async () => {
    const parent = await createTestGitFixtureRoot("skillset-lock-merge-");
    const root = await fixture(parent);
    await initializeTestGitRepository(root, { disposableRoot: parent });
    await buildSkillsetResult(root);
    await runTestGit(root, "add", "--all");
    await runTestGit(root, "commit", "-m", "base");

    await runTestGit(root, "checkout", "-b", "edit-alpha");
    await editSkill(root, "alpha");
    await buildSkillsetResult(root);
    await runTestGit(root, "commit", "--all", "-m", "edit alpha");

    await runTestGit(root, "checkout", "-");
    await runTestGit(root, "checkout", "-b", "edit-beta");
    await editSkill(root, "beta");
    await buildSkillsetResult(root);
    await runTestGit(root, "commit", "--all", "-m", "edit beta");

    // The default text merge driver, as GitHub's server-side merge uses.
    await runTestGit(root, "merge", "--no-edit", "edit-alpha");

    const merged = await readFile(join(root, ".claude/skills/skillset.lock"), "utf8");
    expect(merged).not.toContain("<<<<<<<");
    expect(hasValidLockProvenance(JSON.parse(merged) as JsonRecord)).toBe(true);
    expect((await verifySkillsetResult(root)).ok).toBe(true);
    await buildSkillsetResult(root);
    expect(await readFile(join(root, ".claude/skills/skillset.lock"), "utf8")).toBe(merged);
  });
});

async function editSkill(root: string, name: string): Promise<void> {
  const path = join(root, `.skillset/skills/${name}/SKILL.md`);
  await writeFile(path, `${await readFile(path, "utf8")}\nEdited on its own branch.\n`);
}

async function fixture(parent: string): Promise<string> {
  const root = join(parent, "repo");
  const files = normalizeSkillsetFixtureFiles({
    "skillset.yaml": `
skillset:
  name: lock-merge
claude: true
codex: false
cursor: false
`,
    ".skillset/skills/alpha/SKILL.md": `
---
name: alpha
description: Alpha skill.
---

Use alpha.
`,
    ".skillset/skills/beta/SKILL.md": `
---
name: beta
description: Beta skill.
---

Use beta.
`,
  });
  for (const [path, content] of Object.entries(files)) {
    await Bun.write(join(root, path), `${content.trim()}\n`);
  }
  return root;
}
