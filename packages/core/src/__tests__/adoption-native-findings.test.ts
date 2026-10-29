import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createTestFixtureRoot } from "../../../../scripts/test-helpers/fixture-root";
import { recordImportedFindings } from "../adoption-findings";
import { nativeHookFindings } from "../adoption-native-findings";
import { MIGRATION_STATE_PATH, readMigrationState } from "../migration-state";

const hookPath = ".skillset/plugins/demo/hooks/hooks.json";
const bodyPath = ".skillset/plugins/demo/skills/demo/SKILL.md";
const body = "---\nname: demo\ndescription: Demo.\n---\n\nAsk @alice.\n";
const hooks = JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: "command", command: "echo native" }] }] } });
const sources = { bodyPaths: [bodyPath], nativeHooks: [{ path: hookPath, targets: ["claude" as const, "codex" as const] }] };

async function fixture() {
  const root = await createTestFixtureRoot("skillset-native-findings-");
  await Bun.write(join(root, bodyPath), body);
  await Bun.write(join(root, hookPath), hooks);
  return root;
}

test("hook targets retain distinct stable sidecar identities and unknown semantics", () => {
  const forward = nativeHookFindings(sources.nativeHooks[0]!, hooks);
  const reverse = nativeHookFindings({ path: hookPath, targets: ["codex", "claude", "codex"] }, hooks);
  expect(forward).toEqual(reverse);
  expect(new Set(forward.map((flag) => flag.id)).size).toBe(2);
  expect(forward.every((flag) => flag.state === "open" && flag.placement.kind === "sidecar" && flag.disposition === "ambiguous")).toBe(true);
});

test("a concurrent native hook edit aborts both body locators and the combined ledger", async () => {
  const root = await fixture();
  const changed = `${hooks}\n`;
  await expect(recordImportedFindings(root, sources, {
    testHooks: { beforeInitialInspection: async () => { await Bun.write(join(root, hookPath), changed); } },
  })).rejects.toThrow();
  expect(await readFile(join(root, hookPath), "utf8")).toBe(changed);
  expect(await readFile(join(root, bodyPath), "utf8")).toBe(body);
  expect(await Bun.file(join(root, MIGRATION_STATE_PATH)).exists()).toBe(false);
});

test("late failure rolls back Markdown and hook sidecars together", async () => {
  const root = await fixture();
  await expect(recordImportedFindings(root, sources, {
    testHooks: { beforeApply: async (_operation, index) => { if (index === 1) throw new Error("late combined failure"); } },
  })).rejects.toThrow("late combined failure");
  expect(await readFile(join(root, hookPath), "utf8")).toBe(hooks);
  expect(await readFile(join(root, bodyPath), "utf8")).toBe(body);
  expect(await Bun.file(join(root, MIGRATION_STATE_PATH)).exists()).toBe(false);
});

test("an existing hook decision cannot be replaced by a partial new-source scan", async () => {
  const root = await fixture();
  await recordImportedFindings(root, { nativeHooks: sources.nativeHooks });
  const before = await readFile(join(root, MIGRATION_STATE_PATH), "utf8");
  await expect(recordImportedFindings(root, sources)).rejects.toThrow("already has migration records");
  expect(await readFile(join(root, MIGRATION_STATE_PATH), "utf8")).toBe(before);
  expect(await readFile(join(root, bodyPath), "utf8")).toBe(body);
  expect((await readMigrationState(root)).state.flags).toHaveLength(2);
});

test("malformed native JSON remains a durable unknown finding", () => {
  const flags = nativeHookFindings(sources.nativeHooks[0]!, "{ broken JSON");
  expect(flags).toHaveLength(2);
  expect(flags.every((flag) => flag.disposition === "ambiguous")).toBe(true);
  expect(flags[0]?.message).toContain("could not be parsed");
  expect(nativeHookFindings(sources.nativeHooks[0]!, '{"hooks":{}}')).toEqual([]);
});

test("a hook edit after locator installation rolls back only transaction-owned writes", async () => {
  const root = await fixture();
  const changed = `${hooks}\nConcurrent edit`;
  await expect(recordImportedFindings(root, sources, {
    testHooks: { beforeApply: async (_operation, index) => { if (index === 1) await Bun.write(join(root, hookPath), changed); } },
  })).rejects.toThrow();
  expect(await readFile(join(root, hookPath), "utf8")).toBe(changed);
  expect(await readFile(join(root, bodyPath), "utf8")).toBe(body);
  expect(await Bun.file(join(root, MIGRATION_STATE_PATH)).exists()).toBe(false);
});
