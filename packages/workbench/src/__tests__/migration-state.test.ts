import { expect, test } from "bun:test";
import { skillsetSchemaExamples, validateMigrationState } from "@skillset/schema";
import { checkWorkbenchSourceContract } from "../schema";

test("Workbench uses the shared migration ledger shape and structural diagnostics", () => {
  const value = structuredClone(skillsetSchemaExamples.find((item) => item.id === "migration-state")!.value);
  const path = ".skillset/adopt/state.json";
  expect(checkWorkbenchSourceContract({ content: JSON.stringify(value), kind: "migration-state", path })).toEqual([]);
  const bad = { ...value, schemaVersion: "unknown", flags: [{ id: "bad" }] };
  const shared = validateMigrationState(bad).diagnostics;
  const workbench = checkWorkbenchSourceContract({ content: JSON.stringify(bad, null, 2), kind: "migration-state", path });
  expect(workbench.map((item) => item.ruleId).sort()).toEqual(shared.map((item) => item.code).sort());
  expect(workbench.every((item) => item.location?.path === path && item.severity === "error")).toBe(true);
  expect(checkWorkbenchSourceContract({ content: "{invalid", kind: "migration-state", path })).not.toEqual([]);
});
