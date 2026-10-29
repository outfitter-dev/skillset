import { expect, test } from "bun:test";
import { MIGRATION_STATE_SCHEMA_VERSION, type MigrationState } from "@skillset/schema";
import { parseWorkbenchDocument, checkWorkbenchSourceContract } from "../index";

const path = ".skillset/skills/demo/SKILL.md";
const content = "---\nname: demo\ndescription: Useful skill.\n---\n\n<!-- skillset:todo ::: #adopt-k3m9 [ambiguous-reference] Review { } in the evidence. -->\n# Demo\n\nFill { } here.\n";
const migrationState: MigrationState = { schemaVersion: MIGRATION_STATE_SCHEMA_VERSION, flags: [{
  id: "adopt-k3m9", code: "ambiguous-reference", severity: "warning", disposition: "ambiguous", state: "open",
  message: "Review { } in the evidence.", source: { path, line: 7 }, placement: { kind: "inline", label: "todo", line: 6 },
  fingerprints: { content: `sha256:${"a".repeat(64)}`, context: `sha256:${"b".repeat(64)}` },
  evidence: [{ summary: "Review the source." }], relatedReportIds: [], history: [],
}] };

test("marker-aware authoring diagnostics retain original positions and ignore marker prose", () => {
  const parsed = parseWorkbenchDocument({ content, path, migrationState });
  if (parsed.kind !== "markdown") throw new Error("Expected markdown");
  expect(parsed.body).not.toContain("skillset:todo");
  expect(parsed.headings).toEqual([{ depth: 1, line: 7, text: "Demo" }]);
  expect(parsed.diagnostics.filter((item) => item.ruleId === "markdown/template-placeholder").map((item) => item.location?.line)).toEqual([9]);
  expect(parsed.bodySourceLines).toEqual([5, 7, 8, 9, 10]);
  expect(checkWorkbenchSourceContract({ content, path, kind: "skill", migrationState }).filter((item) => item.ruleId === "markdown/template-placeholder").map((item) => item.location?.line)).toEqual([9]);
});

test("invalid ownership produces an authored-location diagnostic and preserves content", () => {
  const parsed = parseWorkbenchDocument({ content, path, migrationState: { ...migrationState, flags: [] } });
  if (parsed.kind !== "markdown") throw new Error("Expected markdown");
  expect(parsed.body).toContain("skillset:todo");
  expect(parsed.diagnostics).toContainEqual(expect.objectContaining({ ruleId: "migration/orphan-anchor", location: { path, line: 6 }, severity: "error" }));
});
