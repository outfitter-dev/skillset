import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createTestFixtureRoot } from "../../../../scripts/test-helpers/fixture-root";
import { recordImportedBodyFindings } from "../adoption-body-findings";
import { inspectMigrationMarkers } from "../migration-markers";
import { createInitialMigrationFlag } from "../migration-state-reconcile";
import { MIGRATION_STATE_PATH, hashMigrationState, readMigrationState } from "../migration-state";
import { MIGRATION_STATE_SCHEMA_VERSION, type MigrationState } from "@skillset/schema";

const path = ".skillset/skills/demo/SKILL.md";
const content = "---\nname: demo\ndescription: Review.\n---\n\nAsk @alice about CLAUDE.md.\n\nRead .claude/plugins/marketplaces/demo.\n";

async function fixture(source = content) {
  const root = await createTestFixtureRoot("skillset-body-findings-");
  await Bun.write(join(root, path), source);
  return root;
}

test("multiple locators preserve exact source bytes, CRLF and shifted finding locations", async () => {
  const results: MigrationState[] = [];
  for (const eol of ["\n", "\r\n"]) {
    const before = content.replaceAll("\n", eol);
    const root = await fixture(before);
    const result = await recordImportedBodyFindings(root, [path, path]);
    const { state } = await readMigrationState(root);
    const after = await readFile(join(root, path), "utf8");
    const inspected = inspectMigrationMarkers({ content: after, path, state });
    expect(inspected.diagnostics).toEqual([]);
    expect(inspected.content).toBe(before);
    expect(result.flags).toHaveLength(3);
    expect(state.flags.filter((flag) => flag.placement.kind === "inline")).toHaveLength(2);
    expect(state.flags.filter((flag) => flag.placement.kind === "sidecar")).toHaveLength(1);
    const lines = after.split(/\r\n|\n/u);
    for (const flag of state.flags) {
      expect(lines[flag.source.line! - 1]).not.toContain("<!--");
      expect(lines[flag.source.line! - 1]?.slice(flag.source.column! - 1)).toMatch(/^(?:@alice|CLAUDE\.md|\.claude\/)/u);
    }
    results.push(state);
  }
  expect(hashMigrationState(results[0]!)).toBe(hashMigrationState(results[1]!));
});

test("adding new-source findings preserves unrelated accepted decisions without a partial reconciliation", async () => {
  const root = await fixture();
  const open = createInitialMigrationFlag({
    code: "adopt.ambiguous-reference", severity: "warning", disposition: "ambiguous", message: "Keep this prior decision.",
    source: { path: ".skillset/skills/old/SKILL.md" }, fingerprints: { content: `sha256:${"a".repeat(64)}`, context: `sha256:${"b".repeat(64)}` },
    placement: { kind: "sidecar", reason: "Prior import." }, evidence: [{ summary: "Prior evidence." }], relatedReportIds: [],
  });
  const prior = { ...open, state: "accepted" as const, resolution: { reason: "Explicitly reviewed.", at: "2026-10-29T18:00:00.000Z" } };
  await Bun.write(join(root, MIGRATION_STATE_PATH), JSON.stringify({ schemaVersion: MIGRATION_STATE_SCHEMA_VERSION, flags: [prior] }));
  const result = await recordImportedBodyFindings(root, [path]);
  const { state } = await readMigrationState(root);
  expect(state.flags.find((flag) => flag.id === prior.id)).toEqual(prior);
  expect(result.flags.every((flag) => flag.state === "open")).toBe(true);
  expect(state.flags).toHaveLength(result.flags.length + 1);
  const snapshot = await readFile(join(root, MIGRATION_STATE_PATH), "utf8");
  await expect(recordImportedBodyFindings(root, [path])).rejects.toThrow("already has migration records");
  expect(await readFile(join(root, MIGRATION_STATE_PATH), "utf8")).toBe(snapshot);
});

test("a concurrent source edit prevents ledger installation and preserves author bytes", async () => {
  const root = await fixture();
  const changed = `${content}\nConcurrent author edit.\n`;
  await expect(recordImportedBodyFindings(root, [path], {
    testHooks: { beforeInitialInspection: async () => { await Bun.write(join(root, path), changed); } },
  })).rejects.toThrow();
  expect(await readFile(join(root, path), "utf8")).toBe(changed);
  expect(await Bun.file(join(root, MIGRATION_STATE_PATH)).exists()).toBe(false);
});

test("a late transaction failure rolls back both locator and ledger writes", async () => {
  const root = await fixture();
  await expect(recordImportedBodyFindings(root, [path], {
    testHooks: { beforeApply: async (_operation, index) => { if (index === 1) throw new Error("injected finding-write failure"); } },
  })).rejects.toThrow("injected finding-write failure");
  expect(await readFile(join(root, path), "utf8")).toBe(content);
  expect(await Bun.file(join(root, MIGRATION_STATE_PATH)).exists()).toBe(false);
});

test("fenced findings bind a read-only source preimage even though they add no locator", async () => {
  const before = "```md\nCLAUDE.md\n```\n";
  const root = await fixture(before);
  const changed = `${before}Authored afterward.\n`;
  await expect(recordImportedBodyFindings(root, [path], {
    testHooks: { beforeInitialInspection: async () => { await Bun.write(join(root, path), changed); } },
  })).rejects.toThrow();
  expect(await readFile(join(root, path), "utf8")).toBe(changed);
  expect(await Bun.file(join(root, MIGRATION_STATE_PATH)).exists()).toBe(false);
});

test("identical mentions at different columns receive distinct initial identities", async () => {
  const root = await fixture("Ask @alice and @alice.\n");
  const result = await recordImportedBodyFindings(root, [path]);
  expect(result.flags).toHaveLength(2);
  expect(new Set(result.flags.map((flag) => flag.id)).size).toBe(2);
  expect(new Set(result.flags.map((flag) => flag.source.column)).size).toBe(2);
});

test("a concurrently created ledger is retained and prevents source annotation", async () => {
  const root = await fixture();
  const concurrent = `${JSON.stringify({ schemaVersion: MIGRATION_STATE_SCHEMA_VERSION, flags: [] })}\n`;
  await expect(recordImportedBodyFindings(root, [path], {
    testHooks: { beforeInitialInspection: async () => { await Bun.write(join(root, MIGRATION_STATE_PATH), concurrent); } },
  })).rejects.toThrow();
  expect(await readFile(join(root, MIGRATION_STATE_PATH), "utf8")).toBe(concurrent);
  expect(await readFile(join(root, path), "utf8")).toBe(content);
});

test("unowned reserved locators never acquire ledger authority through adoption", async () => {
  const before = "<!-- skillset:todo ::: #adopt-orphan [adopt.ambiguous-reference] Review text. -->\nAsk @alice.\n";
  const root = await fixture(before);
  await expect(recordImportedBodyFindings(root, [path])).rejects.toThrow("no ledger record");
  expect(await readFile(join(root, path), "utf8")).toBe(before);
  expect(await Bun.file(join(root, MIGRATION_STATE_PATH)).exists()).toBe(false);
});
