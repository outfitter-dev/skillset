import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { buildSkillsetResult } from "@skillset/core";
import { parseMarkdown } from "@skillset/core/internal/yaml";
import { createTestFixtureRoot } from "../../../../scripts/test-helpers/fixture-root";
import { importSource } from "../import";

const raw = "---\nname: bounded\ndescription: Provider boundary fixture.\ncontext: fork\narguments: [topic]\nfrobnicate:\n  nested: [false, null, value]\nlicense: MIT\ncompatibility: Requires git\nmetadata:\n  author: fixture\n---\nPreserve this body.\n";

test("explicit Claude provenance scopes native and unknown fields without changing portable metadata", async () => {
  const root = await createTestFixtureRoot("skillset-import-frontmatter-boundary-");
  const sourcePath = join(root, "original");
  await Bun.write(join(root, "skillset.yaml"), "compile:\n  targets: [claude, cursor]\n");
  await Bun.write(join(sourcePath, "SKILL.md"), raw);
  const report = await importSource({ rootPath: root, sourcePath, kind: "skill", provider: "claude" });
  const imported = parseMarkdown(await readFile(join(report.targetPath, "SKILL.md"), "utf8"), "SKILL.md").frontmatter;
  expect(imported.claude).toMatchObject({ frontmatter: { context: "fork", arguments: ["topic"], frobnicate: { nested: [false, null, "value"] } } });
  expect(report.frontmatterFindings).toHaveLength(3);
  expect(report.frontmatterFindings?.every((flag) => flag.disposition === "ambiguous")).toBe(true);
  expect(imported).not.toHaveProperty("context");
  expect(imported).not.toHaveProperty("frobnicate");
  expect(imported).toMatchObject({ license: "MIT", compatibility: "Requires git", metadata: { author: "fixture" } });
  await buildSkillsetResult(root);
  const cursor = parseMarkdown(await readFile(join(root, ".cursor/skills/bounded/SKILL.md"), "utf8"), "cursor").frontmatter;
  expect(cursor).not.toHaveProperty("context");
  expect(cursor).not.toHaveProperty("arguments");
  expect(cursor).not.toHaveProperty("frobnicate");
  const claude = parseMarkdown(await readFile(join(root, ".claude/skills/bounded/SKILL.md"), "utf8"), "claude").frontmatter;
  expect(claude).toMatchObject({ context: "fork", arguments: ["topic"], frobnicate: { nested: [false, null, "value"] } });
  expect(await readFile(join(sourcePath, "SKILL.md"), "utf8")).toBe(raw);
});

test("shared plugin output rejects unproven provider fields before publishing a cross-provider artifact", async () => {
  const root = await createTestFixtureRoot("skillset-import-shared-frontmatter-");
  const sourcePath = join(root, "original");
  await Bun.write(join(root, "skillset.yaml"), "compile:\n  targets: [claude, cursor]\n  unsupportedDestination: warn\n");
  await Bun.write(join(sourcePath, ".claude-plugin/plugin.json"), '{"name":"bounded-plugin"}');
  await Bun.write(join(sourcePath, "skills/team/bounded/SKILL.md"), raw);
  await importSource({ rootPath: root, sourcePath, kind: "plugin", provider: "claude" });
  await expect(buildSkillsetResult(root)).rejects.toThrow("conflicts at");
  expect(await Bun.file(join(root, "plugins/bounded-plugin/skills/bounded/SKILL.md")).exists()).toBe(false);
  expect(await readFile(join(sourcePath, "skills/team/bounded/SKILL.md"), "utf8")).toBe(raw);
});

test("adoption records native and unknown frontmatter with body findings under one document owner", async () => {
  const { adoptSkillset } = await import("../adopt");
  const { readMigrationState } = await import("@skillset/core/internal/migration-state");
  const root = await createTestFixtureRoot("skillset-adopt-frontmatter-findings-");
  const original = join(root, ".claude/skills/bounded/SKILL.md");
  const source = raw.replace("Preserve this body.", "Ask @alice.");
  await Bun.write(original, source);
  const report = await adoptSkillset(root, { write: true });
  expect(report.migrationError).toBeUndefined();
  const { state } = await readMigrationState(root);
  const flags = state.flags.filter((flag) => flag.source.path === ".skillset/skills/bounded/SKILL.md");
  expect(flags.filter((flag) => flag.code === "adopt.provider-frontmatter-unverified")).toHaveLength(2);
  expect(flags.filter((flag) => flag.code === "adopt.unknown-frontmatter")).toHaveLength(1);
  for (const flag of flags.filter((item) => item.code.includes("frontmatter"))) {
    expect(flag.placement.kind).toBe("sidecar");
    expect(flag.origin?.path).toBe(".claude/skills/bounded/SKILL.md");
    expect(flag.source.line).toBeUndefined();
    expect(flag.evidence.some((item) => item.summary.includes("cross-provider") || item.summary.includes("unknown"))).toBe(true);
  }
  expect(flags.some((flag) => flag.placement.kind === "inline")).toBe(true);
  expect(report.migrationFlags?.map((flag) => flag.id).sort()).toEqual(state.flags.map((flag) => flag.id).sort());
  expect(await readFile(original, "utf8")).toBe(source);
});

for (const policy of ["warn", "force"]) {
  test(`unattributed import keeps values but cannot project with ${policy} policy`, async () => {
    const root = await createTestFixtureRoot("skillset-import-unresolved-frontmatter-");
    const sourcePath = join(root, "original");
    await Bun.write(join(root, "skillset.yaml"), `compile:\n  targets: [claude, cursor]\n  unsupportedDestination: ${policy}\n`);
    await Bun.write(join(sourcePath, "SKILL.md"), raw);
    const report = await importSource({ rootPath: root, sourcePath, kind: "skill" });
    const imported = parseMarkdown(await readFile(join(report.targetPath, "SKILL.md"), "utf8"), "imported").frontmatter;
    expect(imported).toMatchObject({ context: "fork", frobnicate: { nested: [false, null, "value"] }, skillset: { unresolved_frontmatter: ["arguments", "context", "frobnicate"] } });
    expect(report.migrationFlags).toHaveLength(3);
    expect(report.migrationWritePaths).toContain(".skillset/adopt/state.json");
    expect(imported).not.toHaveProperty("claude");
    await expect(buildSkillsetResult(root)).rejects.toThrow("unresolved imported frontmatter");
    expect(await Bun.file(join(root, ".cursor/skills/bounded/SKILL.md")).exists()).toBe(false);
    expect(await readFile(join(sourcePath, "SKILL.md"), "utf8")).toBe(raw);
  });
}

test("removing the source marker does not resolve the durable unattributed-field decision", async () => {
  const { updateMarkdownSourceDocument } = await import("@skillset/core/internal/source-document");
  const root = await createTestFixtureRoot("skillset-import-marker-deletion-");
  await Bun.write(join(root, "skillset.yaml"), "compile:\n  targets: [claude, cursor]\n");
  const sourcePath = join(root, "original");
  await Bun.write(join(sourcePath, "SKILL.md"), raw);
  const report = await importSource({ rootPath: root, sourcePath, kind: "skill" });
  const path = join(report.targetPath, "SKILL.md");
  const content = await readFile(path, "utf8");
  await Bun.write(path, updateMarkdownSourceDocument(content, path, (parts) => ({ ...parts, frontmatter: { ...parts.frontmatter, skillset: {} } })));
  await expect(buildSkillsetResult(root)).rejects.toThrow("unresolved imported frontmatter review");
});

test("failed finding persistence leaves an unrenderable preserved source", async () => {
  const { rm } = await import("node:fs/promises");
  const root = await createTestFixtureRoot("skillset-import-failed-findings-");
  const sourcePath = join(root, "original");
  await Bun.write(join(root, "skillset.yaml"), "compile:\n  targets: [claude, cursor]\n");
  await Bun.write(join(sourcePath, "SKILL.md"), raw);
  const ledger = join(root, ".skillset/adopt/state.json");
  await expect(importSource({ rootPath: root, sourcePath, kind: "skill", testHooks: {
    beforeFindings: async () => { await Bun.write(ledger, "{ invalid ledger"); },
  } })).rejects.toThrow();
  const imported = parseMarkdown(await readFile(join(root, ".skillset/skills/bounded/SKILL.md"), "utf8"), "preserved").frontmatter;
  expect(imported).toHaveProperty("skillset.unresolved_frontmatter");
  await rm(ledger);
  await expect(buildSkillsetResult(root)).rejects.toThrow("unresolved imported frontmatter");
  expect(await readFile(join(sourcePath, "SKILL.md"), "utf8")).toBe(raw);
});

test("explicit Skillset provenance retains canonical schema fields without a provider inference", async () => {
  const root = await createTestFixtureRoot("skillset-import-canonical-frontmatter-");
  const sourcePath = join(root, "original");
  await Bun.write(join(root, "skillset.yaml"), "compile:\n  targets: [claude, cursor]\n");
  const source = "---\nname: bounded\ndescription: Canonical source.\nschema: 1\nmodel: source-model\n---\nBody.\n";
  await Bun.write(join(sourcePath, "SKILL.md"), source);
  const report = await importSource({ rootPath: root, sourcePath, kind: "skill", provider: "skillset" });
  expect(report.frontmatterSources).toEqual([]);
  expect(await readFile(join(report.targetPath, "SKILL.md"), "utf8")).toBe(source);
  await buildSkillsetResult(root);
});

test("a declared native plugin manifest supplies source attribution without guessing from field spelling", async () => {
  const root = await createTestFixtureRoot("skillset-import-manifest-frontmatter-");
  const sourcePath = join(root, "original");
  await Bun.write(join(sourcePath, ".claude-plugin/plugin.json"), '{"name":"bounded-plugin"}');
  await Bun.write(join(sourcePath, "skills/bounded/SKILL.md"), raw);
  const report = await importSource({ rootPath: root, sourcePath, kind: "plugin" });
  expect(report.frontmatterSources?.[0]?.providers).toEqual(["claude"]);
  const imported = parseMarkdown(await readFile(join(report.targetPath, "skills/bounded/SKILL.md"), "utf8"), "imported").frontmatter;
  expect(imported.claude).toHaveProperty("frontmatter.context", "fork");
  expect(imported).not.toHaveProperty("skillset.unresolved_frontmatter");
});
