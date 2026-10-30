import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createTestFixtureRoot } from "../../../../scripts/test-helpers/fixture-root";
import { importedFrontmatterFindings } from "../adoption-frontmatter-findings";
import { recordImportedFindings } from "../adoption-findings";
import { MIGRATION_STATE_PATH, readMigrationState } from "../migration-state";

const path = ".skillset/skills/demo/SKILL.md";
const content = "---\nname: demo\nclaude:\n  frontmatter:\n    context: fork\n    extra: { nested: [false, null] }\ncursor:\n  frontmatter:\n    extra: { nested: [false, null] }\n---\nAsk @alice.\n";
const source = { path, providers: ["claude" as const], fields: ["context", "extra"], origin: { path: ".claude/skills/demo/SKILL.md" } };

test("frontmatter observations preserve attribution while leaving unsupported semantic judgments unknown", () => {
  const flags = importedFrontmatterFindings(source, content);
  expect(flags).toEqual(importedFrontmatterFindings({ ...source, fields: ["extra", "context", "extra"] }, content));
  expect(new Set(flags.map((flag) => flag.id)).size).toBe(2);
  expect(flags.every((flag) => flag.disposition === "ambiguous" && flag.placement.kind === "sidecar")).toBe(true);
  expect(flags.every((flag) => flag.evidence.some((item) => item.summary.includes("Capability fidelity: unknown")))).toBe(true);
  expect(flags[0]?.evidence.some((item) => item.reference === "https://code.claude.com/docs/en/skills")).toBe(true);
});

test("merged provider origins share one document transaction without losing per-field provenance", async () => {
  const root = await createTestFixtureRoot("skillset-frontmatter-merged-findings-");
  await Bun.write(join(root, path), content);
  const other = { path, providers: ["cursor" as const], fields: ["extra"], origin: { path: ".cursor/skills/demo/SKILL.md" } };
  const result = await recordImportedFindings(root, { bodyPaths: [path], frontmatter: [source, other] });
  expect(result.flags).toHaveLength(4);
  expect(new Set(result.flags.map((flag) => flag.id)).size).toBe(4);
  expect(result.flags.filter((flag) => flag.origin?.path === other.origin.path)).toHaveLength(1);
  expect((await readMigrationState(root)).state.flags).toHaveLength(4);
});

test("a concurrent field edit aborts the body locator and field ledger transaction", async () => {
  const root = await createTestFixtureRoot("skillset-frontmatter-race-findings-");
  await Bun.write(join(root, path), content);
  const changed = content.replace("context: fork", "context: updated");
  await expect(recordImportedFindings(root, { bodyPaths: [path], frontmatter: [source] }, {
    testHooks: { beforeInitialInspection: async () => { await Bun.write(join(root, path), changed); } },
  })).rejects.toThrow();
  expect(await readFile(join(root, path), "utf8")).toBe(changed);
  expect(await Bun.file(join(root, MIGRATION_STATE_PATH)).exists()).toBe(false);
});

test("unknown provenance produces no invented provider attribution", () => {
  const flags = importedFrontmatterFindings({ path, providers: [], fields: ["extra"] }, "---\nextra: { value: false }\n---\nBody.\n");
  expect(flags[0]).toMatchObject({ code: "adopt.unattributed-frontmatter", disposition: "ambiguous", placement: { kind: "sidecar" } });
  expect(flags[0]?.evidence.some((item) => item.summary.includes("No source provider was declared"))).toBe(true);
  expect(flags[0]?.evidence.some((item) => item.reference?.startsWith("https://code.claude.com"))).toBe(false);
});
