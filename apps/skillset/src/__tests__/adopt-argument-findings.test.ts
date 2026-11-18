import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { inspectMigrationMarkers } from "@skillset/core/internal/migration-markers";
import { readMigrationState } from "@skillset/core/internal/migration-state";
import { parseMarkdown } from "@skillset/core/internal/yaml";
import { createTestFixtureRoot } from "../../../../scripts/test-helpers/fixture-root";
import { adoptSkillset, renderAdoptReportMarkdown } from "../adopt";

const sourcePath = ".skillset/skills/args/SKILL.md";
const body = "Run $ARGUMENTS, $ARGUMENTS[0], and $ARGUMENTS.limit.\n\nDocument `\\$ARGUMENTS` literally.\n\n```sh\nprintf '%s' \"$ARGUMENTS\"\n```\n";

test.each([".claude", ".agents", ".cursor"])("adoption preserves raw argument tokens from %s and records review evidence", async (directory) => {
  const root = await createTestFixtureRoot("skillset-adopt-raw-arguments-");
  const originalPath = join(root, directory, "skills/args/SKILL.md");
  const original = `---\nname: args\ndescription: Argument examples.\n---\n\n${body}`;
  await Bun.write(originalPath, original);
  const report = await adoptSkillset(root, { write: true });
  const { state } = await readMigrationState(root);
  const imported = await readFile(join(root, sourcePath), "utf8");
  const inspected = inspectMigrationMarkers({ content: imported, path: sourcePath, state });
  expect(inspected.diagnostics).toEqual([]);
  expect(parseMarkdown(inspected.content, sourcePath).body).toBe(parseMarkdown(original, originalPath).body);
  expect(await readFile(originalPath, "utf8")).toBe(original);
  const findings = state.flags.filter((flag) => flag.code === "adopt.ambiguous-dynamic-arguments");
  expect(findings).toHaveLength(5);
  expect(findings.every((flag) => flag.state === "open" && flag.disposition === "ambiguous")).toBe(true);
  expect(findings.every((flag) => flag.origin?.path === `${directory}/skills/args/SKILL.md` && flag.evidence.length > 0)).toBe(true);
  expect(findings.some((flag) => flag.placement.kind === "sidecar")).toBe(true);
  expect(report.migrationFlags?.filter((flag) => flag.code === "adopt.ambiguous-dynamic-arguments")).toHaveLength(5);
  expect(report.transformPreviews[0]?.matches.filter((match) => match.intent === "dynamic.arguments")).toHaveLength(5);
  const markdown = renderAdoptReportMarkdown(report, { rootPath: root });
  expect(markdown).toContain("`$ARGUMENTS` (dynamic.arguments");
  expect(markdown).not.toContain("forms are normalized");
});

test("adoption preserves explicit Skillset markers without hiding adjacent raw tokens", async () => {
  const root = await createTestFixtureRoot("skillset-adopt-explicit-arguments-");
  const authoredBody = "Keep {{$ARGUMENTS}} and {{$ARGUMENTS[0]}}.\n\nReview $ARGUMENTS[foo] and $ARGUMENTS.limit.\n";
  await Bun.write(join(root, ".claude/skills/args/SKILL.md"), `---\nname: args\ndescription: Mixed syntax.\n---\n\n${authoredBody}`);
  const report = await adoptSkillset(root, { write: true });
  const { state } = await readMigrationState(root);
  const imported = await readFile(join(root, sourcePath), "utf8");
  const inspected = inspectMigrationMarkers({ content: imported, path: sourcePath, state });
  expect(parseMarkdown(inspected.content, sourcePath).body).toBe(`\n${authoredBody}`);
  expect(report.transformPreviews[0]?.matches.map((match) => match.text)).toEqual(["$ARGUMENTS[foo]", "$ARGUMENTS.limit"]);
  expect(state.flags).toHaveLength(2);
  expect(imported).not.toContain("{{{{$ARGUMENTS");
});

test("shared plugin adoption preserves native argument tokens instead of changing shared runtime syntax", async () => {
  const root = await createTestFixtureRoot("skillset-adopt-plugin-arguments-");
  await Bun.write(join(root, "skillset.yaml"), "compile:\n  targets: [claude]\n");
  await Bun.write(join(root, ".claude-plugin/plugin.json"), '{"name":"native-args"}\n');
  const original = "---\nname: args\ndescription: Native arguments.\n---\n\nRun $ARGUMENTS[0].\n";
  const originalPath = join(root, "skills/args/SKILL.md");
  await Bun.write(originalPath, original);
  const report = await adoptSkillset(root, { write: true });
  expect(report.ok).toBe(true);
  expect(report.migrationFlags).toHaveLength(1);
  const importedPath = ".skillset/plugins/native-args/skills/args/SKILL.md";
  const imported = await readFile(join(root, importedPath), "utf8");
  const { state } = await readMigrationState(root);
  const inspected = inspectMigrationMarkers({ content: imported, path: importedPath, state });
  expect(parseMarkdown(inspected.content, importedPath).body).toBe(parseMarkdown(original, originalPath).body);
  expect(imported).not.toContain("{{$ARGUMENTS");
  expect(await readFile(originalPath, "utf8")).toBe(original);
});

test("already-authored canonical argument syntax stays available without inferred normalization", async () => {
  const root = await createTestFixtureRoot("skillset-adopt-canonical-arguments-");
  await Bun.write(join(root, "skillset.yaml"), "compile:\n  targets: [claude]\n");
  await Bun.write(join(root, ".claude/skills/args/SKILL.md"), "---\nname: args\ndescription: Explicit syntax.\n---\n\nUse {{$ARGUMENTS}} and {{$ARGUMENTS[0]}}.\n");
  const report = await adoptSkillset(root, { write: true });
  expect(report.ok).toBe(true);
  expect(report.migrationFlags).toEqual([]);
  expect(report.transformPreviews).toEqual([]);
  const imported = await readFile(join(root, sourcePath), "utf8");
  expect(imported).toContain("Use {{$ARGUMENTS}} and {{$ARGUMENTS[0]}}.");
  expect(imported).not.toContain("{{{{$ARGUMENTS");
});
