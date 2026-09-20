import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import path from "node:path";

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
const NESTED_GENERATED = "examples/demo/.agents/skills/demo/SKILL.md";
const AUTHORED = "authored.md";
const LEDGER = ".skillset/changes/ledger.jsonl";

const generatedAttributes = (): string =>
  "**/.agents/skills/** -merge\n**/skillset.lock -merge\n";

const policyAttributes = (): string =>
  `${generatedAttributes()}.skillset/changes/*.jsonl merge=union\n`;

/** A committed repository holding one file of each category. */
const fixture = async (
  attributes: string,
  options: {
    readonly extraPath?: string;
    readonly files?: readonly string[];
    readonly nestedWorkspace?: boolean;
    readonly outputPath?: string;
  } = {}
): Promise<string> => {
  const disposableRoot = await createTestGitFixtureRoot(
    "skillset-merge-policy-"
  );
  const root = await mkdtemp(path.join(disposableRoot, "repo-"));
  await mkdir(path.join(root, ".agents/skills/demo"), { recursive: true });
  await mkdir(path.join(root, ".skillset/changes"), { recursive: true });
  await writeFile(path.join(root, ".gitattributes"), attributes, "utf-8");
  await writeFile(path.join(root, AUTHORED), "Authored.\n", "utf-8");
  await writeFile(path.join(root, GENERATED), "Generated.\n", "utf-8");
  if (options.nestedWorkspace === true) {
    const nestedLock = "examples/demo/.agents/skills/skillset.lock";
    await writeFile(path.join(root, "AGENTS.md"), "Authored.\n", "utf-8");
    await mkdir(path.dirname(path.join(root, nestedLock)), { recursive: true });
    await mkdir(path.dirname(path.join(root, NESTED_GENERATED)), {
      recursive: true,
    });
    await writeFile(path.join(root, NESTED_GENERATED), "Generated.\n", "utf-8");
    await writeFile(
      path.join(root, nestedLock),
      `${JSON.stringify(
        {
          generatedBy: "skillset@test",
          items: [{ files: ["demo/SKILL.md"] }],
          outputRoot: ".agents/skills",
          schemaVersion: 1,
          target: "workspace",
        },
        null,
        2
      )}\n`,
      "utf-8"
    );
  }
  if (options.extraPath !== undefined) {
    const extraPath = path.join(root, options.extraPath);
    await mkdir(path.dirname(extraPath), { recursive: true });
    await writeFile(extraPath, "Authored.\n", "utf-8");
  }
  await writeFile(path.join(root, LEDGER), '{"id":"one"}\n', "utf-8");
  await writeFile(
    path.join(root, ".agents/skills/skillset.lock"),
    `${JSON.stringify(
      {
        generatedBy: "skillset@test",
        items: [
          {
            files: options.files ?? ["demo/SKILL.md"],
            outputPath: options.outputPath ?? "demo/SKILL.md",
          },
        ],
        outputRoot: ".agents/skills",
        schemaVersion: 1,
        target: "workspace",
      },
      null,
      2
    )}\n`,
    "utf-8"
  );
  // initializeTestGitRepository seeds and commits the whole working tree.
  await initializeTestGitRepository(root, { disposableRoot });
  return root;
};

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

    expect(report.violations).toHaveLength(2);
    expect(report.violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: "generated-snapshot",
          path: GENERATED,
        }),
      ])
    );
  });

  test("uses outputPath when a canonical lock item has no files", async () => {
    const root = await fixture(policyAttributes(), {
      files: [],
      outputPath: "demo/SKILL.md",
    });

    const categories = await categorizeTrackedPaths(root);

    expect(categories.get(GENERATED)).toBe("generated-snapshot");
  });

  test("anchors output claims beside a nested workspace lock", async () => {
    const root = await fixture(policyAttributes(), { nestedWorkspace: true });

    const categories = await categorizeTrackedPaths(root);

    expect(categories.get(NESTED_GENERATED)).toBe("generated-snapshot");
    expect(categories.get("AGENTS.md")).toBe("authored");
  });

  test("rejects a pattern that also swallows authored source", async () => {
    // An over-broad `-merge` glob is the failure an unanchored `plugins/`
    // pattern actually produced, and the failure a hardcoded list of authored
    // paths could never have caught.
    const root = await fixture("** -merge\n");

    const report = await checkMergePolicy(root);

    expect(report.violations.map((violation) => violation.path)).toContain(
      AUTHORED
    );
    expect(
      report.violations.every((v) => v.category !== "generated-snapshot")
    ).toBe(true);
  });

  test("rejects case-insensitive attribute overreach on every host", async () => {
    const root = await fixture(`${policyAttributes()}**/AGENTS.md -merge\n`, {
      extraPath: "foo/agents.md",
    });

    const report = await checkMergePolicy(root);

    expect(report.violations).toContainEqual(
      expect.objectContaining({
        category: "authored",
        detail: expect.stringContaining("core.ignorecase=true"),
        path: "foo/agents.md",
      })
    );
  });

  test("rejects a ledger that cannot union", async () => {
    const root = await fixture(
      `${generatedAttributes()}.skillset/changes/*.jsonl -merge\n`
    );

    const report = await checkMergePolicy(root);

    expect(report.violations).toHaveLength(2);
    expect(report.violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: "append-only-ledger",
          path: LEDGER,
        }),
      ])
    );
  });

  test("pins one merge policy per category", () => {
    expect(MERGE_POLICY_BY_CATEGORY).toEqual({
      "append-only-ledger": "union",
      authored: "unspecified",
      "generated-snapshot": "unset",
    });
  });
});
