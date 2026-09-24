import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import { readChangeLedger } from "../change-ledger";
import { createTestFixtureRoot } from "../../../../scripts/test-helpers/fixture-root";

describe("readChangeLedger", () => {
  test("reads every initial schema-versioned event type in append order", async () => {
    const root = await ledgerFixture([
      event("evt-001", "reason.created", { reasonId: "change-1", reason: "Add a reason." }),
      event("evt-002", "reason.updated", { reasonId: "change-1", reason: "Update the reason." }),
      event("evt-003", "change.covered", {
        evidence: [{ hashSchema: "skillset-source-unit-v2", selector: "skill:demo", sourceHash: hash("1") }],
        reasonId: "change-1",
      }),
      event("evt-004", "change.ignored", {
        reasonId: "change-2",
        scopes: ["skill:ignored"],
      }),
      event("evt-005", "release.applied", {
        releaseId: "release-1",
        reasonIds: ["change-1"],
        scopes: [{
          bump: "patch",
          entries: ["change-1"],
          hashSchema: "skillset-source-unit-v2",
          previousVersion: "0.1.0",
          selector: "skill:demo",
          sourceHash: hash("1"),
          version: "0.1.1",
        }],
        sourceUnits: [{ hashSchema: "skillset-source-unit-v2", selector: "skill:demo", sourceHash: hash("1") }],
      }),
      event("evt-006", "change.amended", { changeId: "change-1", reason: "Correct wording." }),
      event("evt-007", "release.amended", { releaseId: "release-1", reason: "Correct release wording." }),
      event("evt-008", "baseline.recorded", {
        sourceUnits: [{ hashSchema: "skillset-source-unit-v2", selector: "config:root", sourceHash: hash("2") }],
      }),
      event("evt-009", "source.moved", {
        from: "standalone-skill:demo",
        to: "plugin-skill:tools/demo",
      }),
      event("evt-010", "source.drafted", {
        draft: "plugin.tools.skill:demo#draft",
        shipped: "plugin-skill:tools/demo",
        sourceHash: hash("3"),
      }),
      event("evt-011", "source.promoted", {
        draft: "plugin.tools.skill:demo#draft",
        draftEventId: "evt-010",
        shipped: "plugin-skill:tools/demo",
      }),
    ]);

    const events = await readChangeLedger(root);

    expect(events.map((item) => item.id)).toEqual([
      "evt-001",
      "evt-002",
      "evt-003",
      "evt-004",
      "evt-005",
      "evt-006",
      "evt-007",
      "evt-008",
      "evt-009",
      "evt-010",
      "evt-011",
    ]);
    expect(events.map((item) => item.type)).toEqual([
      "reason.created",
      "reason.updated",
      "change.covered",
      "change.ignored",
      "release.applied",
      "change.amended",
      "release.amended",
      "baseline.recorded",
      "source.moved",
      "source.drafted",
      "source.promoted",
    ]);
    expect(events[2]?.sourceUnits).toEqual([
      { hashSchema: "skillset-source-unit-v2", selector: "skill:demo", sourceHash: hash("1") },
    ]);
    expect(events[2]?.payload).toEqual({
      reasonId: "change-1",
      sourceUnits: [{ hashSchema: "skillset-source-unit-v2", selector: "skill:demo", sourceHash: hash("1") }],
    });
    expect(events[4]?.payload).toEqual({
      changeIds: ["change-1"],
      releaseId: "release-1",
      scopes: [{
        bump: "patch",
        changeIds: ["change-1"],
        hashSchema: "skillset-source-unit-v2",
        previousVersion: "0.1.0",
        selector: "skill:demo",
        sourceHash: hash("1"),
        version: "0.1.1",
      }],
      sourceUnits: [{ hashSchema: "skillset-source-unit-v2", selector: "skill:demo", sourceHash: hash("1") }],
    });
    expect(events[7]?.line).toBe(8);
    expect(events[8]?.payload).toEqual({
      from: "skill:demo",
      to: "plugin.tools.skill:demo",
    });
    expect(events[9]?.payload).toEqual({
      draft: "plugin.tools.skill:demo#draft",
      shipped: "plugin.tools.skill:demo",
      sourceHash: hash("3"),
    });
    expect(events[10]?.payload).toEqual({
      draft: "plugin.tools.skill:demo#draft",
      draftEventId: "evt-010",
      shipped: "plugin.tools.skill:demo",
    });
  });

  test("normalizes historical source-unit selectors and preserves hash schema metadata", async () => {
    const root = await ledgerFixture([
      event("evt-001", "baseline.recorded", {
        evidence: [
          { hashSchemaId: "skillset-source-unit-v1", scope: "standalone-skill:demo", sourceHash: hash("1") },
          { hashSchema: "skillset-source-unit-v2", selector: "plugin-skill:tools/search", sourceHash: hash("2") },
          "target-native-island:codex:plugin:tools:hooks/hooks.json",
        ],
      }),
    ]);

    const [record] = await readChangeLedger(root);

    expect(record?.sourceUnits).toEqual([
      { selector: "plugin.tools.codex.hooks:hooks/hooks.json" },
      { hashSchema: "skillset-source-unit-v2", selector: "plugin.tools.skill:search", sourceHash: hash("2") },
      { hashSchema: "skillset-source-unit-v1", selector: "skill:demo", sourceHash: hash("1") },
    ]);
  });

  test("returns an empty ledger when the file is absent", async () => {
    const root = await createTestFixtureRoot("skillset-ledger-empty-");

    await expect(readChangeLedger(root)).resolves.toEqual([]);
  });

  test("fails with a precise line diagnostic for malformed JSONL", async () => {
    const root = await createTestFixtureRoot("skillset-ledger-malformed-");
    await mkdir(join(root, ".skillset/changes"), { recursive: true });
    await writeFile(
      join(root, ".skillset/changes/ledger.jsonl"),
      `${JSON.stringify(event("evt-001", "reason.created", { reasonId: "change-1" }))}\n{nope\n`,
      "utf8"
    );

    await expect(readChangeLedger(root)).rejects.toThrow("invalid JSON in .skillset/changes/ledger.jsonl:2");
  });

  test("fails loudly for duplicate event ids", async () => {
    const root = await ledgerFixture([
      event("evt-001", "reason.created", { reasonId: "change-1" }),
      event("evt-001", "reason.updated", { reasonId: "change-1" }),
    ]);

    await expect(readChangeLedger(root)).rejects.toThrow("duplicate change ledger event id evt-001");
  });

  test("rejects malformed event envelopes and payloads", async () => {
    const unsupportedType = await ledgerFixture([
      { createdAt: "2026-06-30T00:00:00.000Z", id: "evt-001", payload: {}, schemaVersion: 1, type: "unknown.event" },
    ]);
    await expect(readChangeLedger(unsupportedType)).rejects.toThrow("type must be a supported change ledger event");

    const missingSourceUnit = await ledgerFixture([
      event("evt-002", "change.covered", { reasonId: "change-1" }),
    ]);
    await expect(readChangeLedger(missingSourceUnit)).rejects.toThrow("payload requires at least one source unit selector");

    const malformedDraftHash = await ledgerFixture([
      event("evt-003", "source.drafted", {
        draft: "skill:demo#draft",
        shipped: "skill:demo",
        sourceHash: "sha256:nope",
      }),
    ]);
    await expect(readChangeLedger(malformedDraftHash)).rejects.toThrow("sourceHash must be a sha256 digest");

    const mismatchedDraft = await ledgerFixture([
      event("evt-004", "source.promoted", {
        draft: "skill:other#draft",
        shipped: "skill:demo",
      }),
    ]);
    await expect(readChangeLedger(mismatchedDraft)).rejects.toThrow(
      "draft must be the shipped selector with #draft provenance"
    );
  });
});

async function ledgerFixture(records: readonly object[]): Promise<string> {
  const root = await createTestFixtureRoot("skillset-ledger-");
  await mkdir(join(root, ".skillset/changes"), { recursive: true });
  await writeFile(
    join(root, ".skillset/changes/ledger.jsonl"),
    `${records.map((record) => JSON.stringify(record)).join("\n")}\n`,
    "utf8"
  );
  return root;
}

function event(id: string, type: string, payload: object): object {
  return {
    createdAt: "2026-06-30T00:00:00.000Z",
    id,
    payload,
    schemaVersion: 1,
    type,
  };
}

function hash(seed: string): string {
  return `sha256:${seed.repeat(64).slice(0, 64)}`;
}
