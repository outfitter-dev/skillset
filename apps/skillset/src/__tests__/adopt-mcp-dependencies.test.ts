import * as sourceImport from "../import";
import * as findings from "@skillset/core/internal/adoption-findings";
import { persistAdoptionReceipt } from "../operation-receipt";
import { readReportBundle } from "@skillset/core/internal/report-store";
import { expect, test, spyOn } from "bun:test";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { createTestFixtureRoot } from "../../../../scripts/test-helpers/fixture-root";
import { adoptSkillset, renderAdoptReportMarkdown } from "../adopt";
import { readMigrationState } from "@skillset/core/internal/migration-state";
import { createOperationalPathContext, ISOLATED_OUT_ROOT, resolveOperationalPath } from "@skillset/core";

async function fixture(script = "server/dist/index.js") {
  const root = await createTestFixtureRoot("adopt-mcp-dependency-");
  await Bun.write(join(root, ".cursor-plugin/plugin.json"), JSON.stringify({ name: "demo", description: "MCP fixture.", version: "1.0.0" }));
  const declaration = JSON.stringify({ mcpServers: { browser: { command: "node", args: [script] } } });
  await Bun.write(join(root, ".mcp.json"), declaration);
  await Bun.write(join(root, script), "console.log('fixture');\n");
  return { root, declaration };
}

test("adoption records an original local MCP candidate omitted from the actual package", async () => {
  const { root, declaration } = await fixture();
  const report = await adoptSkillset(root, { write: true, targets: ["cursor"] });
  expect(report.ok).toBe(true);
  const flag = report.migrationFlags?.find((item) => item.code === "adopt.mcp-local-candidate-omitted");
  expect(flag).toBeDefined();
  expect(flag?.severity).toBe("error");
  expect(flag?.source.path).toBe(".skillset/plugins/demo/.mcp.json");
  expect(flag?.origin?.path).toBe(".mcp.json");
  expect(flag?.message).toContain("runtime base requires review");
  expect((await readMigrationState(root)).state.flags).toContainEqual(flag!);
  expect(await readFile(join(root, ".mcp.json"), "utf8")).toBe(declaration);
  expect(await readFile(join(root, ".skillset/plugins/demo/server/dist/index.js"), "utf8")).toBe("console.log('fixture');\n");
  const output = resolveOperationalPath(createOperationalPathContext(root), `${ISOLATED_OUT_ROOT}/plugins/demo/server/dist/index.js`);
  expect(await Bun.file(output).exists()).toBe(false);
  expect(renderAdoptReportMarkdown(report, { rootPath: root })).toContain("adopt.mcp-local-candidate-omitted");
});

test("an original candidate retained in the package is not called omitted", async () => {
  const { root } = await fixture("scripts/start.js");
  const report = await adoptSkillset(root, { write: true, targets: ["cursor"] });
  expect(report.ok).toBe(true);
  expect(report.migrationFlags?.filter((flag) => flag.code.startsWith("adopt.mcp-"))).toEqual([]);
  const output = resolveOperationalPath(createOperationalPathContext(root), `${ISOLATED_OUT_ROOT}/plugins/demo/scripts/start.js`);
  expect(await Bun.file(output).exists()).toBe(true);
});


test("independent adoptions retain the same location identities and receipt codes", async () => {
  const left = await fixture();
  const right = await fixture();
  const a = await adoptSkillset(left.root, { write: true, targets: ["cursor"] });
  const b = await adoptSkillset(right.root, { write: true, targets: ["cursor"] });
  expect(a.migrationFlags?.map(({ id, fingerprints }) => ({ id, fingerprints }))).toEqual(b.migrationFlags?.map(({ id, fingerprints }) => ({ id, fingerprints })));
  const receipt = await persistAdoptionReceipt(a);
  expect((await readReportBundle(receipt.id)).report.payload).toMatchObject({ migrationFlagCodes: ["adopt.mcp-local-candidate-omitted"] });
  expect(renderAdoptReportMarkdown(a, { rootPath: left.root })).toContain("completed; review required");
});

test("a missing original is a review warning, not an omitted-file claim", async () => {
  const { root } = await fixture();
  await rm(join(root, "server/dist/index.js"));
  const report = await adoptSkillset(root, { write: true, targets: ["cursor"] });
  expect(report.ok).toBe(true);
  expect(report.migrationFlags?.map((flag) => flag.code)).toEqual(["adopt.mcp-local-candidate-unverified"]);
});

test("an import blocked by license ambiguity creates no fabricated MCP finding", async () => {
  const { root } = await fixture();
  await Bun.write(join(root, "LICENSE"), "Original notice.");
  await Bun.write(join(root, ".cursor-plugin/plugin.json"), JSON.stringify({ name: "demo", description: "Fixture.", version: "1.0.0", license: "MIT" }));
  const report = await adoptSkillset(root, { write: true, targets: ["cursor"] });
  expect(report.ok).toBe(false);
  expect(report.imports.some((entry) => !entry.ok)).toBe(true);
  expect(report.migrationFlags?.filter((flag) => flag.code.startsWith("adopt.mcp-"))).toEqual([]);
});

test("post-render persistence failure retains truthful completed build evidence", async () => {
  const { root } = await fixture();
  const original = findings.recordImportedFindings;
  const recorder = spyOn(findings, "recordImportedFindings").mockImplementation(async (rootPath, sources, options) => {
    if ((sources.mcpDependencies?.length ?? 0) > 0) throw new Error("MCP ledger unavailable");
    return original(rootPath, sources, options);
  });
  try {
    const report = await adoptSkillset(root, { write: true, targets: ["cursor"] });
    expect(report.ok).toBe(false);
    expect(report.migrationError).toBe("MCP ledger unavailable");
    expect(report.migrationErrorPhase).toBe("after-build");
    expect(report.builtFiles).toBeGreaterThan(0);
    expect(report.buildError).toBeUndefined();
    expect(report.cutover).toEqual([]);
    const receipt = await persistAdoptionReceipt(report);
    const stored = (await readReportBundle(receipt.id)).report;
    expect(stored).toMatchObject({ result: { ok: false }, payload: { phases: { build: { status: "passed" }, lint: { status: "passed" } } } });
    expect(stored.payload).not.toHaveProperty("cutover");
    expect(renderAdoptReportMarkdown(report, { rootPath: root })).not.toContain("Not run because migration finding");
  } finally { recorder.mockRestore(); }
});


test("a landed plugin retains dependency evidence if a later import step fails", async () => {
  const { root } = await fixture();
  const original = sourceImport.importSources;
  const importer = spyOn(sourceImport, "importSources").mockImplementation(async (options) => {
    const batch = await original(options);
    throw new sourceImport.ImportBatchError("later import failure", batch.imports);
  });
  try {
    const report = await adoptSkillset(root, { write: true, targets: ["cursor"] });
    expect(report.ok).toBe(false);
    expect(report.imports.some((entry) => !entry.ok)).toBe(true);
    expect(report.migrationFlags?.map((flag) => flag.code)).toContain("adopt.mcp-local-candidate-omitted");
    expect(report.writtenPaths).toContain(".skillset/plugins/demo");
  } finally { importer.mockRestore(); }
});

test("unselected Cursor projection cannot claim an omitted Cursor dependency", async () => {
  const { root } = await fixture();
  const report = await adoptSkillset(root, { write: true, targets: ["claude"] });
  expect(report.migrationFlags?.filter((flag) => flag.code.startsWith("adopt.mcp-"))).toEqual([]);
});
