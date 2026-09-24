import { describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createTestFixtureRoot } from "../../../../scripts/test-helpers/fixture-root";

import { readPendingChangeEntries } from "../change-entries";
import { readAppliedChangeRecords } from "../change-workflow";

describe("source move identity epochs", () => {
  test("keeps new evidence at a reused selector separate from pre-move evidence", async () => {
    const oldHash = `sha256:${"a".repeat(64)}`;
    const newHash = `sha256:${"b".repeat(64)}`;
    const oldId = "aaaaaaaaaaaa";
    const newId = "bbbbbbbbbbbb";
    const event = (id: string, type: string, payload: object) => JSON.stringify({
      createdAt: "2026-09-17T00:00:00.000Z",
      id,
      payload,
      schemaVersion: 1,
      type,
    });
    const ledger = [
      event("old-reason", "reason.created", { bump: "minor", reasonId: oldId, sourceUnits: [{ selector: "skill:demo", sourceHash: oldHash }] }),
      event("move", "source.moved", { from: "skill:demo", to: "plugin.tools.skill:demo" }),
      event("new-reason", "reason.created", { bump: "minor", reasonId: newId, sourceUnits: [{ selector: "skill:demo", sourceHash: newHash }] }),
    ];
    const history = [
      { id: oldId, scopes: ["skill:demo"], evidence: [{ scope: "skill:demo", sourceHash: oldHash }] },
      { id: newId, sourceMoveCursor: "move", scopes: ["skill:demo"], evidence: [{ scope: "skill:demo", sourceHash: newHash }] },
    ];
    const root = await createTestFixtureRoot("skillset-move-epochs-");
    for (const [path, content] of Object.entries({
      ".skillset/changes/ledger.jsonl": `${ledger.join("\n")}\n`,
      ".skillset/changes/history.jsonl": `${history.map((record) => JSON.stringify(record)).join("\n")}\n`,
      [`.skillset/changes/${oldId}.md`]: "Old reason.\n",
      [`.skillset/changes/${newId}.md`]: "New reason.\n",
      "skillset.yaml": "skillset:\n  name: move-fixture\n",
    })) {
      const target = join(root, path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, content, "utf8");
    }

    const historyRecords = await readAppliedChangeRecords(root);
    expect(historyRecords.map((record) => [record.id, record.scopes, [...record.sourceHashes]])).toEqual([
      [oldId, ["plugin.tools.skill:demo"], [["plugin.tools.skill:demo", [oldHash]]]],
      [newId, ["skill:demo"], [["skill:demo", [newHash]]]],
    ]);
    const pending = await readPendingChangeEntries(root);
    expect(pending.map((entry) => [entry.id, entry.scopes, [...entry.sourceHashes]])).toEqual([
      [oldId, ["plugin.tools.skill:demo"], [["plugin.tools.skill:demo", [oldHash]]]],
      [newId, ["skill:demo"], [["skill:demo", [newHash]]]],
    ]);
  });
});
