import { expect, test } from "bun:test";
import { join } from "node:path";
import { createTestFixtureRoot } from "../../../../scripts/test-helpers/fixture-root";
import { importedMetadataFindings } from "../adoption-metadata-findings";
import { recordImportedFindings } from "../adoption-findings";
import { readMigrationState } from "../migration-state";
import { reconcileMigrationState } from "../migration-state-reconcile";

const source = { path: ".skillset/skills/demo/SKILL.md", origin: { path: "skills/demo/SKILL.md", repo: "https://example.com/repo", ref: "pinned" } };

for (const metadata of [undefined, {}, { author: "fixture" }, { version: "1", "skillset.schema": "1" }]) {
  test(`string-only or absent metadata has no compatibility finding: ${JSON.stringify(metadata)}`, () => {
    expect(importedMetadataFindings(source, metadata === undefined ? {} : { metadata })).toEqual([]);
  });
}

test("metadata findings are stable across object order, value-free and do not assign provider ownership", () => {
  const left = importedMetadataFindings(source, { metadata: { z: { b: false, a: [null] }, a: 1 } });
  const right = importedMetadataFindings(source, { metadata: { a: 1, z: { a: [null], b: false } } });
  expect(left).toEqual(right);
  expect(new Set(left.map((flag) => flag.id)).size).toBe(2);
  expect(left.every((flag) => flag.origin?.path === source.origin.path && flag.state === "open")).toBe(true);
  expect(left.every((flag) => flag.evidence.some((entry) => entry.reference?.includes("69ef37e9424c0a7ea9dd2293b559e43ec8176379")))).toBe(true);
  expect(left.every((flag) => flag.evidence.some((entry) => entry.summary.includes("No provider ownership")))).toBe(true);
  expect(left[0]?.fingerprints.content).toMatch(/^sha256:[a-f0-9]{64}$/u);
});

test("metadata and unattributed field findings share the initial body transaction", async () => {
  const root = await createTestFixtureRoot("skillset-metadata-finding-owner-");
  await Bun.write(join(root, source.path), "---\nextra: native\nmetadata:\n  structured: { nested: true }\n---\nAsk @alice.\n");
  const result = await recordImportedFindings(root, { frontmatter: [{ ...source, providers: [], fields: ["extra"], metadataCompatibility: true }], bodyPaths: [source.path] });
  expect(result.flags.map((flag) => flag.code).sort()).toEqual(["adopt.ambiguous-invoke-subagent", "adopt.metadata-standard-incompatible", "adopt.unattributed-frontmatter"].sort());
  expect((await readMigrationState(root)).state.flags).toHaveLength(3);
});

test("a missing metadata observation does not silently resolve a durable review decision", () => {
  const flags = importedMetadataFindings(source, { metadata: { structured: false } });
  const state = { schemaVersion: "skillset.migration-state@1" as const, flags };
  const result = reconcileMigrationState(state, importedMetadataFindings(source, { metadata: { structured: "fixed" } }));
  expect(result.state.flags[0]?.state).toBe("open");
  expect(result.state.flags[0]?.id).toBe(flags[0]?.id);
  const again = importedMetadataFindings(source, { metadata: { structured: false } });
  expect(again).toEqual(flags);
});


test("a concurrent metadata edit aborts sidecar persistence without rewriting the source", async () => {
  const root = await createTestFixtureRoot("skillset-metadata-finding-race-");
  const original = "---\nmetadata: { structured: false }\n---\nBody.\n";
  const changed = original.replace("false", "true");
  await Bun.write(join(root, source.path), original);
  await expect(recordImportedFindings(root, { frontmatter: [{ ...source, providers: [], fields: [], metadataCompatibility: true }] }, {
    testHooks: { beforeInitialInspection: async () => { await Bun.write(join(root, source.path), changed); } },
  })).rejects.toThrow();
  expect(await Bun.file(join(root, source.path)).text()).toBe(changed);
  expect((await readMigrationState(root)).state.flags).toHaveLength(0);
});
