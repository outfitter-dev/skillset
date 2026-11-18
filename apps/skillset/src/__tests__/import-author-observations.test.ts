import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { readReportBundle } from "@skillset/core/internal/report-store";
import { createTestFixtureRoot } from "../../../../scripts/test-helpers/fixture-root";
import { importSource } from "../import";
import { persistImportReceipt } from "../operation-receipt";

test("native author shorthand records the selected name contribution without values", async () => {
  const root = await createTestFixtureRoot("skillset-author-observation-");
  const sourcePath = join(root, "original");
  const original = JSON.stringify({ name: "demo", description: "Demo.", author: "Private Team" });
  await Bun.write(join(sourcePath, ".claude-plugin/plugin.json"), original);
  const report = await importSource({ rootPath: root, sourcePath, kind: "plugin", provider: "claude" });
  expect(report.normalizations).toEqual(expect.arrayContaining([expect.objectContaining({
    code: "manifest.author", dialect: "claude", source: { path: ".claude-plugin/plugin.json", pointer: "/author" },
    destination: { path: ".skillset/plugins/demo/skillset.yaml", pointer: "/skillset/author/name" },
  })]));
  const receipt = await persistImportReceipt({ failed: false, imports: [report], rootPath: root, kind: "plugin", provider: "claude" });
  const stored = await readReportBundle(receipt.id);
  expect(stored.report).toHaveProperty("payload.normalizations", report.normalizations);
  expect(JSON.stringify(report.normalizations)).not.toContain("Private Team");
  expect(stored.markdown).not.toContain("Private Team");
  expect(await readFile(join(sourcePath, ".claude-plugin/plugin.json"), "utf8")).toBe(original);
  expect(await readFile(join(report.targetPath, "skillset.yaml"), "utf8")).toContain("name: Private Team");
});

test("author merge evidence identifies only actual first contributions", async () => {
  const root = await createTestFixtureRoot("skillset-author-contributions-");
  const sourcePath = join(root, "original");
  await Bun.write(join(sourcePath, ".claude-plugin/plugin.json"), JSON.stringify({ name: "demo", author: { name: "Team", email: "private@example.invalid" } }));
  await Bun.write(join(sourcePath, ".cursor-plugin/plugin.json"), JSON.stringify({ name: "demo", author: { name: "Team", email: "private@example.invalid", url: "https://private.example.invalid" } }));
  const report = await importSource({ rootPath: root, sourcePath, kind: "plugin" });
  expect(report.normalizations?.filter((entry) => entry.code === "manifest.author").map((entry) => [entry.dialect, entry.source.pointer, entry.destination.pointer])).toEqual([
    ["claude", "/author/name", "/skillset/author/name"],
    ["claude", "/author/email", "/skillset/author/email"],
    ["cursor", "/author/url", "/skillset/author/url"],
  ]);
});

test("Codex developer name fallback identifies the scalar assignment", async () => {
  const root = await createTestFixtureRoot("skillset-author-fallback-");
  const sourcePath = join(root, "original");
  await Bun.write(join(sourcePath, ".codex-plugin/plugin.json"), JSON.stringify({ name: "demo", interface: { developerName: "Team" } }));
  const report = await importSource({ rootPath: root, sourcePath, kind: "plugin" });
  expect(report.normalizations).toEqual(expect.arrayContaining([expect.objectContaining({
    code: "manifest.author", dialect: "codex", source: { path: ".codex-plugin/plugin.json", pointer: "/interface/developerName" },
    destination: { path: ".skillset/plugins/demo/skillset.yaml", pointer: "/skillset/author" },
  })]));
});

test("existing canonical author authority produces no manifest author observation", async () => {
  const root = await createTestFixtureRoot("skillset-author-canonical-");
  const sourcePath = join(root, "original");
  await Bun.write(join(sourcePath, ".claude-plugin/plugin.json"), '{"name":"demo","author":"Native"}');
  await Bun.write(join(sourcePath, "skillset.yaml"), "skillset:\n  name: demo\n  author: Canonical\n");
  const report = await importSource({ rootPath: root, sourcePath, kind: "plugin" });
  expect(report.normalizations?.filter((entry) => entry.code === "manifest.author")).toEqual([]);
});

test("malformed native authors stay provider-specific without author-copy claims", async () => {
  const root = await createTestFixtureRoot("skillset-author-invalid-");
  const sourcePath = join(root, "original");
  await Bun.write(join(sourcePath, ".claude-plugin/plugin.json"), JSON.stringify({ name: "demo", author: { email: "private@example.invalid" } }));
  const report = await importSource({ rootPath: root, sourcePath, kind: "plugin" });
  expect(report.normalizations?.filter((entry) => entry.code === "manifest.author")).toEqual([]);
  expect(report.warnings.some((warning) => warning.includes("import-unreadable-plugin-author"))).toBe(true);
  const config = await readFile(join(report.targetPath, "skillset.yaml"), "utf8");
  expect(config).toContain("private@example.invalid");
});

test("conflicting authors fail before claiming the destination", async () => {
  const root = await createTestFixtureRoot("skillset-author-conflict-");
  const sourcePath = join(root, "original");
  await Bun.write(join(sourcePath, ".claude-plugin/plugin.json"), '{"name":"demo","author":"First"}');
  await Bun.write(join(sourcePath, ".cursor-plugin/plugin.json"), '{"name":"demo","author":"Second"}');
  await expect(importSource({ rootPath: root, sourcePath, kind: "plugin" })).rejects.toThrow("disagree on portable metadata");
  expect(await Bun.file(join(root, ".skillset/plugins/demo/skillset.yaml")).exists()).toBe(false);
});

test("a real native author suppresses a conflicting Codex developer fallback claim", async () => {
  const root = await createTestFixtureRoot("skillset-author-fallback-unused-");
  const sourcePath = join(root, "original");
  await Bun.write(join(sourcePath, ".codex-plugin/plugin.json"), JSON.stringify({ name: "demo", author: { name: "Author" }, interface: { developerName: "Other" } }));
  const report = await importSource({ rootPath: root, sourcePath, kind: "plugin" });
  expect(report.normalizations?.filter((entry) => entry.code === "manifest.author").map((entry) => entry.source.pointer)).toEqual(["/author/name"]);
});

test("Agent Plugins records its whole author copy without claiming native shape conversion", async () => {
  const { AGENT_PLUGIN_MANIFEST_SCHEMA } = await import("@skillset/core/internal/agent-plugin-manifest");
  const root = await createTestFixtureRoot("skillset-author-standard-");
  const sourcePath = join(root, "original");
  await Bun.write(join(sourcePath, "plugin.json"), JSON.stringify({ $schema: AGENT_PLUGIN_MANIFEST_SCHEMA, name: "demo", description: "Demo.", author: { name: "Team", email: "private@example.invalid" } }));
  const report = await importSource({ rootPath: root, sourcePath, kind: "plugin" });
  expect(report.normalizations?.filter((entry) => entry.code === "manifest.author")).toEqual([expect.objectContaining({ dialect: "agent-plugins", source: { path: "plugin.json", pointer: "/author" }, destination: { path: ".skillset/plugins/demo/skillset.yaml", pointer: "/skillset/author" } })]);
});

test("adoption persists author observations without author values", async () => {
  const { adoptSkillset, renderAdoptReportMarkdown } = await import("../adopt");
  const { persistAdoptionReceipt } = await import("../operation-receipt");
  const root = await createTestFixtureRoot("skillset-author-adoption-");
  await Bun.write(join(root, ".claude-plugin/plugin.json"), JSON.stringify({ name: "demo", description: "Demo.", author: { name: "Private Team", email: "private@example.invalid", url: "https://private.example.invalid" } }));
  await Bun.write(join(root, "skillset.yaml"), "compile:\n  targets: [claude]\n");
  const report = await adoptSkillset(root, { write: true });
  expect(report.ok).toBe(true);
  const entries = report.imports.flatMap((entry) => entry.normalizations ?? []);
  expect(entries.filter((entry) => entry.code === "manifest.author")).toHaveLength(3);
  expect(renderAdoptReportMarkdown(report, { rootPath: root })).toContain("manifest.author");
  const receipt = await persistAdoptionReceipt(report);
  const stored = await readReportBundle(receipt.id);
  expect(stored.report).toHaveProperty("payload.normalizations", entries);
  for (const value of ["Private Team", "private@example.invalid", "https://private.example.invalid"]) {
    expect(JSON.stringify(entries)).not.toContain(value);
    expect(stored.markdown).not.toContain(value);
  }
});

test("post-claim failure retains completed author contributions", async () => {
  const { ImportBatchError } = await import("../import");
  const root = await createTestFixtureRoot("skillset-author-partial-");
  const sourcePath = join(root, "original");
  await Bun.write(join(sourcePath, ".claude-plugin/plugin.json"), '{"name":"demo","author":"Team"}');
  try {
    await importSource({ rootPath: root, sourcePath, kind: "plugin", testHooks: { beforeBaselineSeed: async () => { throw new Error("injected failure"); } } });
    throw new Error("expected import failure");
  } catch (error) {
    if (!(error instanceof ImportBatchError)) throw error;
    const entries = error.imports.flatMap((entry) => entry.normalizations ?? []);
    expect(entries.some((entry) => entry.code === "manifest.author")).toBe(true);
    const receipt = await persistImportReceipt({ failed: true, imports: error.imports, rootPath: root, kind: "plugin", provider: undefined });
    expect((await readReportBundle(receipt.id)).report).toHaveProperty("payload.normalizations", entries);
  }
});
