import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  categorizeTrackedPaths,
  checkMergePolicy,
  MERGE_POLICY_BY_CATEGORY,
} from "../generated-merge-policy-guard";
import {
  createTestGitFixtureRoot,
  initializeTestGitRepository,
} from "../test-helpers/git-remote";

const GENERATED = ".agents/skills/demo/SKILL.md";
const AUTHORED = "authored.md";
const LEDGER = ".skillset/changes/ledger.jsonl";

describe("merge policy guard", () => {
  test("sorts every tracked file into exactly one category", async () => {
    const root = await fixture(policyAttributes());

    const categories = await categorizeTrackedPaths(root);

    expect(categories.get(GENERATED)).toBe("generated-snapshot");
    expect(categories.get(".agents/skills/skillset.lock")).toBe(
      "generated-snapshot"
    );
    expect(categories.get(LEDGER)).toBe("append-only-ledger");
    expect(categories.get(AUTHORED)).toBe("authored");
    expect(categories.get(".gitattributes")).toBe("authored");
  });

  test("accepts a tree where every category matches its policy", async () => {
    const root = await fixture(policyAttributes());

    const report = await checkMergePolicy(root);

    expect(report.violations).toEqual([]);
    expect(report.counts).toMatchObject({
      "append-only-ledger": 1,
      "generated-snapshot": 2,
    });
  });

  test("rejects a generated path no pattern covers", async () => {
    const root = await fixture(
      `**/skillset.lock -merge\n.skillset/changes/*.jsonl merge=union\n`
    );

    const report = await checkMergePolicy(root);

    expect(report.violations).toEqual([
      expect.objectContaining({
        category: "generated-snapshot",
        path: GENERATED,
      }),
    ]);
  });

  test("rejects a pattern that also swallows authored source", async () => {
    // An over-broad `-merge` glob is the failure an unanchored `plugins/`
    // pattern actually produced, and the failure a hardcoded list of authored
    // paths could never have caught.
    const root = await fixture("** -merge\n");

    const report = await checkMergePolicy(root);

    expect(
      report.violations.map((violation) => violation.path)
    ).toContain(AUTHORED);
    expect(report.violations.every((v) => v.category !== "generated-snapshot")).toBe(
      true
    );
  });

  test("rejects a ledger that cannot union", async () => {
    const root = await fixture(
      `${generatedAttributes()}.skillset/changes/*.jsonl -merge\n`
    );

    const report = await checkMergePolicy(root);

    expect(report.violations).toEqual([
      expect.objectContaining({ category: "append-only-ledger", path: LEDGER }),
    ]);
  });

  test("pins one merge policy per category", () => {
    expect(MERGE_POLICY_BY_CATEGORY).toEqual({
      "append-only-ledger": "union",
      authored: "unspecified",
      "generated-snapshot": "unset",
    });
  });
});

function generatedAttributes(): string {
  return "**/.agents/skills/** -merge\n**/skillset.lock -merge\n";
}

function policyAttributes(): string {
  return `${generatedAttributes()}.skillset/changes/*.jsonl merge=union\n`;
}

/** A committed repository holding one file of each category. */
async function fixture(attributes: string): Promise<string> {
  const disposableRoot = await createTestGitFixtureRoot(
    "skillset-merge-policy-"
  );
  const root = await mkdtemp(join(disposableRoot, "repo-"));
  await mkdir(join(root, ".agents/skills/demo"), { recursive: true });
  await mkdir(join(root, ".skillset/changes"), { recursive: true });
  await writeFile(join(root, ".gitattributes"), attributes, "utf8");
  await writeFile(join(root, AUTHORED), "Authored.\n", "utf8");
  await writeFile(join(root, GENERATED), "Generated.\n", "utf8");
  await writeFile(join(root, LEDGER), '{"id":"one"}\n', "utf8");
  await writeFile(
    join(root, ".agents/skills/skillset.lock"),
    `${JSON.stringify({ items: [{ files: ["demo/SKILL.md"] }] }, null, 2)}\n`,
    "utf8"
  );
  // initializeTestGitRepository seeds and commits the whole working tree.
  await initializeTestGitRepository(root, { disposableRoot });
  return root;
}
