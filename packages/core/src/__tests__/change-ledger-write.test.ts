import { link, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { describe, expect, test } from "bun:test";

import {
  appendOwnedJsonlRecords,
  nextJsonlTimestamp,
  nextJsonlTimestampForPaths,
  readJsonlTailTimestamp,
  rollbackOwnedJsonlRecords,
} from "../change-ledger-write";
import { createTestFixtureRoot } from "../../../../scripts/test-helpers/fixture-root";

describe("change ledger JSONL write", () => {
  test("appends records and rolls back only the owned lines", async () => {
    const path = await streamPath("owned-rollback");
    await writeFile(
      path,
      `${JSON.stringify({ createdAt: "2026-09-22T00:00:00.000Z", id: "existing" })}\n`,
      "utf8"
    );

    const owned = await appendOwnedJsonlRecords(path, [
      { createdAt: "2026-09-22T00:00:01.000Z", id: "owned-1" },
      { createdAt: "2026-09-22T00:00:02.000Z", id: "owned-2" },
    ]);
    await appendOwnedJsonlRecords(path, [
      { createdAt: "2026-09-22T00:00:03.000Z", id: "foreign" },
    ]);

    await rollbackOwnedJsonlRecords(path, new Set(owned));

    expect(await readFile(path, "utf8")).toBe(
      `${JSON.stringify({ createdAt: "2026-09-22T00:00:00.000Z", id: "existing" })}\n${JSON.stringify({ createdAt: "2026-09-22T00:00:03.000Z", id: "foreign" })}\n`
    );
  });

  test("publishes the rollback remainder as a new file instead of rewriting in place", async () => {
    const path = await streamPath("atomic-rollback");
    await writeFile(path, `${JSON.stringify({ createdAt: "2026-09-22T00:00:00.000Z", id: "existing" })}\n`, "utf8");
    const owned = await appendOwnedJsonlRecords(path, [{ createdAt: "2026-09-22T00:00:01.000Z", id: "owned" }]);
    const before = await readFile(path, "utf8");
    const previousInode = join(dirname(path), "previous-inode.jsonl");
    await link(path, previousInode);

    await rollbackOwnedJsonlRecords(path, new Set(owned));

    expect(await readFile(previousInode, "utf8")).toBe(before);
    expect(await readFile(path, "utf8")).toBe(`${JSON.stringify({ createdAt: "2026-09-22T00:00:00.000Z", id: "existing" })}\n`);
    expect((await readdir(dirname(path))).filter((name) => name.includes(".tmp-"))).toEqual([]);
  });

  test("deletes a stream that only contained owned records", async () => {
    const path = await streamPath("owned-only");
    const owned = await appendOwnedJsonlRecords(path, [
      { createdAt: "2026-09-22T00:00:01.000Z", id: "owned" },
    ]);

    await rollbackOwnedJsonlRecords(path, new Set(owned));

    expect(await Bun.file(path).exists()).toBe(false);
  });

  test("keeps a later foreign append when owned records are a prefix of the tail", async () => {
    const path = await streamPath("foreign-tail");
    const first = await appendOwnedJsonlRecords(path, [
      { createdAt: "2026-09-22T00:00:01.000Z", id: "first" },
    ]);
    const second = await appendOwnedJsonlRecords(path, [
      { createdAt: "2026-09-22T00:00:02.000Z", id: "second" },
    ]);

    await rollbackOwnedJsonlRecords(path, new Set(first));

    expect(await readFile(path, "utf8")).toBe(`${second[0]}\n`);
  });

  test("uses the current tail when wall-clock would invert", () => {
    expect(nextJsonlTimestamp("2026-09-22T12:00:00.000Z", Date.parse("2026-09-22T11:00:00.000Z"))).toBe(
      "2026-09-22T12:00:00.000Z"
    );
    expect(nextJsonlTimestamp("2026-09-22T12:00:00.000Z", Date.parse("2026-09-22T13:00:00.000Z"))).toBe(
      "2026-09-22T13:00:00.000Z"
    );
    expect(nextJsonlTimestamp(undefined, Date.parse("2026-09-22T10:00:00.000Z"))).toBe(
      "2026-09-22T10:00:00.000Z"
    );
  });

  test("chooses a timestamp that does not invert any named stream tail", async () => {
    const ledger = await streamPath("multi-tail-ledger");
    const history = ledger.replace("ledger.jsonl", "history.jsonl");
    await writeFile(ledger, `${JSON.stringify({ createdAt: "2026-09-22T12:00:00.000Z", id: "ledger-tail" })}\n`, "utf8");
    await writeFile(history, `${JSON.stringify({ appliedAt: "2026-09-22T13:00:00.000Z", id: "history-tail" })}\n`, "utf8");

    expect(await nextJsonlTimestampForPaths([ledger, history], Date.parse("2026-09-22T11:00:00.000Z"))).toBe(
      "2026-09-22T13:00:00.000Z"
    );
  });

  test("reads the last record's timestamp, skipping trailing blank lines", async () => {
    const path = await streamPath("tail-timestamp");
    await writeFile(
      path,
      [
        JSON.stringify({ createdAt: "2026-09-22T00:00:00.000Z", id: "first" }),
        JSON.stringify({ appliedAt: "2026-09-22T00:00:05.000Z", id: "second" }),
        "",
      ].join("\n") + "\n",
      "utf8"
    );

    expect(await readJsonlTailTimestamp(path)).toBe("2026-09-22T00:00:05.000Z");
  });
});

async function streamPath(label: string): Promise<string> {
  const root = await createTestFixtureRoot(`skillset-ledger-write-${label}-`);
  const path = join(root, ".skillset/changes/ledger.jsonl");
  await mkdir(join(root, ".skillset/changes"), { recursive: true });
  return path;
}
