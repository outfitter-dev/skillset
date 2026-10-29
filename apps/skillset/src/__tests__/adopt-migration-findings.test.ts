import { expect, spyOn, test } from "bun:test";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { createOperationalPathContext, ISOLATED_OUT_ROOT, resolveOperationalPath } from "@skillset/core";
import { inspectMigrationMarkers } from "@skillset/core/internal/migration-markers";
import { readMigrationState, MIGRATION_STATE_PATH, hashMigrationState } from "@skillset/core/internal/migration-state";
import { createTestFixtureRoot } from "../../../../scripts/test-helpers/fixture-root";
import { adoptSkillset, renderAdoptReportMarkdown } from "../adopt";
import { createInitialMigrationFlag } from "@skillset/core/internal/migration-state-reconcile";
import { readReportBundle } from "@skillset/core/internal/report-store";
import { MIGRATION_STATE_SCHEMA_VERSION } from "@skillset/schema";
import { persistAdoptionReceipt } from "../operation-receipt";

import * as sourceImport from "../import";

const sourcePath = ".skillset/skills/demo/SKILL.md";

test.each([
  ["Ask @alice about CLAUDE.md and .claude/plugins/marketplaces/demo.\n", "inline"],
  ["```css\n@media screen {}\n```\n", "sidecar"],
  ["| Reference |\n| --- |\n| CLAUDE.md |\n", "sidecar"],
] as const)("adoption records durable review evidence while preserving %s", async (body, placement) => {
  const root = await createTestFixtureRoot("skillset-adopt-migration-findings-");
  const originalPath = join(root, ".claude/skills/demo/SKILL.md");
  const original = `---\nname: demo\ndescription: Migration findings.\n---\n\n${body}`;
  await Bun.write(originalPath, original);

  const report = await adoptSkillset(root, { write: true });
  const { state } = await readMigrationState(root);
  expect(state.flags.length).toBeGreaterThan(0);
  expect(state.flags.every((flag) => flag.state === "open" && flag.disposition === "ambiguous")).toBe(true);
  expect(state.flags.some((flag) => flag.placement.kind === placement)).toBe(true);
  expect(state.flags.every((flag) => flag.source.path === sourcePath && flag.evidence.length > 0)).toBe(true);
  expect(state.flags.every((flag) => flag.origin?.path === ".claude/skills/demo/SKILL.md")).toBe(true);
  expect(report.ok).toBe(true);
  expect(hashMigrationState({ ...state, flags: report.migrationFlags ?? [] })).toBe(hashMigrationState(state));
  expect(report.writtenPaths).toContain(MIGRATION_STATE_PATH);

  const imported = await readFile(join(root, sourcePath), "utf8");
  const inspected = inspectMigrationMarkers({ content: imported, path: sourcePath, state });
  expect(inspected.diagnostics).toEqual([]);
  expect(inspected.content).toContain(body);
  const output = resolveOperationalPath(createOperationalPathContext(root), `${ISOLATED_OUT_ROOT}/.agents/skills/demo/SKILL.md`);
  expect(await readFile(output, "utf8")).toContain(body);
  expect(await readFile(output, "utf8")).not.toContain("<!-- skillset:todo");
  expect(await readFile(originalPath, "utf8")).toBe(original);
});

test("adoption with no recognized review finding does not create a migration ledger", async () => {
  const root = await createTestFixtureRoot("skillset-adopt-no-findings-");
  await Bun.write(join(root, ".claude/skills/demo/SKILL.md"), "---\nname: demo\ndescription: Plain.\n---\n\nWrite a concise summary.\n");
  const report = await adoptSkillset(root, { write: true });
  expect(report.ok).toBe(true);
  expect(await Bun.file(join(root, MIGRATION_STATE_PATH)).exists()).toBe(false);
  expect(report.writtenPaths).not.toContain(MIGRATION_STATE_PATH);
});

test("nested companion SKILL.md files remain resources rather than receiving adaptive locators", async () => {
  const root = await createTestFixtureRoot("skillset-adopt-companion-findings-");
  await Bun.write(join(root, ".claude/skills/demo/SKILL.md"), "---\nname: demo\ndescription: Plain.\n---\n\nWrite a concise summary.\n");
  const companion = "Example: $ARGUMENTS and @alice in CLAUDE.md.\n";
  await Bun.write(join(root, ".claude/skills/demo/references/SKILL.md"), companion);
  const report = await adoptSkillset(root, { write: true });
  expect(report.ok).toBe(true);
  const imported = await readFile(join(root, ".skillset/skills/demo/references/SKILL.md"), "utf8");
  expect(imported).toContain(companion);
  expect(imported).not.toContain("<!-- skillset:todo");
  expect((await readMigrationState(root)).state.flags).toEqual([]);
});

test("an existing decision prevents guessed replacement and records skipped build truth", async () => {
  const root = await createTestFixtureRoot("skillset-adopt-existing-finding-");
  await Bun.write(join(root, ".claude/skills/demo/SKILL.md"), "---\nname: demo\ndescription: Review.\n---\n\nAsk @alice.\n");
  const prior = createInitialMigrationFlag({
    code: "adopt.ambiguous-reference", severity: "warning", disposition: "ambiguous", message: "Prior decision.",
    source: { path: sourcePath }, fingerprints: { content: `sha256:${"a".repeat(64)}`, context: `sha256:${"b".repeat(64)}` },
    placement: { kind: "sidecar", reason: "Prior import." }, evidence: [{ summary: "Prior evidence." }], relatedReportIds: [],
  });
  const stateBytes = JSON.stringify({ schemaVersion: MIGRATION_STATE_SCHEMA_VERSION, flags: [prior] });
  await Bun.write(join(root, MIGRATION_STATE_PATH), stateBytes);
  const report = await adoptSkillset(root, { write: true });
  expect(report.ok).toBe(false);
  expect(report.migrationError).toContain("already has migration records");
  const markdown = renderAdoptReportMarkdown(report, { rootPath: root });
  expect(markdown).toContain("build (isolated): not run");
  expect(markdown).toContain("lint: not run");
  expect(markdown).toContain(report.migrationError!);
  expect(markdown).not.toContain("Wrote 0 generated files");
  expect(markdown).not.toContain("No lint issues.");
  expect(markdown).not.toContain("Run `skillset build --yes`");
  expect(markdown).not.toContain("No original paths need to move");
  expect(report.builtFiles).toBe(0);
  expect(report.writtenPaths).not.toContain(MIGRATION_STATE_PATH);
  expect(await readFile(join(root, MIGRATION_STATE_PATH), "utf8")).toBe(stateBytes);
  const receipt = await persistAdoptionReceipt(report);
  const stored = await readReportBundle(receipt.id);
  expect(stored.report).toMatchObject({
    payload: {
      diagnosticCodes: expect.arrayContaining(["adopt.migration-findings-failed"]),
      phases: { build: { status: "not-run" }, lint: { status: "not-run" } },
    },
    result: { ok: false },
  });
  expect(stored.report.payload).not.toHaveProperty("cutover");
});

test("a later batch collision does not omit review findings for successfully imported units", async () => {
  const root = await createTestFixtureRoot("skillset-adopt-partial-findings-");
  const original = "---\nname: a\ndescription: Imported first.\n---\n\nAsk @alice.\n";
  await Bun.write(join(root, ".claude/skills/a/SKILL.md"), original);
  await Bun.write(join(root, ".claude/skills/b/SKILL.md"), "---\nname: b\ndescription: Collision.\n---\n\nNew b.\n");
  const existing = "---\nname: b\ndescription: Existing.\n---\n\nKeep b.\n";
  await Bun.write(join(root, ".skillset/skills/b/SKILL.md"), existing);
  const report = await adoptSkillset(root, { write: true });
  expect(report.ok).toBe(false);
  expect(report.imports.some((entry) => !entry.ok)).toBe(true);
  const { state } = await readMigrationState(root);
  expect(state.flags).toHaveLength(1);
  expect(state.flags[0]?.source.path).toBe(".skillset/skills/a/SKILL.md");
  expect(report.writtenPaths).toContain(MIGRATION_STATE_PATH);
  expect(report.writtenPaths).toContain(".skillset/skills/a");
  expect(await readFile(join(root, ".claude/skills/a/SKILL.md"), "utf8")).toBe(original);
  expect(await readFile(join(root, ".skillset/skills/b/SKILL.md"), "utf8")).toBe(existing);
});


test("a removed landed source returns a failed receipt with the partial write inventory", async () => {
  const root = await createTestFixtureRoot("skillset-adopt-removed-finding-");
  const original = "---\nname: demo\ndescription: Review.\n---\n\nAsk @alice.\n";
  await Bun.write(join(root, ".claude/skills/demo/SKILL.md"), original);
  const importSources = sourceImport.importSources;
  let removed = false;
  const imported = spyOn(sourceImport, "importSources").mockImplementation(async (...args) => {
    const report = await importSources(...args);
    await rm(join(root, sourcePath));
    removed = true;
    return report;
  });
  try {
    const report = await adoptSkillset(root, { write: true });
    expect(removed).toBe(true);
    expect(report.ok).toBe(false);
    expect(report.migrationError).toContain("ENOENT");
    expect(report.imports.some((entry) => !entry.ok)).toBe(true);
    expect(report.writtenPaths).toContain(".skillset/skills/demo");
    expect(report.builtFiles).toBe(0);
    expect(report.writtenPaths).not.toContain(MIGRATION_STATE_PATH);
    const receipt = await persistAdoptionReceipt(report);
    const stored = await readReportBundle(receipt.id);
    expect(stored.report).toMatchObject({
      payload: {
        diagnosticCodes: expect.arrayContaining(["adopt.migration-findings-failed"]),
        phases: { build: { status: "not-run" }, lint: { status: "not-run" } },
      },
      result: { ok: false },
    });
    expect(stored.report.payload).not.toHaveProperty("cutover");
    expect(await readFile(join(root, ".claude/skills/demo/SKILL.md"), "utf8")).toBe(original);
  } finally {
    imported.mockRestore();
  }
});
