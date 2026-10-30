import { expect, test } from "bun:test";
import { join } from "node:path";
import { createTestFixtureRoot } from "../../../../scripts/test-helpers/fixture-root";
import { targetNames } from "@skillset/core/internal/targets";
import { importSource, ImportBatchError } from "../import";

test("native field candidates consult the crosswalk without borrowing canonical invocation judgments", async () => {
  const root = await createTestFixtureRoot("skillset-import-capability-");
  const sourcePath = join(root, "original");
  await Bun.write(join(sourcePath, "SKILL.md"), "---\nname: demo\ndescription: Demo.\ndisable-model-invocation: true\nallowed-tools: PrivateTool\nuser-invocable: false\n---\nBody.\n");
  const report = await importSource({ rootPath: root, sourcePath, kind: "skill", provider: "claude" });
  const assessments = report.capabilityAssessments ?? [];
  expect(assessments).toHaveLength(3 * targetNames().length);
  const invocation = assessments.find((entry) => entry.construct === "native-skill-frontmatter" && entry.source.pointer === "/claude/frontmatter/disable-model-invocation" && entry.candidateTarget === "codex");
  expect(invocation).toMatchObject({ sourceProvider: "claude", capabilityId: "skill-invocation", featureId: "skill-invocation-policy", fidelity: "unknown", eligibility: "scope-mismatch" });
  expect(invocation?.judgmentScope).toContain("implicit_invocation");
  expect(invocation?.authorityHash).toMatch(/^sha256:/);
  expect(assessments.filter((entry) => entry.source.pointer === "/claude/frontmatter/allowed-tools").every((entry) => entry.eligibility === "no-capability")).toBe(true);
  expect(JSON.stringify(assessments)).not.toContain("PrivateTool");
  expect(report.frontmatterFindings?.every((flag) => flag.evidence.some((item) => item.summary.includes("Candidate target:")))).toBe(true);
});

test("capability assessments survive retained partial import receipts", async () => {
  const { persistImportReceipt } = await import("../operation-receipt");
  const { readReportBundle } = await import("@skillset/core/internal/report-store");
  const root = await createTestFixtureRoot("skillset-capability-receipt-");
  const sourcePath = join(root, "original");
  await Bun.write(join(sourcePath, "SKILL.md"), "---\nname: demo\ndescription: Demo.\ndisable-model-invocation: true\n---\nBody.\n");
  try {
    await importSource({ rootPath: root, sourcePath, kind: "skill", provider: "claude", testHooks: { beforeBaselineSeed: async () => { throw new Error("injected"); } } });
    throw new Error("expected failure");
  } catch (error) {
    if (!(error instanceof ImportBatchError)) throw error;
    const entries = error.imports.flatMap((entry) => entry.capabilityAssessments ?? []);
    expect(entries).toHaveLength(targetNames().length);
    const receipt = await persistImportReceipt({ failed: true, imports: error.imports, rootPath: root, kind: "skill", provider: "claude" });
    const stored = await readReportBundle(receipt.id);
    expect(stored.report).toHaveProperty("payload.capabilityAssessments", entries);
    expect(stored.markdown).toContain("scope-mismatch");
  }
});

test("adoption receipts and durable flags retain candidate scope evidence without implying target selection", async () => {
  const { adoptSkillset, renderAdoptReportMarkdown } = await import("../adopt");
  const { persistAdoptionReceipt } = await import("../operation-receipt");
  const { readReportBundle } = await import("@skillset/core/internal/report-store");
  const { readMigrationState } = await import("@skillset/core/internal/migration-state");
  const { readFile } = await import("node:fs/promises");
  const outputs = [];
  for (let index = 0; index < 2; index++) {
    const root = await createTestFixtureRoot("skillset-capability-adopt-");
    await Bun.write(join(root, "skillset.yaml"), "compile:\n  targets: [claude]\n");
    const original = "---\nname: demo\ndescription: Demo.\ndisable-model-invocation: true\n---\nBody.\n";
    await Bun.write(join(root, ".claude/skills/demo/SKILL.md"), original);
    const report = await adoptSkillset(root, { write: true });
    expect(report.ok).toBe(true);
    const entries = report.imports.flatMap((entry) => entry.capabilityAssessments ?? []);
    expect(entries).toHaveLength(targetNames().length);
    expect(entries.some((entry) => entry.candidateTarget === "codex")).toBe(true);
    expect(renderAdoptReportMarkdown(report, { rootPath: root })).toContain("do not imply that a target is selected");
    const receipt = await persistAdoptionReceipt(report);
    expect((await readReportBundle(receipt.id)).report).toHaveProperty("payload.capabilityAssessments", entries);
    expect((await readMigrationState(root)).state.flags.some((flag) => flag.evidence.some((item) => item.summary.includes("Candidate target: codex")))).toBe(true);
    expect(await readFile(join(root, ".claude/skills/demo/SKILL.md"), "utf8")).toBe(original);
    outputs.push(entries);
  }
  expect(outputs[0]).toEqual(outputs[1]);
});

test("native hook runtime and MCP observations query their own capabilities without command values", async () => {
  const { readFile } = await import("node:fs/promises");
  const root = await createTestFixtureRoot("skillset-runtime-capability-");
  const sourcePath = join(root, "original");
  await Bun.write(join(sourcePath, ".claude-plugin/plugin.json"), '{"name":"demo","description":"Demo."}');
  const hooks = JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: "command", command: "echo private-command-value" }] }] } });
  await Bun.write(join(sourcePath, "hooks/hooks.json"), hooks);
  await Bun.write(join(sourcePath, ".mcp.json"), JSON.stringify({ mcpServers: { demo: { command: "node", args: ["${CLAUDE_PLUGIN_ROOT}/scripts/server.js"] } } }));
  await Bun.write(join(sourcePath, "scripts/server.js"), "export {};\n");
  const report = await importSource({ rootPath: root, sourcePath, kind: "plugin", provider: "claude" });
  const entries = report.capabilityAssessments ?? [];
  expect(entries.some((entry) => entry.construct === "native-hook-runtime" && entry.capabilityId === "native-hooks" && entry.candidateTarget === "claude" && entry.eligibility === "scope-mismatch")).toBe(true);
  expect(entries.some((entry) => entry.construct === "mcp-conversion" && entry.capabilityId === "plugin-mcp" && entry.eligibility === "no-judgment")).toBe(true);
  expect(JSON.stringify(entries)).not.toContain("private-command");
  expect(await readFile(join(sourcePath, "hooks/hooks.json"), "utf8")).toBe(hooks);
  expect(await readFile(join(report.targetPath, "_claude/hooks/hooks.json"), "utf8")).toBe(hooks);
});


test("candidate receipt locations use decoded pointer credential redaction", async () => {
  const { persistImportReceipt } = await import("../operation-receipt");
  const { readReportBundle } = await import("@skillset/core/internal/report-store");
  const root = await createTestFixtureRoot("skillset-capability-redaction-");
  const sourcePath = join(root, "original");
  const synthetic = "ghp_" + "A".repeat(36);
  await Bun.write(join(sourcePath, "SKILL.md"), `---\nname: demo\ndescription: Demo.\n${JSON.stringify(`${synthetic}/x~y`)}: private-value\n---\nBody.\n`);
  const report = await importSource({ rootPath: root, sourcePath, kind: "skill", provider: "claude" });
  const receipt = await persistImportReceipt({ failed: false, imports: [report], rootPath: root, kind: "skill", provider: "claude" });
  const stored = await readReportBundle(receipt.id);
  expect(JSON.stringify(stored.report)).not.toContain(synthetic);
  expect(stored.markdown).not.toContain(synthetic);
  expect(stored.markdown).not.toContain("private-value");
  expect(stored.markdown).toContain("[REDACTED]");
});
