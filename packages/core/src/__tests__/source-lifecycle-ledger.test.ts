/* eslint-disable func-style, no-use-before-define -- Lifecycle fixtures stay adjacent to their scenarios. */

import { describe, expect, test } from "bun:test";
import { appendFile, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { buildSkillset } from "../build";
import {
  draftSource,
  planSourceDraft,
  planSourcePromotion,
  promoteSource,
} from "../source-draft";
import { sourceLifecycleLedgerRecord, type SourceLifecycleLedgerEvent } from "../source-lifecycle-ledger";
import { moveSource, planSourceMove } from "../source-move";
import { applyWorkspaceTransaction } from "../workspace-transaction";
import { PENDING_LEDGER_EVENT_FILE, readFoldedLedger } from "../../../../scripts/test-helpers/change-ledger";
import { createTestFixtureRoot } from "../../../../scripts/test-helpers/fixture-root";

const LEDGER = ".skillset/changes/ledger.jsonl";
const PENDING_EVENTS = ".skillset/changes/events";

describe("sourceLifecycleLedgerRecord", () => {
  const drafted: SourceLifecycleLedgerEvent = {
    payload: { draft: "skill:demo#draft", shipped: "skill:demo", sourceHash: "a".repeat(64) },
    type: "source.drafted",
  };

  test("builds a schema-versioned record for the event", () => {
    expect(sourceLifecycleLedgerRecord("", drafted, Date.parse("2026-01-02T03:04:05.000Z"))).toMatchObject({
      createdAt: "2026-01-02T03:04:05.000Z",
      id: expect.stringMatching(/^source-drafted-/),
      payload: drafted.payload,
      schemaVersion: 1,
      type: "source.drafted",
    });
  });

  test("never stamps before the ledger tail", () => {
    const tail = `${foreignEvent("evt-tail", "2030-01-01T00:00:00.000Z")}\n`;
    expect(sourceLifecycleLedgerRecord(tail, drafted, 0)).toMatchObject({ createdAt: "2030-01-01T00:00:00.000Z" });
  });

  // TF-001: two branches running the same lifecycle command from the same trunk
  // ledger must not mint the same id, or the union-merged ledger is unreadable.
  test("gives the same event on the same ledger a distinct id per invocation", () => {
    const trunk = `${foreignEvent("evt-trunk", "2026-01-01T00:00:00.000Z")}\n`;
    const first = sourceLifecycleLedgerRecord(trunk, drafted, 1);
    const second = sourceLifecycleLedgerRecord(trunk, drafted, 1);
    expect(Reflect.get(first, "id")).not.toBe(Reflect.get(second, "id"));
  });
});

describe("SET-660 lifecycle ledger appends", () => {
  test("a draft keeps a foreign ledger line appended between plan and apply", async () => {
    const root = await fixture({
      ".skillset/skills/demo/SKILL.md": skill("demo", "Shipped demo."),
      "skillset.yaml": config(),
    });
    await buildSkillset(root);
    const request = { rootPath: root, shippedPath: ".skillset/skills/demo" };
    const plan = await planSourceDraft(request);
    const foreign = foreignEvent("evt-foreign-draft-race", "2026-09-25T00:00:00.000Z");

    await draftSource({
      ...request,
      expectedPlanHash: plan.planHash,
      transactionOptions: {
        testHooks: {
          beforeInitialInspection: () => appendForeign(root, foreign),
        },
      },
    });

    const lines = await ledgerLines(root);
    expect(lines[0]).toBe(foreign);
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[1] ?? "{}")).toMatchObject({ type: "source.drafted" });
  });

  test("a move keeps a foreign ledger line appended between plan and apply", async () => {
    const root = await fixture({
      ".skillset/plugins/tools/skillset.yaml": "skillset:\n  name: tools\n",
      ".skillset/skills/demo/SKILL.md": skill("demo", "Shipped demo."),
      "skillset.yaml": config(),
    });
    await buildSkillset(root);
    const request = {
      from: ".skillset/skills/demo",
      rootPath: root,
      to: ".skillset/plugins/tools/skills/demo",
    };
    const plan = await planSourceMove(request);
    const foreign = foreignEvent("evt-foreign-move-race", "2026-09-25T00:00:00.000Z");

    await moveSource({
      ...request,
      expectedPlanHash: plan.planHash,
      transactionOptions: {
        testHooks: {
          beforeInitialInspection: () => appendForeign(root, foreign),
        },
      },
    });

    const lines = await ledgerLines(root);
    expect(lines[0]).toBe(foreign);
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[1] ?? "{}")).toMatchObject({ type: "source.moved" });
  });

  test("a failed promote rolls back only its own ledger line", async () => {
    const root = await fixture({
      ".skillset/skills/demo/SKILL.md": skill("demo", "Shipped demo."),
      "skillset.yaml": config(),
    });
    await buildSkillset(root);
    const draftRequest = { rootPath: root, shippedPath: ".skillset/skills/demo" };
    const fork = await planSourceDraft(draftRequest);
    await draftSource({ ...draftRequest, expectedPlanHash: fork.planHash });
    await writeFile(
      join(root, ".skillset/skills/_drafts/demo/SKILL.md"),
      skill("demo", "Edited draft.")
    );
    await buildSkillset(root);
    const before = await ledgerLines(root);
    const request = { draftPath: ".skillset/skills/_drafts/demo", rootPath: root };
    const plan = await planSourcePromotion(request);
    const foreign = foreignEvent("evt-foreign-promote-race", "2026-09-25T00:00:00.000Z");

    await expect(
      promoteSource({
        ...request,
        expectedPlanHash: plan.planHash,
        transactionOptions: {
          testHooks: {
            beforeApply: async (operation) => {
              if (operation.kind !== "delete") return;
              await appendForeign(root, foreign);
              throw new Error("injected promotion failure after the ledger append");
            },
          },
        },
      })
    ).rejects.toThrow("injected promotion failure after the ledger append");

    // The foreign line went to ledger.jsonl, which folds before pending files.
    expect(await ledgerLines(root)).toEqual([foreign, ...before]);
  });
});

describe("SET-660 lifecycle write reports", () => {
  test("a draft reports only the paths it wrote, not the shipped source it read", async () => {
    const root = await fixture({
      ".skillset/skills/demo/SKILL.md": skill("demo", "Shipped demo."),
      "skillset.yaml": config(),
    });
    await buildSkillset(root);
    const request = { rootPath: root, shippedPath: ".skillset/skills/demo" };
    const plan = await planSourceDraft(request);

    const report = await draftSource({ ...request, expectedPlanHash: plan.planHash });

    expect(report.writtenPaths).not.toContain(".skillset/skills/demo");
    expect(report.writtenPaths).toContain(".skillset/skills/_drafts/demo");
    expect(report.writtenPaths).toContainEqual(expect.stringMatching(PENDING_LEDGER_EVENT_FILE));
    expect(report.writtenPaths).not.toContain(PENDING_EVENTS);
  });
});

describe("SET-660 workspace transaction appends", () => {
  test("builds records from the bytes read at apply time", async () => {
    const root = await fixture({ "stream.jsonl": '{"id":"a"}\n' });
    const seen: string[] = [];

    await applyWorkspaceTransaction(root, {
      appends: [{ path: "stream.jsonl", records: (current) => {
        seen.push(current);
        return [{ id: "b" }];
      } }],
    });

    expect(seen).toEqual(['{"id":"a"}\n']);
    expect(await readFile(join(root, "stream.jsonl"), "utf8")).toBe('{"id":"a"}\n{"id":"b"}\n');
  });

  test("refuses to append through a symlinked stream leaf", async () => {
    if (process.platform === "win32") return;
    const root = await fixture({ "workspace/keep.txt": "keep\n", "outside/stream.jsonl": '{"id":"a"}\n' });
    const workspace = join(root, "workspace");
    await symlink(join(root, "outside/stream.jsonl"), join(workspace, "stream.jsonl"));

    await expect(
      applyWorkspaceTransaction(workspace, {
        appends: [{ path: "stream.jsonl", records: () => [{ id: "b" }] }],
      })
    ).rejects.toThrow("refusing to write through symbolic link: stream.jsonl");
    expect(await readFile(join(root, "outside/stream.jsonl"), "utf8")).toBe('{"id":"a"}\n');
  });

  test("refuses a stream without a trailing newline and a path shared with a write", async () => {
    const root = await fixture({ "stream.jsonl": '{"id":"a"}' });
    const records = () => [{ id: "b" }];

    await expect(
      applyWorkspaceTransaction(root, { appends: [{ path: "stream.jsonl", records }] })
    ).rejects.toThrow("append target does not end with a newline: stream.jsonl");
    await expect(
      applyWorkspaceTransaction(root, {
        appends: [{ path: "stream.jsonl", records }],
        writes: [{ content: "{}\n", path: "stream.jsonl" }],
      })
    ).rejects.toThrow("conflicting planned operations for stream.jsonl");
    expect(await readFile(join(root, "stream.jsonl"), "utf8")).toBe('{"id":"a"}');
  });
});

function foreignEvent(id: string, createdAt: string): string {
  return JSON.stringify({
    createdAt,
    id,
    payload: { reason: "Foreign append during a lifecycle transaction.", reasonId: id },
    schemaVersion: 1,
    type: "reason.created",
  });
}

async function appendForeign(root: string, line: string): Promise<void> {
  await mkdir(join(root, ".skillset/changes"), { recursive: true });
  await appendFile(join(root, LEDGER), `${line}\n`, "utf8");
}

/** The folded ledger: `ledger.jsonl`, then pending event files (ADR-0045). */
async function ledgerLines(root: string): Promise<readonly string[]> {
  return (await readFoldedLedger(root))
    .split("\n")
    .filter((line) => line.length > 0);
}

function config(): string {
  return "skillset:\n  name: lifecycle-ledger\ncompile:\n  targets: [codex]\n";
}

function skill(name: string, description: string): string {
  return `---\nname: ${name}\ndescription: ${description}\n---\n\n${description}\n`;
}

async function fixture(files: Readonly<Record<string, string>>): Promise<string> {
  const root = await createTestFixtureRoot("skillset-lifecycle-ledger-");
  for (const [path, content] of Object.entries(files)) {
    const target = join(root, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content, "utf8");
  }
  return root;
}
