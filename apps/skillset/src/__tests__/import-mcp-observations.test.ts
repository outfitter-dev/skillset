import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { readReportBundle } from "@skillset/core/internal/report-store";
import { createTestFixtureRoot } from "../../../../scripts/test-helpers/fixture-root";
import { adoptSkillset, renderAdoptReportMarkdown } from "../adopt";
import { ImportBatchError, importSource } from "../import";
import { persistAdoptionReceipt, persistImportReceipt } from "../operation-receipt";

async function fixture(root: string): Promise<string> {
  await Bun.write(join(root, ".claude-plugin/plugin.json"), '{"name":"demo"}');
  const content = JSON.stringify({ mcpServers: {
    local: { command: "node", args: ["${CLAUDE_PLUGIN_ROOT}/scripts/server.js"], env: { CACHE: "${CLAUDE_PLUGIN_DATA}/private-cache-value" } },
    remote: { type: "http", url: "https://private-host.invalid/mcp", headers: { "X-Private": "fixture-private-credential" } },
  } });
  await Bun.write(join(root, ".mcp.json"), content);
  await Bun.write(join(root, "scripts/server.js"), "export {};\n");
  return content;
}

test("MCP import records exact changes and persists value-free evidence", async () => {
  const root = await createTestFixtureRoot("skillset-mcp-observation-");
  const sourcePath = join(root, "original");
  const original = await fixture(sourcePath);
  const report = await importSource({ rootPath: root, sourcePath, kind: "plugin", provider: "claude" });
  expect(report.normalizations).toEqual(expect.arrayContaining([
    expect.objectContaining({ code: "mcp.claude-root-token", source: { path: ".mcp.json", pointer: "/mcpServers/local/args/0" }, destination: { path: ".skillset/plugins/demo/.mcp.json", pointer: "/mcpServers/local/args/0" }, occurrences: 1 }),
    expect.objectContaining({ code: "mcp.claude-data-token", source: { path: ".mcp.json", pointer: "/mcpServers/local/env/CACHE" } }),
    expect.objectContaining({ code: "mcp.claude-http-transport", source: { path: ".mcp.json", pointer: "/mcpServers/remote/type" } }),
  ]));
  const receipt = await persistImportReceipt({ failed: false, imports: [report], kind: "plugin", provider: "claude", rootPath: root });
  const stored = await readReportBundle(receipt.id);
  expect(stored.report).toHaveProperty("payload.normalizations", report.normalizations);
  expect(stored.markdown).toContain("mcp.claude-root-token");
  const evidence = JSON.stringify(report.normalizations) + stored.markdown;
  for (const privateValue of ["private-cache-value", "private-host.invalid", "fixture-private-credential", sourcePath]) expect(evidence).not.toContain(privateValue);
  expect(report.normalizations?.every((entry) => entry.fidelity === "unknown" && entry.evidence.length > 0)).toBe(true);
  expect(await readFile(join(sourcePath, ".mcp.json"), "utf8")).toBe(original);
});

test("adoption carries MCP observations into its human report and immutable receipt", async () => {
  const root = await createTestFixtureRoot("skillset-adopt-mcp-observation-");
  const original = await fixture(root);
  await Bun.write(join(root, "skillset.yaml"), "compile:\n  targets: [claude]\n");
  const report = await adoptSkillset(root, { write: true });
  expect(report.ok).toBe(true);
  const normalizations = report.imports.flatMap((entry) => entry.normalizations ?? []);
  expect(normalizations.some((entry) => entry.code === "mcp.claude-http-transport")).toBe(true);
  expect(renderAdoptReportMarkdown(report, { rootPath: root })).toContain("mcp.claude-http-transport");
  const receipt = await persistAdoptionReceipt(report);
  expect((await readReportBundle(receipt.id)).report).toHaveProperty("payload.normalizations", normalizations);
  expect(await readFile(join(root, ".mcp.json"), "utf8")).toBe(original);
});

test("a post-claim baseline failure retains committed MCP observations", async () => {
  const root = await createTestFixtureRoot("skillset-mcp-partial-observation-");
  const sourcePath = join(root, "original");
  await fixture(sourcePath);
  let failure: unknown;
  try {
    await importSource({ rootPath: root, sourcePath, kind: "plugin", provider: "claude", testHooks: { beforeBaselineSeed: async () => { throw new Error("baseline failed"); } } });
  } catch (error) { failure = error; }
  expect(failure).toBeInstanceOf(ImportBatchError);
  const reports = (failure as ImportBatchError).imports;
  expect(reports).toHaveLength(1);
  expect(reports[0]?.normalizations?.some((entry) => entry.code === "mcp.claude-http-transport")).toBe(true);
  const receipt = await persistImportReceipt({ failed: true, imports: reports, kind: "plugin", provider: "claude", rootPath: root });
  const saved = (await readReportBundle(receipt.id)).report;
  expect(saved).toHaveProperty("payload.partial", true);
  expect(saved).toHaveProperty("payload.normalizations", reports[0]?.normalizations);
});

test("unchanged canonical MCP bytes produce no normalization claims", async () => {
  const { stringifyJson } = await import("@skillset/core/internal/yaml");
  const root = await createTestFixtureRoot("skillset-mcp-noop-");
  const sourcePath = join(root, "original");
  await Bun.write(join(sourcePath, ".claude-plugin/plugin.json"), '{"name":"demo"}');
  const source = stringifyJson({ mcpServers: { demo: { command: "node", args: ["server.js"] } } });
  await Bun.write(join(sourcePath, ".mcp.json"), source);
  const report = await importSource({ rootPath: root, sourcePath, kind: "plugin", provider: "claude" });
  expect(report.normalizations?.filter((entry) => entry.code.startsWith("mcp."))).toEqual([]);
  expect(await readFile(join(report.targetPath, ".mcp.json"), "utf8")).toBe(source);
});

test("source relocation and JSON serialization remain distinct from semantic changes", async () => {
  const root = await createTestFixtureRoot("skillset-mcp-relocation-");
  const sourcePath = join(root, "original");
  await Bun.write(join(sourcePath, ".cursor-plugin/plugin.json"), '{"name":"demo"}');
  await Bun.write(join(sourcePath, "mcp.json"), '{"mcpServers":{"demo":{"command":"node"}}}');
  const report = await importSource({ rootPath: root, sourcePath, kind: "plugin", provider: "cursor" });
  expect(report.normalizations?.filter((entry) => entry.code.startsWith("mcp.")).map((entry) => entry.code)).toEqual(["mcp.source-path", "mcp.json-serialization"]);
  expect(report.normalizations?.find((entry) => entry.code === "mcp.source-path")).toMatchObject({ source: { path: "mcp.json", pointer: "" }, destination: { path: ".skillset/plugins/demo/.mcp.json", pointer: "" } });
});

test("failed pre-claim MCP conversion produces no successful batch observation", async () => {
  const { importSources } = await import("../import");
  const root = await createTestFixtureRoot("skillset-mcp-batch-failure-");
  const sourcePath = join(root, "original");
  await fixture(join(sourcePath, "plugins/first"));
  await Bun.write(join(sourcePath, "plugins/second/.claude-plugin/plugin.json"), '{"name":"invalid"}');
  await Bun.write(join(sourcePath, "plugins/second/.mcp.json"), '{"mcpServers":{"demo":{"command":"node","args":["$CLAUDE_PLUGIN_ROOT"]}}}');
  let failure: unknown;
  try { await importSources({ rootPath: root, sourcePath, provider: "claude" }); } catch (error) { failure = error; }
  expect(failure).toBeInstanceOf(ImportBatchError);
  const reports = (failure as ImportBatchError).imports;
  expect(reports).toHaveLength(1);
  expect(reports[0]?.name).toBe("demo");
  expect(reports[0]?.normalizations?.every((entry) => entry.destination.path.startsWith(".skillset/plugins/demo/"))).toBe(true);
  expect(await Bun.file(join(root, ".skillset/plugins/invalid/.mcp.json")).exists()).toBe(false);
});

test("immutable receipts retain every observation beyond summary-list limits", async () => {
  const root = await createTestFixtureRoot("skillset-mcp-many-observations-");
  const sourcePath = join(root, "original");
  await Bun.write(join(sourcePath, ".claude-plugin/plugin.json"), '{"name":"demo"}');
  await Bun.write(join(sourcePath, ".mcp.json"), JSON.stringify({ mcpServers: Object.fromEntries(Array.from({ length: 205 }, (_, index) => [`server-${index}`, { type: "http", url: "https://example.invalid/mcp" }])) }));
  const report = await importSource({ rootPath: root, sourcePath, kind: "plugin", provider: "claude" });
  expect(report.normalizations?.filter((entry) => entry.code === "mcp.claude-http-transport")).toHaveLength(205);
  const receipt = await persistImportReceipt({ failed: false, imports: [report], kind: "plugin", provider: "claude", rootPath: root });
  expect((await readReportBundle(receipt.id)).report).toHaveProperty("payload.normalizations", report.normalizations);
});

test("canonical fallback observations identify the dialect without inventing provider ownership", async () => {
  const root = await createTestFixtureRoot("skillset-mcp-unknown-owner-");
  const sourcePath = join(root, "original");
  await Bun.write(join(sourcePath, "skillset.yaml"), "skillset:\n  name: demo\n");
  await Bun.write(join(sourcePath, ".mcp.json"), '{"mcpServers":{"demo":{"command":"node"}}}');
  const report = await importSource({ rootPath: root, sourcePath, kind: "plugin" });
  expect(report.normalizations).toEqual([expect.objectContaining({ code: "mcp.json-serialization", dialect: "agent-plugins", fidelity: "unknown" })]);
  expect(report.normalizations?.[0]).not.toHaveProperty("providerVersion");
});

test("a later source-read failure retains committed observations and seeded baseline writes", async () => {
  const { rm } = await import("node:fs/promises");
  const root = await createTestFixtureRoot("skillset-mcp-post-baseline-failure-");
  await Bun.write(join(root, "skillset.yaml"), "compile:\n  targets: [claude]\n");
  const sourcePath = join(root, "original");
  await fixture(sourcePath);
  await Bun.write(join(sourcePath, "skills/demo/SKILL.md"), "---\nname: demo\ndescription: Demo.\ncontext: fork\n---\nBody.\n");
  let failure: unknown;
  try {
    await importSource({ rootPath: root, sourcePath, kind: "plugin", provider: "claude", testHooks: {
      afterBaselineSeed: async () => { await rm(join(root, ".skillset/plugins/demo/skills/demo/SKILL.md")); },
    } });
  } catch (error) { failure = error; }
  expect(failure).toBeInstanceOf(ImportBatchError);
  const reports = (failure as ImportBatchError).imports;
  expect(reports).toHaveLength(1);
  expect(reports[0]?.normalizations?.some((entry) => entry.code === "mcp.claude-http-transport")).toBe(true);
  expect(reports[0]?.baselines.length).toBeGreaterThan(0);
  expect(reports[0]?.baselinePath).toBeDefined();
  expect(await Bun.file(reports[0]!.baselinePath!).exists()).toBe(true);
  const receipt = await persistImportReceipt({ failed: true, imports: reports, kind: "plugin", provider: "claude", rootPath: root });
  expect((await readReportBundle(receipt.id)).report).toHaveProperty("payload.normalizations", reports[0]?.normalizations);
});
