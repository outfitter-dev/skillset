import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import { readChangeLedger } from "../change-ledger";
import {
  listPendingLedgerEventFiles,
  pendingLedgerEventFile,
  pendingLedgerEventFileName,
  readChangeLedgerTailTimestamp,
} from "../pending-ledger-events";
import { createTestFixtureRoot } from "../../../../scripts/test-helpers/fixture-root";

function record(id: string, createdAt: string): string {
  return JSON.stringify({
    createdAt,
    id,
    payload: { reason: `Reason ${id}.`, reasonId: id },
    schemaVersion: 1,
    type: "reason.created",
  });
}

async function workspace(files: Readonly<Record<string, string>>): Promise<string> {
  const root = await createTestFixtureRoot("skillset-pending-ledger-events-");
  for (const [path, content] of Object.entries(files)) {
    await mkdir(join(root, path, ".."), { recursive: true });
    await writeFile(join(root, path), content, "utf8");
  }
  return root;
}

describe("ADR-0045 pending ledger event files", () => {
  test("names a file from the mutation's stamp and first event id", () => {
    expect(pendingLedgerEventFileName("2026-10-27T16:28:05.936Z", "evt-62b51b1f")).toBe(
      "20261027T162805936Z-evt-62b51b1f.jsonl"
    );
    expect(pendingLedgerEventFile(undefined, "2026-10-27T16:28:05.936Z", "evt-1")).toBe(
      ".skillset/changes/events/20261027T162805936Z-evt-1.jsonl"
    );
    expect(() => pendingLedgerEventFileName("2026-10-27T16:28:05Z", "evt-1")).toThrow("milliseconds");
    expect(() => pendingLedgerEventFileName("2026-10-27T16:28:05.936Z", "../evt")).toThrow("cannot name");
  });

  test("lists pending files in name order, skipping dotfiles and refusing misnamed entries", async () => {
    const root = await workspace({
      ".skillset/changes/events/.gitkeep": "",
      ".skillset/changes/events/20261027T000000002Z-evt-b.jsonl": `${record("evt-b", "2026-10-27T00:00:00.002Z")}\n`,
      ".skillset/changes/events/20261027T000000001Z-evt-a.jsonl": `${record("evt-a", "2026-10-27T00:00:00.001Z")}\n`,
    });
    expect(await listPendingLedgerEventFiles(root, undefined)).toEqual([
      ".skillset/changes/events/20261027T000000001Z-evt-a.jsonl",
      ".skillset/changes/events/20261027T000000002Z-evt-b.jsonl",
    ]);

    await writeFile(join(root, ".skillset/changes/events/notes.jsonl"), "", "utf8");
    await expect(listPendingLedgerEventFiles(root, undefined)).rejects.toThrow(
      "is not a pending change ledger event file"
    );
  });

  test("folds ledger.jsonl, then pending files by name, then records by line", async () => {
    const root = await workspace({
      ".skillset/changes/ledger.jsonl": `${record("evt-trunk", "2026-10-27T00:00:00.009Z")}\n`,
      ".skillset/changes/events/20261027T000000002Z-evt-c.jsonl":
        `${record("evt-c", "2026-10-27T00:00:00.002Z")}\n${record("evt-d", "2026-10-27T00:00:00.002Z")}\n`,
      ".skillset/changes/events/20261027T000000001Z-evt-b.jsonl": `${record("evt-b", "2026-10-27T00:00:00.001Z")}\n`,
    });

    const events = await readChangeLedger(root);
    expect(events.map((event) => event.id)).toEqual(["evt-trunk", "evt-b", "evt-c", "evt-d"]);
    expect(events.map((event) => event.path)).toEqual([
      ".skillset/changes/ledger.jsonl",
      ".skillset/changes/events/20261027T000000001Z-evt-b.jsonl",
      ".skillset/changes/events/20261027T000000002Z-evt-c.jsonl",
      ".skillset/changes/events/20261027T000000002Z-evt-c.jsonl",
    ]);
    expect(await readChangeLedgerTailTimestamp(root, undefined)).toBe("2026-10-27T00:00:00.009Z");
  });

  test("rejects an event id repeated across streams", async () => {
    const root = await workspace({
      ".skillset/changes/ledger.jsonl": `${record("evt-a", "2026-10-27T00:00:00.000Z")}\n`,
      ".skillset/changes/events/20261027T000000001Z-evt-a.jsonl": `${record("evt-a", "2026-10-27T00:00:00.001Z")}\n`,
    });
    await expect(readChangeLedger(root)).rejects.toThrow("duplicate change ledger event id evt-a");
  });
});
