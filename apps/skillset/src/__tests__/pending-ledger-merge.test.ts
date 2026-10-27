import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { expect, test } from "bun:test";

import { buildSkillset } from "@skillset/core";
import { readChangeLedger } from "@skillset/core/internal/change-ledger";

import { addChangeEntry } from "../change-workflow";
import { applyRelease } from "../release";
import {
  pendingLedgerEventFiles,
  readFoldedLedgerRecords,
} from "../../../../scripts/test-helpers/change-ledger";
import {
  createTestGitFixtureRoot,
  initializeTestGitRepository,
  runTestGit,
} from "../../../../scripts/test-helpers/git-remote";

test("ADR-0045 change entries from two branches merge as plain text and fold on release", async () => {
  const root = await fixture();
  await buildSkillset(root);
  await initializeTestGitRepository(root, { disposableRoot: join(root, "..") });

  for (const name of ["alpha", "beta"]) {
    await runTestGit(root, "switch", "--quiet", "-c", `edit-${name}`, "main");
    await writeFile(join(root, `.skillset/skills/${name}/SKILL.md`), skill(name, `Changed ${name}.`), "utf8");
    await addChangeEntry(root, {
      bump: "patch",
      reason: { kind: "inline", value: `Change ${name} on its own branch, recorded in its own pending file.` },
      scopes: [`skill:${name}`],
    });
    await buildSkillset(root);
    await runTestGit(root, "add", "--all");
    await runTestGit(root, "commit", "--quiet", "-m", `edit ${name}`);
  }

  // The default text merge, with no merge attributes declared.
  await runTestGit(root, "merge", "--quiet", "--no-edit", "edit-alpha");
  const pending = await pendingLedgerEventFiles(root);
  expect(pending).toHaveLength(2);
  expect(await Bun.file(join(root, ".skillset/changes/ledger.jsonl")).exists()).toBe(false);
  const folded = await readChangeLedger(root);
  const reasons = folded.filter((event) => event.type === "reason.created").map((event) => event.payload.reason);
  expect(reasons.toSorted()).toEqual([
    "Change alpha on its own branch, recorded in its own pending file.",
    "Change beta on its own branch, recorded in its own pending file.",
  ]);

  const report = await applyRelease(root);
  expect(report.plan.entries).toHaveLength(2);
  expect(await pendingLedgerEventFiles(root)).toEqual([]);
  const ledger = await readFoldedLedgerRecords(root);
  expect(ledger.slice(0, folded.length).map((event) => event.id)).toEqual(folded.map((event) => event.id));
  expect(ledger.slice(folded.length).map((event) => event.type)).toContain("release.applied");
  expect(await readFile(join(root, ".skillset/changes/ledger.jsonl"), "utf8")).toEndWith("\n");
});

async function fixture(): Promise<string> {
  const disposableRoot = await createTestGitFixtureRoot("skillset-pending-ledger-merge-");
  const root = await mkdtemp(join(disposableRoot, "repo-"));
  await writeFile(join(root, "skillset.yaml"), "skillset:\n  name: pending-merge\nclaude: true\ncodex: false\n", "utf8");
  for (const name of ["alpha", "beta"]) {
    await mkdir(join(root, `.skillset/skills/${name}`), { recursive: true });
    await writeFile(join(root, `.skillset/skills/${name}/SKILL.md`), skill(name, `Baseline ${name}.`), "utf8");
  }
  return root;
}

function skill(name: string, body: string): string {
  return `---\nname: ${name}\ndescription: ${name} skill.\n---\n\n${body}\n`;
}
