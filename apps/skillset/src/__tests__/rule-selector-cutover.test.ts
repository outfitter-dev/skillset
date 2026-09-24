import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { expect, test } from "bun:test";
import { RETIRED_RULE_SELECTOR_PREFIX } from "@skillset/schema";

import { changeCheck } from "../change-entries";
import { changeStatus } from "../change-status";
import { addChangeEntry } from "../change-workflow";
import {
  createTestGitFixtureRoot,
  initializeTestGitRepository,
} from "../../../../scripts/test-helpers/git-remote";

const RETIRED_ROOT_SELECTOR = `${RETIRED_RULE_SELECTOR_PREFIX}root`;
const RETIRED_ROOT_REWRITE = `${RETIRED_ROOT_SELECTOR} uses the retired rule selector; use rule:root`;

test("rule source units use rule selectors and keep their pre-ADR-0037 source hash", async () => {
  const root = await ruleFixture();

  const status = await changeStatus(root, { since: "HEAD" });
  const rule = status.sourceUnits.find((unit) => unit.id === "rule:root");

  expect(rule?.kind).toBe("rule");
  // Recorded before ADR-0037 renamed the kind. A different hash would report
  // every unchanged rule as edited against its recorded baseline.
  expect(rule?.hash).toBe("sha256:5ff71e3cfb339172d7a2326bc2f1e37092d6c794a018ce68eda14aae9a3821da");
});

test("change check rejects a pending entry that names a retired rule selector", async () => {
  const root = await ruleFixture();
  await mkdir(join(root, ".skillset/changes"), { recursive: true });
  await writeFile(
    join(root, ".skillset/changes/aabbccddeeff.md"),
    `Scope: ${RETIRED_ROOT_SELECTOR}\nBump: patch\n\nThis hand-written entry still names the rule by its pre-ADR-0037 selector.\n`,
    "utf8"
  );

  const report = await changeCheck(root, { since: "HEAD" });

  expect(report.issues).toContainEqual(
    expect.objectContaining({
      code: "change-scope-retired",
      message: `scope ${RETIRED_ROOT_REWRITE}`,
      path: ".skillset/changes/aabbccddeeff.md",
    })
  );
  expect(report.issues.map((issue) => issue.code)).not.toContain("change-scope-invalid");
});

test("change add rejects a retired rule selector with its rewrite", async () => {
  const root = await ruleFixture();

  await expect(
    addChangeEntry(root, {
      bump: "patch",
      reason: { kind: "inline", value: "Tighten the root rule wording for reviewers." },
      scopes: [RETIRED_ROOT_SELECTOR],
      since: "HEAD",
    })
  ).rejects.toThrow(`skillset: change scope ${RETIRED_ROOT_REWRITE}`);
});

async function ruleFixture(): Promise<string> {
  const disposableRoot = await createTestGitFixtureRoot("skillset-rule-selector-");
  const root = await mkdtemp(join(disposableRoot, "repo-"));
  await mkdir(join(root, ".skillset/rules"), { recursive: true });
  await writeFile(
    join(root, "skillset.yaml"),
    "skillset:\n  name: rule-hash-root\nclaude: true\ncodex: false\n",
    "utf8"
  );
  await writeFile(join(root, ".skillset/rules/root.md"), "# Root\n\nKeep rule source hashes stable.\n", "utf8");
  await initializeTestGitRepository(root, { disposableRoot });
  return root;
}
