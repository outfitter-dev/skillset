import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { readMigrationState, MIGRATION_STATE_PATH, hashMigrationState } from "@skillset/core/internal/migration-state";
import { readReportBundle } from "@skillset/core/internal/report-store";
import { createTestFixtureRoot } from "../../../../scripts/test-helpers/fixture-root";
import { adoptSkillset, renderAdoptReportMarkdown } from "../adopt";
import { persistAdoptionReceipt } from "../operation-receipt";

const hookPath = ".skillset/plugins/native-hooks/hooks/hooks.json";

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
