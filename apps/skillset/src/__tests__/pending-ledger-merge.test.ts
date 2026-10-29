import { appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { expect, test } from "bun:test";

import { buildSkillset, draftSource, planSourceDraft } from "@skillset/core";
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

  // Exercise each stable state of the fold: copied records can temporarily
  // exist in both the ledger and pending files, then pending files disappear.
  const ledgerPath = join(root, ".skillset/changes/ledger.jsonl");
  const pendingContents = await Promise.all(pending.map(async (path) =>
    [path, await readFile(join(root, path), "utf8")] as const
  ));
  const expectedIds = folded.map((event) => event.id);
  for (const [, content] of pendingContents) {
    await appendFile(ledgerPath, content);
    expect((await readChangeLedger(root)).map((event) => event.id)).toEqual(expectedIds);
  }
  for (const path of pending) {
    await rm(join(root, path));
    expect((await readChangeLedger(root)).map((event) => event.id)).toEqual(expectedIds);
  }
  // Restore the merged state so the real release still performs the fold.
  await rm(ledgerPath);
  await Promise.all(pendingContents.map(([path, content]) => writeFile(join(root, path), content)));

  // Sample unlocked reads during release; the staged checks above establish
  // the intermediate states because sampling alone cannot guarantee overlap.
  let applying = true;
  const release = applyRelease(root).finally(() => {
    applying = false;
  });
  const readOverlaps = async () => {
    let reads = 0;
    // Await each read so the probe cannot flood the filesystem queue while
    // release apply needs that same queue to finish the fold.
    do {
      const ids = (await readChangeLedger(root)).map((event) => event.id);
      expect(ids.slice(0, folded.length)).toEqual(folded.map((event) => event.id));
      reads += 1;
    } while (applying);
    return reads;
  };
  // Settle both operations even if either the release or a read assertion fails.
  const [released, overlapping] = await Promise.allSettled([release, readOverlaps()]);
  if (released.status === "rejected") throw released.reason;
  if (overlapping.status === "rejected") throw overlapping.reason;
  const report = released.value;
  expect(overlapping.value).toBeGreaterThan(0);
  expect(report.plan.entries).toHaveLength(2);
  expect(await pendingLedgerEventFiles(root)).toEqual([]);
  const ledger = await readFoldedLedgerRecords(root);
  expect(ledger.slice(0, folded.length).map((event) => event.id)).toEqual(folded.map((event) => event.id));
  expect(ledger.slice(folded.length).map((event) => event.type)).toContain("release.applied");
  expect(await readFile(join(root, ".skillset/changes/ledger.jsonl"), "utf8")).toEndWith("\n");
});

test("ADR-0045 an empty release leaves lifecycle-only pending events for the next release", async () => {
  const root = await fixture();
  await buildSkillset(root);
  const shippedPath = ".skillset/skills/alpha";
  const plan = await planSourceDraft({ rootPath: root, shippedPath });
  await draftSource({ expectedPlanHash: plan.planHash, rootPath: root, shippedPath });
  const pending = await pendingLedgerEventFiles(root);
  expect(pending).toHaveLength(1);

  // A draft records no change entry, so there is nothing to release and apply
  // writes nothing. The event stays pending, and readers still fold it.
  const report = await applyRelease(root);
  expect(report.plan.entries).toEqual([]);
  expect(report.files).toEqual([]);
  expect(await pendingLedgerEventFiles(root)).toEqual(pending);
  expect(await Bun.file(join(root, ".skillset/changes/ledger.jsonl")).exists()).toBe(false);
  expect((await readChangeLedger(root)).map((event) => event.type)).toContain("source.drafted");
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
