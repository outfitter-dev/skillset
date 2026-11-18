import { expect, test } from "bun:test";
import { mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { MIGRATION_STATE_SCHEMA_VERSION, type MigrationObservation, type MigrationState } from "@skillset/schema";
import { createTestFixtureRoot } from "../../../../scripts/test-helpers/fixture-root";
import { reconcileMigrationState } from "../migration-state-reconcile";
import { hashMigrationState, readMigrationState, planMigrationStateWrite } from "../migration-state";
import { applyWorkspaceTransaction } from "../workspace-transaction";

const empty: MigrationState = { schemaVersion: MIGRATION_STATE_SCHEMA_VERSION, flags: [] };
const observation = (path = ".skillset/skills/demo/SKILL.md"): MigrationObservation => ({
  code: "ambiguous-reference", severity: "error", disposition: "ambiguous", message: "Review the literal reference.",
  source: { path, line: 5 }, fingerprints: { content: `sha256:${"a".repeat(64)}`, context: `sha256:${"b".repeat(64)}` },
  placement: { kind: "inline", label: "todo", line: 4 }, evidence: [{ summary: "Literal filename." }], relatedReportIds: [],
});
const scan = (...items: MigrationObservation[]) => reconcileMigrationState(empty, items).state;

test("initial identity is deterministic and includes evidence and occurrence, not just location", () => {
  const a = observation();
  const b = observation("other.md");
  const forward = scan(a, b);
  expect(forward).toEqual(scan(b, a));
  expect(new Set(forward.flags.map((flag) => flag.id)).size).toBe(2);
  expect(scan(a).flags[0]?.id).not.toBe(scan({ ...a, fingerprints: { ...a.fingerprints, content: `sha256:${"c".repeat(64)}` } }).flags[0]?.id);
});

test("explicit identity moves first and unique fingerprints relocate without losing decisions", () => {
  const initial = scan(observation());
  const flag = initial.flags[0]!;
  const accepted: MigrationState = { ...initial, flags: [{ ...flag, state: "accepted", resolution: { reason: "Intentional literal.", at: "2026-10-29T18:00:00.000Z" } }] };
  for (const id of [undefined, flag.id]) {
    const moved = reconcileMigrationState(accepted, [{ ...observation("moved.md"), ...(id ? { id } : {}) }]);
    expect(moved.state.flags[0]).toMatchObject({ id: flag.id, state: "accepted", source: { path: "moved.md" }, resolution: { reason: "Intentional literal." } });
    expect(moved.diagnostics.map((item) => item.code)).toContain("migration/stale-location");
  }
});

test("matching reserves explicit identities before fallback and refuses ambiguous fingerprints", () => {
  const initial = scan(observation("a.md"), observation("b.md"));
  const explicit = initial.flags.find((flag) => flag.source.path === "a.md")!;
  const result = reconcileMigrationState(initial, [observation("c.md"), { ...observation("d.md"), id: explicit.id }]);
  expect(result.state.flags.find((flag) => flag.id === explicit.id)?.source.path).toBe("d.md");
  expect(result.state.flags.find((flag) => flag.id !== explicit.id)?.source.path).toBe("c.md");
  const ambiguous = reconcileMigrationState(initial, [observation("c.md")]);
  expect(ambiguous.state).toEqual(initial);
  expect(ambiguous.diagnostics.some((item) => item.code === "migration/ambiguous-identity")).toBe(true);
  const one = scan(observation());
  expect(reconcileMigrationState(one, [observation("a.md"), observation("b.md")]).state).toEqual(one);
});

test("duplicate IDs, duplicate observations and orphan explicit anchors never merge or mint authority", () => {
  const initial = scan(observation());
  const flag = initial.flags[0]!;
  for (const items of [[{ ...observation(), id: flag.id }, { ...observation("b.md"), id: flag.id }], [observation(), observation()]]) {
    const result = reconcileMigrationState(initial, items);
    expect(result.state).toEqual(initial);
    expect(result.diagnostics.some((item) => item.code === "migration/duplicate")).toBe(true);
  }
  const orphan = reconcileMigrationState(empty, [{ ...observation(), id: "adopt-unknown" }]);
  expect(orphan.state.flags).toEqual([]);
  expect(orphan.diagnostics[0]?.code).toBe("migration/orphan");
  expect(() => reconcileMigrationState({ ...initial, flags: [flag, flag] }, [])).toThrow("duplicate");
});

test("missing observations and changed explicit evidence preserve open and accepted records", () => {
  const initial = scan(observation());
  expect(reconcileMigrationState(initial, []).state).toEqual(initial);
  expect(reconcileMigrationState(initial, []).diagnostics[0]?.code).toBe("migration/orphan");
  const flag = initial.flags[0]!;
  const accepted: MigrationState = { ...initial, flags: [{ ...flag, state: "accepted", resolution: { reason: "Reviewed.", at: "2026-10-29T18:00:00.000Z" } }] };
  const changed = reconcileMigrationState(accepted, [{ ...observation(), id: flag.id, fingerprints: { ...flag.fingerprints, context: `sha256:${"c".repeat(64)}` } }]);
  expect(changed.state).toEqual(accepted);
  expect(changed.diagnostics[0]?.code).toBe("migration/stale-evidence");
});

test("sidecar flags are reconciled without requiring an inline anchor", () => {
  const item = { ...observation("settings.json"), placement: { kind: "sidecar" as const, reason: "JSON has no comment anchors." } };
  const initial = scan(item);
  expect(reconcileMigrationState(initial, [item])).toEqual({ state: initial, diagnostics: [] });
});

test("workspace hash is order independent but includes review decisions", () => {
  const initial = scan(observation("a.md"), observation("b.md"));
  expect(hashMigrationState(initial)).toBe(hashMigrationState({ ...initial, flags: [...initial.flags].reverse() }));
  expect(hashMigrationState(initial)).toMatch(/^migration-state:sha256:[a-f0-9]{64}$/);
  expect(hashMigrationState(initial)).not.toBe(hashMigrationState({ ...initial, flags: initial.flags.map((flag) => ({ ...flag, state: "accepted", resolution: { reason: "Reviewed.", at: "2026-10-29T18:00:00.000Z" } })) }));
});

test("ledger reads distinguish absence from malformed content and retain exact write preimages", async () => {
  const root = await createTestFixtureRoot("migration-state-");
  const absent = await readMigrationState(root);
  expect(absent.state).toEqual(empty);
  await applyWorkspaceTransaction(root, { writes: [planMigrationStateWrite(absent, scan(observation()))] });
  const loaded = await readMigrationState(root);
  expect(loaded.state.flags).toHaveLength(1);
  const path = join(root, ".skillset/adopt/state.json");
  const bytes = await readFile(path, "utf8");
  await writeFile(path, `${bytes} `);
  await expect(applyWorkspaceTransaction(root, { writes: [planMigrationStateWrite(loaded, empty)] })).rejects.toThrow();
  expect(await readFile(path, "utf8")).toBe(`${bytes} `);
  await writeFile(path, "{bad");
  await expect(readMigrationState(root)).rejects.toThrow("not valid JSON");
  await writeFile(path, "{}");
  await expect(readMigrationState(root)).rejects.toThrow("schemaVersion");
});

test("ledger plans reject concurrent creation, symlink ancestry, and roll back late failure", async () => {
  const root = await createTestFixtureRoot("migration-state-race-");
  const absent = await readMigrationState(root);
  const plan = { writes: [planMigrationStateWrite(absent, scan(observation()))] };
  await expect(applyWorkspaceTransaction(root, plan, { testHooks: { beforeWriteInstall: () => { throw new Error("injected"); } } })).rejects.toThrow("injected");
  expect((await readMigrationState(root)).state).toEqual(empty);
  await mkdir(join(root, ".skillset/adopt"), { recursive: true });
  await writeFile(join(root, ".skillset/adopt/state.json"), "authored concurrently");
  await expect(applyWorkspaceTransaction(root, plan)).rejects.toThrow();
  expect(await readFile(join(root, ".skillset/adopt/state.json"), "utf8")).toBe("authored concurrently");
  const other = await createTestFixtureRoot("migration-state-outside-");
  const linked = await createTestFixtureRoot("migration-state-linked-");
  await symlink(other, join(linked, ".skillset"), process.platform === "win32" ? "junction" : "dir");
  await expect(readMigrationState(linked)).rejects.toThrow();
  await expect(applyWorkspaceTransaction(linked, plan)).rejects.toThrow();
});

test("changed review evidence cannot carry an accepted or resolved decision through either matching path", () => {
  const initial = scan(observation());
  const flag = initial.flags[0]!;
  for (const state of ["accepted", "resolved"] as const) {
    const reviewed: MigrationState = { ...initial, flags: [{ ...flag, state, resolution: { reason: "Based on original evidence.", at: "2026-10-29T18:00:00.000Z" } }] };
    for (const id of [undefined, flag.id]) {
      for (const change of [
        { evidence: [{ summary: "Prior provider evidence was withdrawn." }] },
        { message: "The same text now has a different interpretation." },
        { origin: { path: "different-origin.md" } },
      ]) {
        const result = reconcileMigrationState(reviewed, [{ ...observation(), ...change, ...(id ? { id } : {}) }]);
        expect(result.state).toEqual(reviewed);
        expect(result.diagnostics.some((item) => item.code === "migration/stale-evidence" && item.severity === "error")).toBe(true);
      }
    }
  }
});

test("evidence order is not a semantic change during relocation", () => {
  const item = { ...observation(), evidence: [{ summary: "First source." }, { summary: "Second source.", reference: "fixture:second" }] };
  const initial = scan(item);
  const result = reconcileMigrationState(initial, [{ ...item, source: { path: "moved.md" }, evidence: [...item.evidence].reverse() }]);
  expect(result.diagnostics.every((entry) => entry.severity !== "error")).toBe(true);
  expect(result.state.flags[0]?.source.path).toBe("moved.md");
});
