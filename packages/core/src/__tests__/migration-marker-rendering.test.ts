import { expect, test } from "bun:test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { MIGRATION_STATE_SCHEMA_VERSION, formatMigrationMarker, type MigrationFlag } from "@skillset/schema";
import { createTestFixtureRoot } from "../../../../scripts/test-helpers/fixture-root";
import { collectSourceInventory } from "../../../../apps/skillset/src/change-status";
import { loadBuildGraph } from "../resolver";
import { renderBuildGraph } from "../render";
import { buildSkillset } from "../build";
import { suggestSource } from "../authoring";
import { planSourceRename } from "../source-rename";

async function put(root: string, path: string, content: string): Promise<void> {
  await mkdir(dirname(join(root, path)), { recursive: true });
  await writeFile(join(root, path), content);
}

const documents = [
  { path: ".skillset/skills/demo/SKILL.md", prefix: "---\nname: demo\ndescription: A useful test skill.\n---\n\n", body: "# Demo\n\nKeep @alice literal.\n" },
  { path: ".skillset/plugins/toolbox/skills/helper/SKILL.md", prefix: "---\nname: helper\ndescription: A plugin skill.\n---\n\n", body: "# Helper\n\nPreserve the plugin body.\n" },
  { path: ".skillset/rules/src/testing.md", prefix: "", body: "# Tests\n\nKeep examples unchanged.\n" },
  { path: ".skillset/subagents/reviewer.md", prefix: "---\nname: reviewer\ndescription: Review the work.\n---\n\n", body: "# Reviewer\n\nInspect the work.\n" },
];
function flagFor(document: (typeof documents)[number], index: number): MigrationFlag {
  const line = document.prefix.split("\n").length;
  return {
    id: `adopt-test${index}`, code: "ambiguous-reference", severity: "warning", disposition: "ambiguous", state: "open",
    message: "Review {{missing}} and @alice before accepting.", source: { path: document.path, line: line + 1 },
    placement: { kind: "inline", label: "todo", line },
    fingerprints: { content: `sha256:${"a".repeat(64)}`, context: `sha256:${"b".repeat(64)}` },
    evidence: [{ summary: "Review the source." }], relatedReportIds: [], history: [],
  };
}

test("owned rule, skill and agent anchors do not affect any provider bytes, locks or release source hashes", async () => {
  const root = await createTestFixtureRoot("migration-marker-rendering-");
  await put(root, "skillset.yaml", "skillset:\n  name: marker-test\ncompile:\n  targets: [claude, codex, cursor]\n");
  await put(root, ".skillset/plugins/toolbox/skillset.yaml", "skillset:\n  name: toolbox\n");
  for (const document of documents) await put(root, document.path, document.prefix + document.body);
  const beforeGraph = await loadBuildGraph(root);
  const before = await renderBuildGraph(beforeGraph);
  const beforeInventory = await collectSourceInventory(root);
  const flags = documents.map(flagFor);
  await put(root, ".skillset/adopt/state.json", JSON.stringify({ schemaVersion: MIGRATION_STATE_SCHEMA_VERSION, flags }));
  for (const [index, document] of documents.entries()) {
    await put(root, document.path, document.prefix + formatMigrationMarker({ ...flags[index]!, label: "todo" }) + "\n" + document.body);
  }
  const graph = await loadBuildGraph(root);
  expect(graph.standaloneSkills[0]!.body).toBe(beforeGraph.standaloneSkills[0]!.body);
  expect(graph.standaloneSkills[0]!.bodySourceLines?.[1]).toBe(7);
  expect(await renderBuildGraph(graph)).toEqual(before);
  expect(await collectSourceInventory(root)).toEqual(beforeInventory);
});

test("inline ledger records outside adaptive source and absent anchors fail before rendering", async () => {
  const root = await createTestFixtureRoot("migration-marker-unsafe-");
  const document = documents[0]!;
  await put(root, "skillset.yaml", "skillset:\n  name: marker-test\n");
  await put(root, document.path, document.prefix + document.body);
  const flag = flagFor(document, 0);
  for (const source of [{ path: document.path }, { path: ".skillset/shared/partial.md" }, { path: "AGENTS.md" }]) {
    await put(root, ".skillset/adopt/state.json", JSON.stringify({ schemaVersion: MIGRATION_STATE_SCHEMA_VERSION, flags: [{ ...flag, source }] }));
    await expect(loadBuildGraph(root)).rejects.toThrow(/migration.*anchor/i);
  }
});


test("reverse reconciliation refuses to erase source anchors and rename preview preserves their ledger", async () => {
  const root = await createTestFixtureRoot("migration-marker-mutations-");
  const document = documents[0]!;
  const flag = flagFor(document, 0);
  const source = document.prefix + formatMigrationMarker({ ...flag, label: "todo" }) + "\n" + document.body;
  const state = JSON.stringify({ schemaVersion: MIGRATION_STATE_SCHEMA_VERSION, flags: [flag] });
  await put(root, "skillset.yaml", "skillset:\n  name: marker-test\ncompile:\n  targets: [claude]\n");
  await put(root, document.path, source);
  await put(root, ".skillset/adopt/state.json", state);
  await buildSkillset(root);
  const generated = ".claude/skills/demo/SKILL.md";
  const output = await readFile(join(root, generated), "utf8");
  await put(root, generated, output.replace("Keep @alice literal.", "Changed from generated output."));
  for (const write of [false, true]) {
    const result = await suggestSource(root, generated, { write });
    expect(result.status).toBe("refused");
    expect(result.message).toContain("migration anchors");
    expect(await readFile(join(root, document.path), "utf8")).toBe(source);
    expect(await readFile(join(root, ".skillset/adopt/state.json"), "utf8")).toBe(state);
  }
  await expect(planSourceRename({ rootPath: root, from: ".skillset/skills/demo", to: ".skillset/skills/renamed" })).rejects.toThrow(/migration.*anchor/i);
  expect(await readFile(join(root, document.path), "utf8")).toBe(source);
  expect(await readFile(join(root, ".skillset/adopt/state.json"), "utf8")).toBe(state);
});
