import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { initializeTestGitRepository } from "../../../../scripts/test-helpers/git-remote";
import { join } from "node:path";
import { readMigrationState, MIGRATION_STATE_PATH, hashMigrationState } from "@skillset/core/internal/migration-state";
import { readReportBundle } from "@skillset/core/internal/report-store";
import { createTestFixtureRoot } from "../../../../scripts/test-helpers/fixture-root";
import { adoptSkillset, renderAdoptReportMarkdown } from "../adopt";
import { persistAdoptionReceipt } from "../operation-receipt";

const hookPath = ".skillset/plugins/native-hooks/_claude/hooks/hooks.json";

test("adoption persists native hook runtime review as a sidecar without changing JSON", async () => {
  const root = await createTestFixtureRoot("skillset-adopt-hook-findings-");
  await Bun.write(join(root, "skillset.yaml"), "compile:\n  targets: [claude]\n");
  await Bun.write(join(root, ".claude-plugin/plugin.json"), '{"name":"native-hooks"}\n');
  const original = JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: "command", command: '"${CLAUDE_PLUGIN_ROOT}"/check.sh' }] }] } }, null, 2) + "\n";
  await Bun.write(join(root, "hooks/hooks.json"), original);
  await Bun.write(join(root, "skills/demo/SKILL.md"), "---\nname: demo\ndescription: Demo.\n---\n\nAsk @alice.\n");
  const report = await adoptSkillset(root, { write: true });
  expect(report.ok).toBe(true);
  const { state } = await readMigrationState(root);
  const hookFlags = state.flags.filter((flag) => flag.source.path === hookPath);
  expect(hookFlags).toHaveLength(1);
  expect(hookFlags[0]).toMatchObject({
    code: "adopt.native-hook-runtime-unverified", state: "open", disposition: "ambiguous",
    placement: { kind: "sidecar" }, origin: { path: "hooks/hooks.json" },
  });
  expect(hookFlags[0]?.evidence.some((item) => item.summary.includes("claude"))).toBe(true);
  expect(state.flags.some((flag) => flag.placement.kind === "inline")).toBe(true);
  expect(hashMigrationState({ ...state, flags: report.migrationFlags ?? [] })).toBe(hashMigrationState(state));
  expect(report.writtenPaths).toContain(MIGRATION_STATE_PATH);
  expect(await readFile(join(root, hookPath), "utf8")).toBe(original);
  expect(await readFile(join(root, "hooks/hooks.json"), "utf8")).toBe(original);
  expect(renderAdoptReportMarkdown(report, { rootPath: root })).toContain("adopt.native-hook-runtime-unverified");
  const receipt = await persistAdoptionReceipt(report);
  const stored = await readReportBundle(receipt.id);
  expect(stored.report).toMatchObject({ payload: { migrationFlagCodes: expect.arrayContaining(["adopt.native-hook-runtime-unverified"]) } });
});

test("malformed hook event shapes still reach the durable review ledger", async () => {
  const root = await createTestFixtureRoot("skillset-adopt-hook-shape-");
  await Bun.write(join(root, "skillset.yaml"), "compile:\n  targets: [claude]\n");
  await Bun.write(join(root, ".claude-plugin/plugin.json"), '{"name":"native-hooks"}\n');
  const original = '{"hooks":{"SessionStart":"not an array"}}\n';
  await Bun.write(join(root, "hooks/hooks.json"), original);
  const report = await adoptSkillset(root, { write: true });
  const flags = (await readMigrationState(root)).state.flags;
  expect(flags).toHaveLength(1);
  expect(flags[0]).toMatchObject({ code: "adopt.native-hook-unsupported", disposition: "lossy-unsupported", placement: { kind: "sidecar" } });
  expect(report.migrationFlags?.map((flag) => flag.id)).toEqual(flags.map((flag) => flag.id));
  expect(await readFile(join(root, hookPath), "utf8")).toBe(original);
});

for (const git of [false, true]) {
  test(`merged plugin hook findings retain the actual per-file origin (git=${git})`, async () => {
    const disposableRoot = await createTestFixtureRoot("skillset-hook-origin-");
    const root = join(disposableRoot, "repo");
    await Bun.write(join(root, "skillset.yaml"), "compile:\n  targets: [claude, codex]\n");
    const manifest = JSON.stringify({ name: "native-hooks", description: "Native hooks", version: "1.0.0" });
    const skill = "---\nname: demo\ndescription: Demo.\n---\n\nShared skill.\n";
    for (const provider of ["claude", "codex"]) {
      await Bun.write(join(root, `plugins/${provider}-demo/.${provider}-plugin/plugin.json`), manifest);
      await Bun.write(join(root, `plugins/${provider}-demo/skills/demo/SKILL.md`), skill);
    }
    const original = '{"hooks":{"SessionStart":[{"hooks":[{"type":"command","command":"echo original"}]}]}}\n';
    const originPath = "plugins/claude-demo/hooks/hooks.json";
    await Bun.write(join(root, originPath), original);
    await Bun.write(join(root, "plugins/codex-demo/hooks/hooks.json"), original);
    if (git) await initializeTestGitRepository(root, { disposableRoot });
    const report = await adoptSkillset(root, { write: true });
    expect(report.acquisition).toEqual({ input: root, kind: "path", rootPath: root });
    expect(report.surveyDiagnostics).toEqual([]);
    expect(report.imports[0]?.candidate.plugin?.relation).toBe("equivalent");
    const flags = (await readMigrationState(report.rootPath)).state.flags;
    expect(flags.length).toBeGreaterThan(0);
    expect(flags.every((flag) => flag.origin?.path === originPath)).toBe(true);
    expect(await readFile(join(root, originPath), "utf8")).toBe(original);
  });
}

for (const original of ['{"hooks":{"SessionStart":[]}}\n', '{ broken JSON']) {
  test(`unclassified native hooks retain provider review and receipt codes: ${original}`, async () => {
    const root = await createTestFixtureRoot("skillset-adopt-hook-unclassified-");
    await Bun.write(join(root, "skillset.yaml"), "compile:\n  targets: [claude]\n");
    await Bun.write(join(root, ".claude-plugin/plugin.json"), '{"name":"native-hooks"}\n');
    await Bun.write(join(root, "hooks/hooks.json"), original);
    const report = await adoptSkillset(root, { write: true });
    const flags = (await readMigrationState(root)).state.flags;
    if (original === "{ broken JSON") {
      expect(report.renderResults.some((result) => result.diagnostics?.some((diagnostic) => diagnostic.code === "import-native-hook-lift-unclassified"))).toBe(true);
    }
    expect(flags).toHaveLength(1);
    expect(flags[0]).toMatchObject({ code: "adopt.native-hook-lift-unclassified", disposition: "ambiguous" });
    expect(flags[0]?.evidence.some((item) => item.summary.includes("Assessment target: claude"))).toBe(true);
    expect(await readFile(join(root, hookPath), "utf8")).toBe(original);
    expect(renderAdoptReportMarkdown(report, { rootPath: root })).toContain("adopt.native-hook-lift-unclassified");
    const receipt = await persistAdoptionReceipt(report);
    const stored = await readReportBundle(receipt.id);
    expect(stored.report).toMatchObject({ payload: { migrationFlagCodes: ["adopt.native-hook-lift-unclassified"] } });
  });
}
