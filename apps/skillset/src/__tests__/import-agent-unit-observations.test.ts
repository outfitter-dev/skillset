import { expect, test } from "bun:test";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { AGENT_PLUGIN_MANIFEST_SCHEMA } from "@skillset/core/internal/agent-plugin-manifest";
import { createTestFixtureRoot } from "../../../../scripts/test-helpers/fixture-root";
import { importSource, ImportBatchError } from "../import";

async function fixture() {
  const root = await createTestFixtureRoot("skillset-agent-unit-evidence-");
  const sourcePath = join(root, "original");
  await Bun.write(join(sourcePath, "plugin.json"), JSON.stringify({ $schema: AGENT_PLUGIN_MANIFEST_SCHEMA, name: "demo", description: "Demo." }));
  return { root, sourcePath };
}
const skill = (fields: string) => `---\nname: review\ndescription: Review.\n${fields}---\n\nBody unchanged.\n`;

test("Agent Plugins records field conversions, license binding and actual package renames", async () => {
  const { root, sourcePath } = await fixture();
  const primary = skill("allowed-tools: PrivateTool\nlicense: MIT\n");
  await Bun.write(join(sourcePath, "skills/review/SKILL.md"), primary);
  await Bun.write(join(sourcePath, "skills/file/SKILL.md"), skill("license: LICENSE.txt\n").replace("name: review", "name: file"));
  await Bun.write(join(sourcePath, "skills/file/LICENSE.txt"), "Private license terms.\n");
  await Bun.write(join(sourcePath, "LICENSE"), "Package terms.\n");
  const report = await importSource({ rootPath: root, sourcePath, kind: "plugin" });
  const entries = report.normalizations?.filter((entry) => entry.code.startsWith("agent-plugins."));
  expect(entries?.map((entry) => [entry.code, entry.source, entry.destination])).toEqual(expect.arrayContaining([
    ["agent-plugins.allowed-tools", { path: "skills/review/SKILL.md", pointer: "/allowed-tools" }, { path: ".skillset/plugins/demo/skills/review/SKILL.md", pointer: "/allowed_tools/agents" }],
    ["agent-plugins.license-metadata", { path: "skills/review/SKILL.md", pointer: "/license" }, { path: ".skillset/plugins/demo/skills/review/SKILL.md", pointer: "/skillset/license" }],
    ["agent-plugins.license-file", { path: "skills/file/SKILL.md", pointer: "/license" }, { path: ".skillset/plugins/demo/skills/file/LICENSE.txt", pointer: "" }],
    ["agent-plugins.license-path", { path: "LICENSE", pointer: "" }, { path: ".skillset/plugins/demo/LICENSE.txt", pointer: "" }],
    ["agent-plugins.manifest-to-source", { path: "plugin.json", pointer: "" }, { path: ".skillset/plugins/demo/skillset.yaml", pointer: "" }],
  ]));
  expect(entries).toHaveLength(5);
  for (const entry of entries ?? []) { expect(entry.fidelity).toBe("unknown"); expect(entry.evidence.length).toBeGreaterThan(1); }
  expect(JSON.stringify(entries)).not.toContain("PrivateTool");
  expect(JSON.stringify(entries)).not.toContain("Private license terms");
  expect(await readFile(join(sourcePath, "skills/review/SKILL.md"), "utf8")).toBe(primary);
  expect(await readFile(join(report.targetPath, "LICENSE.txt"), "utf8")).toBe("Package terms.\n");
  expect(await readFile(join(report.targetPath, "skills/file/LICENSE.txt"), "utf8")).toBe("Private license terms.\n");
});

test("absent fields and canonical license filenames do not invent conversions", async () => {
  const { root, sourcePath } = await fixture();
  await Bun.write(join(sourcePath, "skills/review/SKILL.md"), skill(""));
  await Bun.write(join(sourcePath, "LICENSE.txt"), "Terms.\n");
  const report = await importSource({ rootPath: root, sourcePath, kind: "plugin" });
  expect(report.normalizations?.filter((entry) => entry.code.startsWith("agent-plugins.")).map((entry) => entry.code)).toEqual(["agent-plugins.manifest-to-source"]);
});

test("post-claim failure retains unit conversion evidence in immutable receipts", async () => {
  const { persistImportReceipt } = await import("../operation-receipt");
  const { readReportBundle } = await import("@skillset/core/internal/report-store");
  const { root, sourcePath } = await fixture();
  await Bun.write(join(sourcePath, "skills/review/SKILL.md"), skill("allowed-tools: PrivateTool\n"));
  try {
    await importSource({ rootPath: root, sourcePath, kind: "plugin", testHooks: { beforeBaselineSeed: async () => { throw new Error("injected"); } } });
    throw new Error("expected failure");
  } catch (error) {
    if (!(error instanceof ImportBatchError)) throw error;
    const entries = error.imports.flatMap((entry) => entry.normalizations ?? []);
    expect(entries.some((entry) => entry.code === "agent-plugins.allowed-tools")).toBe(true);
    const receipt = await persistImportReceipt({ failed: true, imports: error.imports, rootPath: root, kind: "plugin", provider: undefined });
    const stored = await readReportBundle(receipt.id);
    expect(stored.report).toHaveProperty("payload.normalizations", entries);
    expect(stored.markdown).toContain("agent-plugins.allowed-tools");
    expect(stored.markdown).not.toContain("PrivateTool");
  }
});


test("adoption carries unit evidence to its report and receipt deterministically", async () => {
  const { adoptSkillset, renderAdoptReportMarkdown } = await import("../adopt");
  const { persistAdoptionReceipt } = await import("../operation-receipt");
  const { readReportBundle } = await import("@skillset/core/internal/report-store");
  const results = [];
  for (let index = 0; index < 2; index++) {
    const { sourcePath } = await fixture();
    const original = skill("allowed-tools: PrivateTool\nlicense: MIT\n");
    await Bun.write(join(sourcePath, "skills/review/SKILL.md"), original);
    const report = await adoptSkillset(sourcePath, { write: true });
    expect(report.ok).toBe(true);
    const entries = report.imports.flatMap((entry) => entry.normalizations ?? []);
    expect(entries.some((entry) => entry.code === "agent-plugins.allowed-tools")).toBe(true);
    expect(renderAdoptReportMarkdown(report, { rootPath: sourcePath })).toContain("agent-plugins.allowed-tools");
    const receipt = await persistAdoptionReceipt(report);
    const stored = await readReportBundle(receipt.id);
    expect(stored.report).toHaveProperty("payload.normalizations", entries);
    expect(stored.markdown).not.toContain("PrivateTool");
    expect(await readFile(join(sourcePath, "skills/review/SKILL.md"), "utf8")).toBe(original);
    results.push(entries);
  }
  expect(results[0]).toEqual(results[1]);
});
