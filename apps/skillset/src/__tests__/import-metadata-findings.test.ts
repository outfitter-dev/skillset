import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createTestFixtureRoot } from "../../../../scripts/test-helpers/fixture-root";
import { readMigrationState } from "@skillset/core/internal/migration-state";
import { parseMarkdown } from "@skillset/core/internal/yaml";
import { importSource } from "../import";
import { readReportBundle } from "@skillset/core/internal/report-store";
import { persistAdoptionReceipt } from "../operation-receipt";
import { adoptSkillset } from "../adopt";

const raw = "---\nname: demo\ndescription: Demo.\nmetadata:\n  author: fixture\n  openclaw:\n    runtime: retained-private-value\n  'slash/~key': [false, null]\n---\nBody.\n";

test("direct import retains structured canonical metadata and reports standard compatibility findings", async () => {
  const root = await createTestFixtureRoot("skillset-import-metadata-findings-");
  const sourcePath = join(root, "original");
  await Bun.write(join(root, "skillset.yaml"), "compile:\n  targets: [claude]\n");
  await Bun.write(join(sourcePath, "SKILL.md"), raw);
  const report = await importSource({ rootPath: root, sourcePath, kind: "skill", provider: "claude" });
  const flags = report.frontmatterFindings?.filter((flag) => flag.code === "adopt.metadata-standard-incompatible") ?? [];
  expect(flags).toHaveLength(2);
  expect(report.warnings.some((warning) => warning.includes("Agent Skills"))).toBe(true);
  expect(JSON.stringify(flags)).not.toContain("retained-private-value");
  expect(JSON.stringify(flags)).toContain("/metadata/slash~1~0key");
  expect(flags.every((flag) => flag.placement.kind === "sidecar" && flag.disposition === "lossy-unsupported")).toBe(true);
  expect(parseMarkdown(await readFile(join(report.targetPath, "SKILL.md"), "utf8"), "imported").frontmatter.metadata).toEqual(parseMarkdown(raw, "original").frontmatter.metadata);
  expect((await readMigrationState(root)).state.flags.map((flag) => flag.id).sort()).toEqual((report.migrationFlags ?? []).map((flag) => flag.id).sort());
  expect(await readFile(join(sourcePath, "SKILL.md"), "utf8")).toBe(raw);
});

test("adoption retains metadata findings alongside native fields before a shared-plugin build fails", async () => {
  const root = await createTestFixtureRoot("skillset-adopt-metadata-findings-");
  await Bun.write(join(root, ".claude-plugin/plugin.json"), JSON.stringify({ name: "demo-plugin", description: "Demo plugin." }));
  const original = join(root, "skills/demo/SKILL.md");
  const content = raw.replace("metadata:", "user-invocable: false\nmetadata:");
  await Bun.write(original, content);
  const report = await adoptSkillset(root, { write: true, targets: ["claude", "codex"] });
  expect(report.ok).toBe(false);
  expect(report.migrationError).toBeUndefined();
  const flags = (await readMigrationState(root)).state.flags;
  expect(flags.filter((flag) => flag.code === "adopt.metadata-standard-incompatible")).toHaveLength(2);
  expect(flags.some((flag) => flag.code === "adopt.provider-frontmatter-unverified")).toBe(true);
  expect(report.migrationFlags?.map((flag) => flag.id).sort()).toEqual(flags.map((flag) => flag.id).sort());
  expect(report.buildError).toContain("metadata");
  expect(flags.filter((flag) => flag.code === "adopt.metadata-standard-incompatible").every((flag) => flag.origin?.path === "skills/demo/SKILL.md")).toBe(true);
  expect(await readFile(original, "utf8")).toBe(content);
  const receipt = await persistAdoptionReceipt(report);
  const bundle = await readReportBundle(receipt.id);
  expect(JSON.stringify(bundle.report)).toContain("adopt.metadata-standard-incompatible");
  expect(JSON.stringify(bundle.report)).not.toContain("retained-private-value");
  expect(JSON.stringify(bundle.report)).not.toContain("slash/~key");
});

for (const provider of [undefined, "skillset"] as const) {
  test(`metadata compatibility does not require native provenance: ${provider ?? "unknown"}`, async () => {
    const root = await createTestFixtureRoot("skillset-metadata-source-kind-");
    const sourcePath = join(root, "original");
    await Bun.write(join(root, "skillset.yaml"), "compile:\n  targets: [claude]\n");
    await Bun.write(join(sourcePath, "SKILL.md"), raw);
    const report = await importSource({ rootPath: root, sourcePath, kind: "skill", ...(provider === undefined ? {} : { provider }) });
    expect(report.frontmatterFindings?.filter((flag) => flag.code === "adopt.metadata-standard-incompatible")).toHaveLength(2);
    expect(report.frontmatterFindings?.some((flag) => flag.code === "adopt.unattributed-frontmatter")).toBe(false);
    const imported = parseMarkdown(await readFile(join(report.targetPath, "SKILL.md"), "utf8"), "source").frontmatter;
    expect(imported).not.toHaveProperty("skillset.unresolved_frontmatter");
    expect(imported).not.toHaveProperty("claude.frontmatter.metadata");
  });
}

test("metadata findings survive a baseline failure in the partial adoption import", async () => {
  const root = await createTestFixtureRoot("skillset-metadata-partial-source-");
  const sourcePath = join(root, "original");
  await Bun.write(join(root, "skillset.yaml"), "compile:\n  targets: [claude]\n");
  await Bun.write(join(sourcePath, "SKILL.md"), raw);
  try {
    await importSource({ rootPath: root, sourcePath, kind: "skill", provider: "claude", testHooks: { beforeBaselineSeed: () => { throw new Error("baseline fixture"); } } });
    throw new Error("expected baseline failure");
  } catch (error) {
    const { ImportBatchError } = await import("../import");
    expect(error).toBeInstanceOf(ImportBatchError);
    const partial = (error as InstanceType<typeof ImportBatchError>).imports[0]!;
    expect(partial.frontmatterSources?.[0]?.metadataCompatibility).toBe(true);
    const { recordImportedFindings } = await import("@skillset/core/internal/adoption-findings");
    const recorded = await recordImportedFindings(root, { frontmatter: partial.frontmatterSources ?? [] });
    expect(recorded.flags.filter((flag) => flag.code === "adopt.metadata-standard-incompatible")).toHaveLength(2);
    expect(await readFile(join(sourcePath, "SKILL.md"), "utf8")).toBe(raw);
  }
});
