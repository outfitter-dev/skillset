import { expect, test } from "bun:test";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { createTestFixtureRoot } from "../../../../scripts/test-helpers/fixture-root";
import { importSource } from "../import";

test("portable manifest and listing assignments report their distinct destinations", async () => {
  const root = await createTestFixtureRoot("skillset-metadata-observation-");
  const sourcePath = join(root, "original");
  const manifest = { name: "demo", description: "Demo.", homepage: "https://private.example.invalid", repository: "https://private.example.invalid/repo", license: "MIT", keywords: ["private-keyword"], displayName: "Private Display" };
  const original = JSON.stringify(manifest);
  await Bun.write(join(sourcePath, ".claude-plugin/plugin.json"), original);
  const report = await importSource({ rootPath: root, sourcePath, kind: "plugin" });
  expect(report.normalizations?.filter((entry) => entry.code === "manifest.metadata").map((entry) => [entry.source.pointer, entry.destination.pointer])).toEqual([
    ["/homepage", "/skillset/homepage"], ["/repository", "/skillset/repository"], ["/license", "/skillset/license"], ["/keywords", "/skillset/keywords"],
  ]);
  expect(report.normalizations?.filter((entry) => entry.code === "manifest.listing").map((entry) => [entry.source.pointer, entry.destination.pointer])).toEqual([
    ["/displayName", "/skillset/listing/display_name"], ["/keywords", "/skillset/listing/keywords"],
  ]);
  for (const privateValue of [manifest.homepage, manifest.repository, manifest.keywords[0]!, manifest.displayName]) expect(JSON.stringify(report.normalizations)).not.toContain(privateValue);
  expect(await readFile(join(sourcePath, ".claude-plugin/plugin.json"), "utf8")).toBe(original);
});

test("Codex interface listing fields identify selected native pointers", async () => {
  const root = await createTestFixtureRoot("skillset-listing-observation-");
  const sourcePath = join(root, "original");
  await Bun.write(join(sourcePath, ".codex-plugin/plugin.json"), JSON.stringify({
    name: "demo", description: "Summary.", interface: {
      displayName: "Display", shortDescription: "Summary.", longDescription: "Details.", category: "tools",
      capabilities: ["read"], brandColor: "#123456", websiteURL: "https://example.invalid", privacyPolicyURL: "https://example.invalid/privacy",
      termsOfServiceURL: "https://example.invalid/terms", defaultPrompt: ["Try it"], composerIcon: "assets/icon.svg", logo: "assets/logo.svg", screenshots: ["assets/screen.png"],
    },
  }));
  const report = await importSource({ rootPath: root, sourcePath, kind: "plugin" });
  const mappings = report.normalizations?.filter((entry) => entry.code === "manifest.listing").map((entry) => [entry.source.pointer, entry.destination.pointer]);
  expect(mappings).toEqual([
    ["/interface/displayName", "/skillset/listing/display_name"],
    ["/interface/shortDescription", "/skillset/listing/summary"],
    ["/interface/longDescription", "/skillset/listing/description"],
    ["/interface/category", "/skillset/listing/category"],
    ["/interface/capabilities", "/skillset/listing/capabilities"],
    ["/interface/brandColor", "/skillset/listing/color"],
    ["/interface/websiteURL", "/skillset/listing/website_url"],
    ["/interface/privacyPolicyURL", "/skillset/listing/privacy_policy_url"],
    ["/interface/termsOfServiceURL", "/skillset/listing/terms_of_service_url"],
    ["/interface/defaultPrompt", "/skillset/listing/default_prompt"],
    ["/interface/composerIcon", "/skillset/listing/composer_icon"],
    ["/interface/logo", "/skillset/listing/logo"],
    ["/interface/screenshots", "/skillset/listing/screenshots"],
  ]);
});

test("equal values record only the selected provider for each assignment", async () => {
  const root = await createTestFixtureRoot("skillset-metadata-precedence-");
  const sourcePath = join(root, "original");
  await Bun.write(join(sourcePath, ".claude-plugin/plugin.json"), JSON.stringify({ name: "demo", homepage: "https://example.invalid", keywords: ["demo"], displayName: "Display" }));
  await Bun.write(join(sourcePath, ".codex-plugin/plugin.json"), JSON.stringify({ name: "demo", homepage: "https://example.invalid", keywords: ["demo"], interface: { displayName: "Display" } }));
  const report = await importSource({ rootPath: root, sourcePath, kind: "plugin" });
  expect(report.normalizations?.filter((entry) => entry.code === "manifest.metadata").map((entry) => [entry.dialect, entry.source.pointer])).toEqual([["claude", "/homepage"], ["claude", "/keywords"]]);
  expect(report.normalizations?.filter((entry) => entry.code === "manifest.listing").map((entry) => [entry.dialect, entry.source.pointer])).toEqual([["codex", "/interface/displayName"], ["claude", "/keywords"]]);
});

test("conflicting native listing values remain overrides without false assignment evidence", async () => {
  const root = await createTestFixtureRoot("skillset-listing-conflict-");
  const sourcePath = join(root, "original");
  await Bun.write(join(sourcePath, ".claude-plugin/plugin.json"), '{"name":"demo","displayName":"Claude"}');
  await Bun.write(join(sourcePath, ".codex-plugin/plugin.json"), '{"name":"demo","interface":{"displayName":"Codex","logo":"codex.svg"}}');
  await Bun.write(join(sourcePath, ".cursor-plugin/plugin.json"), '{"name":"demo","logo":"cursor.svg"}');
  const report = await importSource({ rootPath: root, sourcePath, kind: "plugin" });
  expect(report.normalizations?.filter((entry) => entry.code === "manifest.listing")).toEqual([]);
  const config = await readFile(join(report.targetPath, "skillset.yaml"), "utf8");
  for (const value of ["Claude", "Codex", "codex.svg", "cursor.svg"]) expect(config).toContain(value);
});

test("description fallbacks and missing listing values do not create fabricated assignments", async () => {
  const root = await createTestFixtureRoot("skillset-listing-fallback-");
  const sourcePath = join(root, "original");
  await Bun.write(join(sourcePath, ".codex-plugin/plugin.json"), JSON.stringify({ name: "demo", description: "Canonical.", interface: { shortDescription: "Other.", longDescription: "Canonical.", capabilities: [] } }));
  const report = await importSource({ rootPath: root, sourcePath, kind: "plugin" });
  expect(report.normalizations?.filter((entry) => entry.code === "manifest.listing").map((entry) => entry.source.pointer)).toEqual(["/interface/longDescription", "/interface/capabilities"]);
});

test("existing canonical config suppresses manifest metadata and listing assignments", async () => {
  const root = await createTestFixtureRoot("skillset-metadata-authority-");
  const sourcePath = join(root, "original");
  await Bun.write(join(sourcePath, "skillset.yaml"), "skillset:\n  name: demo\n  homepage: https://canonical.example.invalid\n");
  await Bun.write(join(sourcePath, ".claude-plugin/plugin.json"), '{"name":"demo","homepage":"https://native.example.invalid","displayName":"Native"}');
  const report = await importSource({ rootPath: root, sourcePath, kind: "plugin" });
  expect(report.normalizations).toEqual([]);
});

test("Agent Plugins records all selected portable metadata copies", async () => {
  const { AGENT_PLUGIN_MANIFEST_SCHEMA } = await import("@skillset/core/internal/agent-plugin-manifest");
  const root = await createTestFixtureRoot("skillset-standard-metadata-");
  const sourcePath = join(root, "original");
  const original = JSON.stringify({ $schema: AGENT_PLUGIN_MANIFEST_SCHEMA, name: "demo", description: "Demo.", homepage: "https://example.invalid", repository: "https://example.invalid/repo", license: "MIT", keywords: ["demo"] });
  await Bun.write(join(sourcePath, "plugin.json"), original);
  const report = await importSource({ rootPath: root, sourcePath, kind: "plugin" });
  expect(report.normalizations?.filter((entry) => entry.code === "manifest.metadata").map((entry) => [entry.dialect, entry.source.path, entry.source.pointer])).toEqual([
    ["agent-plugins", "plugin.json", "/homepage"], ["agent-plugins", "plugin.json", "/repository"], ["agent-plugins", "plugin.json", "/license"], ["agent-plugins", "plugin.json", "/keywords"],
  ]);
  expect(await readFile(join(sourcePath, "plugin.json"), "utf8")).toBe(original);
});

test("adoption and failed post-claim receipts retain metadata evidence without values", async () => {
  const { adoptSkillset, renderAdoptReportMarkdown } = await import("../adopt");
  const { ImportBatchError } = await import("../import");
  const { persistAdoptionReceipt, persistImportReceipt } = await import("../operation-receipt");
  const { readReportBundle } = await import("@skillset/core/internal/report-store");
  const root = await createTestFixtureRoot("skillset-metadata-receipts-");
  const original = '{"name":"demo","description":"Demo.","homepage":"https://private.example.invalid","displayName":"Private Display"}';
  await Bun.write(join(root, ".claude-plugin/plugin.json"), original);
  await Bun.write(join(root, "skillset.yaml"), "compile:\n  targets: [claude]\n");
  const adopted = await adoptSkillset(root, { write: true });
  expect(adopted.ok).toBe(true);
  const entries = adopted.imports.flatMap((entry) => entry.normalizations ?? []);
  expect(renderAdoptReportMarkdown(adopted, { rootPath: root })).toContain("manifest.listing");
  const receipt = await persistAdoptionReceipt(adopted);
  const stored = await readReportBundle(receipt.id);
  expect(stored.report).toHaveProperty("payload.normalizations", entries);
  expect(stored.markdown).not.toContain("https://private.example.invalid");
  expect(stored.markdown).not.toContain("Private Display");
  const partialRoot = await createTestFixtureRoot("skillset-metadata-partial-");
  const sourcePath = join(partialRoot, "original");
  await Bun.write(join(sourcePath, ".claude-plugin/plugin.json"), original);
  try {
    await importSource({ rootPath: partialRoot, sourcePath, kind: "plugin", testHooks: { beforeBaselineSeed: async () => { throw new Error("injected failure"); } } });
    throw new Error("expected failure");
  } catch (error) {
    if (!(error instanceof ImportBatchError)) throw error;
    const partial = await persistImportReceipt({ failed: true, imports: error.imports, rootPath: partialRoot, kind: "plugin", provider: undefined });
    const partialEntries = error.imports.flatMap((entry) => entry.normalizations ?? []);
    expect(partialEntries.some((entry) => entry.code === "manifest.metadata")).toBe(true);
    expect(partialEntries.some((entry) => entry.code === "manifest.listing")).toBe(true);
    expect((await readReportBundle(partial.id)).report).toHaveProperty("payload.normalizations", partialEntries);
  }
});
