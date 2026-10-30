import { expect, test } from "bun:test";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { readReportBundle } from "@skillset/core/internal/report-store";
import { createTestFixtureRoot } from "../../../../scripts/test-helpers/fixture-root";
import { adoptSkillset, renderAdoptReportMarkdown } from "../adopt";
import { ImportBatchError, importSource } from "../import";
import { persistAdoptionReceipt } from "../operation-receipt";

test("adoption retains value-free manifest identity observations in its receipt", async () => {
  const root = await createTestFixtureRoot("skillset-manifest-observation-");
  const original = '{"name":"demo","description":"Private manifest description."}';
  await Bun.write(join(root, ".claude-plugin/plugin.json"), original);
  await Bun.write(join(root, "skillset.yaml"), "compile:\n  targets: [claude]\n");
  const report = await adoptSkillset(root, { write: true });
  expect(report.ok).toBe(true);
  const entries = report.imports.flatMap((item) => item.normalizations ?? []);
  expect(entries).toEqual([
    expect.objectContaining({ code: "manifest.name", dialect: "claude", source: { path: ".claude-plugin/plugin.json", pointer: "/name" }, destination: { path: ".skillset/plugins/demo/skillset.yaml", pointer: "/skillset/name" } }),
    expect.objectContaining({ code: "manifest.description", source: { path: ".claude-plugin/plugin.json", pointer: "/description" }, destination: { path: ".skillset/plugins/demo/skillset.yaml", pointer: "/skillset/description" } }),
  ]);
  expect(renderAdoptReportMarkdown(report, { rootPath: root })).toContain("manifest.description");
  const receipt = await persistAdoptionReceipt(report);
  expect((await readReportBundle(receipt.id)).report).toHaveProperty("payload.normalizations", entries);
  expect(JSON.stringify(entries)).not.toContain("Private manifest description.");
  expect(JSON.stringify(entries)).not.toContain(root);
  expect(await readFile(join(root, ".claude-plugin/plugin.json"), "utf8")).toBe(original);
  const { loadBuildGraph } = await import("@skillset/core/internal/resolver");
  const { renderBuildGraph } = await import("@skillset/core/internal/render");
  const rendered = await renderBuildGraph(await loadBuildGraph(root));
  const manifest = rendered.find((file) => file.path === "plugins/demo/.claude-plugin/plugin.json");
  expect(manifest).toBeDefined();
  expect(JSON.parse(new TextDecoder().decode(manifest!.content))).toMatchObject(JSON.parse(original));
});

test("explicit identity remapping is distinguished from exact manifest copying", async () => {
  const root = await createTestFixtureRoot("skillset-manifest-remap-");
  const sourcePath = join(root, "original");
  await Bun.write(join(sourcePath, ".claude-plugin/plugin.json"), '{"name":"native-name","description":"Description."}');
  const report = await importSource({ rootPath: root, sourcePath, kind: "plugin", name: "chosen", provider: "claude" });
  expect(report.normalizations).toEqual(expect.arrayContaining([expect.objectContaining({ code: "manifest.name-remap", destination: { path: ".skillset/plugins/chosen/skillset.yaml", pointer: "/skillset/name" }, fidelity: "unknown" })]));
});

test("canonical config authority suppresses synthesized manifest observations", async () => {
  const root = await createTestFixtureRoot("skillset-manifest-canonical-");
  const sourcePath = join(root, "original");
  await Bun.write(join(sourcePath, ".claude-plugin/plugin.json"), '{"name":"native","description":"Native."}');
  await Bun.write(join(sourcePath, "skillset.yaml"), "skillset:\n  name: canonical\n  description: Canonical.\n");
  const report = await importSource({ rootPath: root, sourcePath, kind: "plugin", provider: "claude" });
  expect(report.normalizations).toEqual([]);
});

for (const field of ["shortDescription", "longDescription"] as const) {
  test(`Codex description evidence identifies the selected ${field} input`, async () => {
    const root = await createTestFixtureRoot("skillset-manifest-codex-");
    const sourcePath = join(root, "original");
    await Bun.write(join(sourcePath, ".codex-plugin/plugin.json"), JSON.stringify({ name: "demo", interface: { [field]: "  Description.  " } }));
    const report = await importSource({ rootPath: root, sourcePath, kind: "plugin", provider: "codex" });
    expect(report.normalizations).toEqual(expect.arrayContaining([expect.objectContaining({ code: "manifest.description", dialect: "codex", source: { path: ".codex-plugin/plugin.json", pointer: `/interface/${field}` } })]));
    expect(await readFile(join(report.targetPath, "skillset.yaml"), "utf8")).toContain("description: Description.");
  });
}

test("native description precedence does not claim unused interface inputs", async () => {
  const root = await createTestFixtureRoot("skillset-manifest-description-order-");
  const sourcePath = join(root, "original");
  await Bun.write(join(sourcePath, ".codex-plugin/plugin.json"), JSON.stringify({ name: "demo", description: "Main.", interface: { shortDescription: "Short.", longDescription: "Long." } }));
  const report = await importSource({ rootPath: root, sourcePath, kind: "plugin", provider: "codex" });
  expect(report.normalizations?.filter((entry) => entry.code === "manifest.description").map((entry) => entry.source.pointer)).toEqual(["/description"]);
});

test("missing manifest fields do not acquire fabricated source pointers", async () => {
  const root = await createTestFixtureRoot("skillset-manifest-absent-");
  const sourcePath = join(root, "demo");
  await Bun.write(join(sourcePath, ".claude-plugin/plugin.json"), '{}');
  const report = await importSource({ rootPath: root, sourcePath, kind: "plugin", provider: "claude" });
  expect(report.normalizations).toEqual([]);
});

test("all agreeing native sources are attributed in deterministic provider order", async () => {
  const root = await createTestFixtureRoot("skillset-manifest-multiple-");
  const sourcePath = join(root, "original");
  for (const provider of ["cursor", "claude"]) await Bun.write(join(sourcePath, `.${provider}-plugin/plugin.json`), '{"name":"demo","description":"Description."}');
  await mkdir(join(root, "first"));
  await mkdir(join(root, "second"));
  const first = await importSource({ rootPath: join(root, "first"), sourcePath, kind: "plugin" });
  const second = await importSource({ rootPath: join(root, "second"), sourcePath, kind: "plugin" });
  expect(first.normalizations).toEqual(second.normalizations);
  expect(first.normalizations?.map((entry) => [entry.dialect, entry.code])).toEqual([["claude", "manifest.name"], ["claude", "manifest.description"], ["cursor", "manifest.name"], ["cursor", "manifest.description"]]);
});

test("Agent Plugins manifest observations survive removal of the copied native manifest", async () => {
  const { AGENT_PLUGIN_MANIFEST_SCHEMA } = await import("@skillset/core/internal/agent-plugin-manifest");
  const root = await createTestFixtureRoot("skillset-manifest-standard-");
  const sourcePath = join(root, "original");
  const original = JSON.stringify({ $schema: AGENT_PLUGIN_MANIFEST_SCHEMA, name: "demo", description: "Description." });
  await Bun.write(join(sourcePath, "plugin.json"), original);
  const report = await importSource({ rootPath: root, sourcePath, kind: "plugin" });
  expect(report.normalizations?.map((entry) => [entry.code, entry.dialect, entry.source])).toEqual([
    ["manifest.name", "agent-plugins", { path: "plugin.json", pointer: "/name" }],
    ["manifest.description", "agent-plugins", { path: "plugin.json", pointer: "/description" }],
  ]);
  expect(await Bun.file(join(report.targetPath, "plugin.json")).exists()).toBe(false);
  expect(await readFile(join(sourcePath, "plugin.json"), "utf8")).toBe(original);
});

test("post-claim failure retains manifest observations while pre-claim conflict publishes none", async () => {
  const root = await createTestFixtureRoot("skillset-manifest-failure-");
  const sourcePath = join(root, "original");
  await Bun.write(join(sourcePath, ".claude-plugin/plugin.json"), '{"name":"demo","description":"First."}');
  await mkdir(join(root, "partial"));
  await mkdir(join(root, "conflict"));
  let failure: unknown;
  try { await importSource({ rootPath: join(root, "partial"), sourcePath, kind: "plugin", testHooks: { beforeBaselineSeed: async () => { throw new Error("injected failure"); } } }); } catch (error) { failure = error; }
  expect(failure).toBeInstanceOf(ImportBatchError);
  expect((failure as ImportBatchError).imports[0]?.normalizations?.map((entry) => entry.code)).toEqual(["manifest.name", "manifest.description"]);
  await Bun.write(join(sourcePath, ".cursor-plugin/plugin.json"), '{"name":"demo","description":"Conflicting."}');
  await expect(importSource({ rootPath: join(root, "conflict"), sourcePath, kind: "plugin" })).rejects.toThrow("disagree on portable metadata");
  expect(await Bun.file(join(root, "conflict/.skillset/plugins/demo/skillset.yaml")).exists()).toBe(false);
});
