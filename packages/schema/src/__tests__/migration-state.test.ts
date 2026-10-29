import { describe, expect, it } from "bun:test";
import Ajv2020 from "ajv/dist/2020";

import {
  MIGRATION_STATE_SCHEMA_VERSION,
  migrationStateContract,
  skillsetSchemaExamples,
  validateMigrationState,
} from "../index";

const fingerprints = { content: `sha256:${"a".repeat(64)}`, context: `sha256:${"b".repeat(64)}` };
const flag = {
  id: "adopt-0123456789abcdef01234567",
  code: "ambiguous-document-reference",
  severity: "error",
  state: "open",
  disposition: "ambiguous",
  message: "Decide whether this names the literal file or a guidance role.",
  source: { path: ".skillset/skills/demo/SKILL.md", line: 5 },
  origin: { path: ".claude/skills/demo/SKILL.md", line: 5 },
  fingerprints,
  placement: { kind: "sidecar", reason: "Inside a fenced example." },
  evidence: [{ summary: "Literal filename has no explicit role declaration.", reference: "fixture:literal-guidance" }],
  relatedReportIds: ["6ba7b810-9dad-4c8e-8a46-7e8dd6f4e6d5"],
  history: [],
};
const state = (entry: unknown = flag) => ({ schemaVersion: MIGRATION_STATE_SCHEMA_VERSION, flags: [entry] });
const resolution = { reason: "Keep this provider-native operation.", at: "2026-10-29T18:00:00.000Z" };

function parity(value: unknown, valid: boolean): void {
  const ajv = new Ajv2020({ strict: false });
  expect(ajv.compile(migrationStateContract.schema)(value)).toBe(valid);
  expect(validateMigrationState(value).ok).toBe(valid);
}

describe("migration state shared contract", () => {
  it("validates sidecar and inline flags independently of severity and review state", () => {
    parity(state(), true);
    parity(state({ ...flag, severity: "info", placement: { kind: "inline", label: "fix", line: 4 } }), true);
    parity(state({ ...flag, state: "accepted", resolution }), true);
    parity(state({ ...flag, state: "resolved", resolution, history: [{ ...resolution, state: "accepted" }] }), true);
    parity({ schemaVersion: MIGRATION_STATE_SCHEMA_VERSION, flags: [] }, true);
  });

  it("rejects malformed structure and decisions without a reason", () => {
    const invalid = [
      null,
      { schemaVersion: "skillset.migration-state@2", flags: [] },
      { schemaVersion: MIGRATION_STATE_SCHEMA_VERSION, flags: [], surprise: true },
      state({ ...flag, id: "5" }),
      state({ ...flag, severity: "todo" }),
      state({ ...flag, state: "fix" }),
      state({ ...flag, disposition: "looks-portable" }),
      state({ ...flag, source: { path: "../outside.md" } }),
      state({ ...flag, source: { path: "/absolute.md" } }),
      state({ ...flag, source: { path: "C:\\outside.md" } }),
      state({ ...flag, source: { path: "a/./b.md" } }),
      state({ ...flag, source: { path: "a.md", line: 0 } }),
      state({ ...flag, fingerprints: { content: "same", context: "same" } }),
      state({ ...flag, fingerprints: { content: fingerprints.content } }),
      state({ ...flag, placement: { kind: "inline", label: "todo" } }),
      state({ ...flag, placement: { kind: "sidecar" } }),
      state({ ...flag, relatedReportIds: ["not-a-report"] }),
      state({ ...flag, state: "accepted" }),
      state({ ...flag, state: "resolved", resolution: { ...resolution, reason: "" } }),
      state({ ...flag, resolution }),
      state({ ...flag, history: [{ state: "accepted", at: resolution.at }] }),
    ];
    for (const value of invalid) parity(value, false);
  });

  it("keeps generated maximal evidence valid through the same runtime contract", () => {
    const example = skillsetSchemaExamples.find((item) => item.id === "migration-state");
    expect(example).toBeDefined();
    parity(example?.value, true);
    const result = validateMigrationState(state({ ...flag, severity: "todo" }));
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ path: "$.flags[0].severity" }));
  });

  it("requires real Gregorian UTC timestamps for current and historical decisions", () => {
    for (const at of ["2024-02-29T23:59:59.999Z", "2000-02-29T00:00:00.000Z", "0000-02-29T00:00:00.000Z", "2026-04-30T12:30:45.123Z"]) {
      parity(state({ ...flag, state: "accepted", resolution: { ...resolution, at }, history: [{ ...resolution, state: "resolved", at }] }), true);
    }
    for (const at of ["2023-02-29T00:00:00.000Z", "1900-02-29T00:00:00.000Z", "2026-04-31T00:00:00.000Z", "2026-00-01T00:00:00.000Z", "2026-13-01T00:00:00.000Z", "2026-01-00T00:00:00.000Z", "2026-01-01T24:00:00.000Z", "2026-01-01T00:60:00.000Z", "2026-01-01T00:00:60.000Z", "2026-01-01T00:00:00Z", "2026-01-01T00:00:00.000+00:00"]) {
      parity(state({ ...flag, state: "accepted", resolution: { ...resolution, at } }), false);
      parity(state({ ...flag, history: [{ ...resolution, state: "resolved", at }] }), false);
    }
  });
});
