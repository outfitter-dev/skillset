import { appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import { withChangeLedgerMutation } from "../change-ledger-mutation";
import { changeStatus } from "../change-status";
import { amendAppliedChange, migratePendingChangeEntries } from "../change-workflow";
import {
  createTestGitFixtureRoot,
  initializeTestGitRepository,
} from "../../../../scripts/test-helpers/git-remote";

const LEDGER = ".skillset/changes/ledger.jsonl";
const AMENDMENTS = ".skillset/changes/amendments.jsonl";

describe("SET-636 change-ledger mutation rollback", () => {
  test("a failing mutation removes only its own records and keeps a foreign append", async () => {
    const root = await fixture();
    const existing = record("evt-existing", "2026-09-20T00:00:00.000Z");
    await writeFile(join(root, LEDGER), `${existing}\n`, "utf8");
    const foreign = record("evt-foreign", "2026-09-21T00:00:00.000Z");

    await expect(
      withChangeLedgerMutation(root, undefined, undefined, async (mutation) => {
        await mutation.appendLedger([
          { payload: { reason: "Owned reason that must roll back.", reasonId: "owned" }, type: "reason.created" },
        ]);
        await mutation.appendJsonl(AMENDMENTS, [
          { amendedAt: "2026-09-21T00:00:00.000Z", id: "owned-amendment", reason: "Owned." },
        ]);
        await appendFile(join(root, LEDGER), `${foreign}\n`, "utf8");
        throw new Error("injected writer failure");
      })
    ).rejects.toThrow("injected writer failure");

    expect(await readFile(join(root, LEDGER), "utf8")).toBe(`${existing}\n${foreign}\n`);
    expect(await Bun.file(join(root, AMENDMENTS)).exists()).toBe(false);
  });

  test("a rollback failure keeps the original error and still rolls back other streams", async () => {
    const root = await fixture();
    const original = new Error("injected writer failure");

    const failure = await withChangeLedgerMutation(root, undefined, undefined, async (mutation) => {
      await mutation.appendJsonl(AMENDMENTS, [
        { amendedAt: "2026-09-21T00:00:00.000Z", id: "owned-amendment", reason: "Owned." },
      ]);
      await mutation.appendLedger([
        { payload: { reason: "Owned reason.", reasonId: "owned" }, type: "reason.created" },
      ]);
      await rm(join(root, AMENDMENTS));
      await mkdir(join(root, AMENDMENTS));
      throw original;
    }).then(
      () => undefined,
      (error: unknown) => error
    );

    expect(failure).toBeInstanceOf(Error);
    expect(failure instanceof Error ? failure.message : "").toContain("rollback failed for .skillset/changes/amendments.jsonl");
    expect(failure instanceof Error ? failure.message : "").toContain("original error: injected writer failure");
    expect(failure instanceof Error ? failure.cause : undefined).toBe(original);
    expect(await Bun.file(join(root, LEDGER)).exists()).toBe(false);
  });

  test("migrate plans the migration inside the ledger lock", async () => {
    const root = await fixture();
    await commitFixture(root);
    await writeFile(join(root, ".skillset/skills/demo/SKILL.md"), skill("Changed body."), "utf8");
    const demo = (await changeStatus(root, { since: "HEAD" })).sourceChanges.find((change) => change.id === "skill:demo");
    const pendingPath = join(root, ".skillset/changes/legacy.md");
    const frontmatter = [
      "---",
      "id: abcdef123456",
      "bump: patch",
      "scope: skill:demo",
      "evidence:",
      "  - scope: skill:demo",
      `    currentHash: ${demo?.currentHash}`,
      "---",
      "",
    ].join("\n");
    await writeFile(pendingPath, `${frontmatter}Reason planned before the lock was taken by the migration.\n`, "utf8");

    await migratePendingChangeEntries(root, {
      lock: {
        afterLockAcquired: async () => {
          await writeFile(pendingPath, `${frontmatter}Reason a concurrent writer committed just before the migration.\n`, "utf8");
        },
      },
      write: true,
    });

    expect(await readFile(join(root, ".skillset/changes/abcdef123456.md"), "utf8")).toContain(
      "Reason a concurrent writer committed just before the migration."
    );
  });

  test("amend reads the applied entry inside the ledger lock", async () => {
    const root = await fixture();
    await writeFile(
      join(root, ".skillset/changes/history.jsonl"),
      `${JSON.stringify({
        appliedAt: "2026-09-20T00:00:00.000Z",
        bump: "patch",
        id: "a1b2c3d4e5f6",
        reason: "Original applied reason recorded by an earlier release.",
        scopes: ["skill:demo"],
      })}\n`,
      "utf8"
    );

    await amendAppliedChange(root, {
      lock: {
        afterLockAcquired: async () => {
          await appendFile(
            join(root, AMENDMENTS),
            `${JSON.stringify({
              amendedAt: "2026-09-21T00:00:00.000Z",
              id: "a1b2c3d4e5f6",
              previousReason: "Original applied reason recorded by an earlier release.",
              reason: "Concurrent amendment committed just before this one.",
            })}\n`,
            "utf8"
          );
        },
      },
      reason: { kind: "inline", value: "Second amendment that must record the concurrent reason as previous." },
      ref: "@a1b2c3d4e5f6",
    });

    const amendments = (await readFile(join(root, AMENDMENTS), "utf8"))
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as { readonly previousReason?: string });
    expect(amendments.at(-1)?.previousReason).toBe("Concurrent amendment committed just before this one.");
  });
});

function record(id: string, createdAt: string): string {
  return JSON.stringify({
    createdAt,
    id,
    payload: { reason: `Record ${id}.`, reasonId: id },
    schemaVersion: 1,
    type: "reason.created",
  });
}

async function fixture(): Promise<string> {
  const disposableRoot = await createTestGitFixtureRoot("skillset-ledger-rollback-");
  const root = await mkdtemp(join(disposableRoot, "repo-"));
  await mkdir(join(root, ".skillset/skills/demo"), { recursive: true });
  await mkdir(join(root, ".skillset/changes"), { recursive: true });
  await writeFile(join(root, "skillset.yaml"), "skillset:\n  name: ledger-rollback\nclaude: true\ncodex: false\n", "utf8");
  await writeFile(join(root, ".skillset/skills/demo/SKILL.md"), skill("Baseline body."), "utf8");
  return root;
}

async function commitFixture(root: string): Promise<void> {
  await initializeTestGitRepository(root, { disposableRoot: join(root, "..") });
}

function skill(body: string): string {
  return `---\nname: demo\ndescription: Demo.\n---\n\n${body}\n`;
}
