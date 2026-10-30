import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { buildSkillsetResult } from "@skillset/core";
import { readReportBundle } from "@skillset/core/internal/report-store";
import { persistImportReceipt } from "../operation-receipt";
import { parseMarkdown } from "@skillset/core/internal/yaml";
import { createTestFixtureRoot } from "../../../../scripts/test-helpers/fixture-root";
import { importSource } from "../import";

const skill = "---\nname: actual-name\ndescription: Native policy.\ndisable-model-invocation: true\nuser-invocable: false\nfrobnicate: maybe\n---\nBody.\n";

test("nested primary plugin skills receive policy scoping, actual identity and field summaries", async () => {
  const root = await createTestFixtureRoot("skillset-nested-import-policy-");
  const sourcePath = join(root, "original");
  const path = "skills/engineering/review/SKILL.md";
  const companionPath = "skills/engineering/review/references/example/SKILL.md";
  await Bun.write(join(root, "skillset.yaml"), "compile:\n  targets: [claude, cursor]\n");
  await Bun.write(join(sourcePath, ".claude-plugin/plugin.json"), '{"name":"native-policy"}');
  await Bun.write(join(sourcePath, path), skill);
  const companion = "---\nname: companion-example\ndisable-model-invocation: true\n---\nResource.\n";
  await Bun.write(join(sourcePath, companionPath), companion);
  const report = await importSource({ rootPath: root, sourcePath, kind: "plugin", provider: "claude" });
  const imported = parseMarkdown(await readFile(join(report.targetPath, path), "utf8"), path).frontmatter;
  expect(imported.claude).toMatchObject({ frontmatter: { "disable-model-invocation": true, "user-invocable": false } });
  expect(imported).not.toHaveProperty("disable-model-invocation");
  expect(report.renderResults).toContainEqual(expect.objectContaining({ sourceUnit: "plugin.native-policy.skill:actual-name", featureId: "skill-invocation-policy", target: "claude" }));
  expect(report.renderResults.every((result) => !result.sourceUnit.includes("companion-example"))).toBe(true);
  expect(report.preservedTargetNativeFields).toEqual(expect.arrayContaining(["disable-model-invocation", "user-invocable"]));
  expect(report.unsupportedFields).toContain("frobnicate");
  const receipt = await persistImportReceipt({ rootPath: root, kind: "plugin", provider: "claude", imports: [report], failed: false });
  const stored = await readReportBundle(receipt.id);
  expect(stored.report).toMatchObject({ payload: { fields: { preserved: 2, unsupported: 1 }, warningCodes: expect.arrayContaining(["import.target-native-preserved", "import.unsupported-preserved"]) } });
  expect(await readFile(join(report.targetPath, companionPath), "utf8")).toBe(companion);
  expect(await readFile(join(sourcePath, path), "utf8")).toBe(skill);
  await expect(buildSkillsetResult(root)).rejects.toThrow("conflicts at disable-model-invocation");
  expect(await Bun.file(join(root, "plugins/native-policy/skills/actual-name/SKILL.md")).exists()).toBe(false);
});

test("nested conflicting native policy fails before destination claim", async () => {
  const root = await createTestFixtureRoot("skillset-nested-import-conflict-");
  const sourcePath = join(root, "original");
  await Bun.write(join(sourcePath, ".claude-plugin/plugin.json"), '{"name":"native-policy"}');
  await Bun.write(join(sourcePath, "skills/team/review/SKILL.md"), skill.replace("user-invocable: false", "user-invocable: false\nclaude:\n  frontmatter:\n    user-invocable: true"));
  await expect(importSource({ rootPath: root, sourcePath, kind: "plugin", provider: "claude" })).rejects.toThrow("conflicting");
  expect(await Bun.file(join(root, ".skillset/plugins/native-policy/skillset.yaml")).exists()).toBe(false);
});

test("unknown standalone provenance never creates a Claude-native result", async () => {
  const root = await createTestFixtureRoot("skillset-import-unknown-origin-");
  const sourcePath = join(root, "original");
  await Bun.write(join(sourcePath, "SKILL.md"), skill);
  const report = await importSource({ rootPath: root, sourcePath, kind: "skill" });
  expect(report.renderResults).toEqual([]);
  expect(report.warnings.join("\n")).toContain("verbatim");
  expect(await readFile(join(report.targetPath, "SKILL.md"), "utf8")).toBe(skill);
});
