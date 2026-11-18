import { expect, test } from "bun:test";
import { hashMigrationState, planMigrationStateWrite, readMigrationState } from "@skillset/core";
import { MIGRATION_STATE_SCHEMA_VERSION, type MigrationState } from "@skillset/schema";
import { applyWorkspaceTransaction } from "@skillset/core/internal/workspace-transaction";
import { collectSourceInventory } from "../change-status";
import { contractFixture } from "./contract-test-helpers";

test("workspace review state never changes package-facing source inventory hashes", async () => {
  const root = await contractFixture({
    "skillset.yaml": "skillset:\n  name: migration-state\nclaude: true\ncodex: false\n",
    ".skillset/skills/demo/SKILL.md": "---\nname: demo\ndescription: Demo.\n---\n\nBody.\n",
  });
  const before = await collectSourceInventory(root);
  const state: MigrationState = { schemaVersion: MIGRATION_STATE_SCHEMA_VERSION, flags: [{
    id: "adopt-example", code: "ambiguous-reference", severity: "warning", state: "open", disposition: "ambiguous",
    message: "Review literal semantics.", source: { path: ".skillset/skills/demo/SKILL.md", line: 6 },
    fingerprints: { content: `sha256:${"a".repeat(64)}`, context: `sha256:${"b".repeat(64)}` },
    placement: { kind: "sidecar", reason: "No safe inline anchor." }, evidence: [{ summary: "Literal reference." }], relatedReportIds: [], history: [],
  }] };
  await applyWorkspaceTransaction(root, { writes: [planMigrationStateWrite(await readMigrationState(root), state)] });
  expect(await collectSourceInventory(root)).toEqual(before);
  const reviewed: MigrationState = { ...state, flags: state.flags.map((flag) => ({ ...flag, state: "accepted", resolution: { reason: "Intentionally literal.", at: "2026-10-29T18:00:00.000Z" } })) };
  await applyWorkspaceTransaction(root, { writes: [planMigrationStateWrite(await readMigrationState(root), reviewed)] });
  expect(hashMigrationState(reviewed)).not.toBe(hashMigrationState(state));
  expect(await collectSourceInventory(root)).toEqual(before);
});
