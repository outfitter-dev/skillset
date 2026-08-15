import { describe, expect, it } from "bun:test";

import {
  REPORT_SCHEMA_VERSION,
  WORKSPACE_ID_MAX_LENGTH,
  isWorkspaceId,
  isSkillsetReport,
  reportContract,
  validateSkillsetReport,
} from "../index";

const report = {
  createdAt: "2026-08-14T21:30:00.000Z",
  id: "6ba7b810-9dad-4c8e-8a46-7e8dd6f4e6d5",
  kind: "operation",
  payload: {},
  result: { command: "check", exitCode: 0, ok: true },
  schemaVersion: REPORT_SCHEMA_VERSION,
  skillset: { version: "0.1.1" },
  workspace: {
    id: "skillset--local-12abcdef3456",
    name: "skillset",
    repository: {
      commit: "64618a42a23300b5cbbd308ed3fec0e64bae1a4e",
      dirty: false,
      identity: "github.com/outfitter-dev/skillset",
    },
  },
} as const;

describe("skillset.report@1", () => {
  it("defines and validates the closed operation receipt", () => {
    expect(reportContract.id).toBe("report");
    expect(reportContract.schema.$id).toBe(
      "https://raw.githubusercontent.com/outfitter-dev/skillset/main/docs/reference/schemas/0.1.0/report.schema.json"
    );
    expect(validateSkillsetReport(report)).toEqual({
      diagnostics: [],
      ok: true,
    });
    expect(isSkillsetReport(report)).toBe(true);
  });

  it("rejects unknown envelope and payload fields", () => {
    const envelope = validateSkillsetReport({ ...report, surprise: true });
    const payload = validateSkillsetReport({
      ...report,
      payload: { arbitrary: true },
    });
    expect(envelope.ok).toBe(false);
    expect(envelope.diagnostics.map((item) => item.code)).toContain(
      "schema/report/key"
    );
    expect(payload.ok).toBe(false);
    expect(payload.diagnostics.map((item) => item.code)).toContain(
      "schema/report/payload-key"
    );
  });

  it("rejects noncanonical identities, timestamps, and result states", () => {
    expect(
      validateSkillsetReport({ ...report, id: report.id.toUpperCase() }).ok
    ).toBe(false);
    expect(
      validateSkillsetReport({
        ...report,
        createdAt: "2026-02-30T00:00:00.000Z",
      }).ok
    ).toBe(false);
    expect(
      validateSkillsetReport({
        ...report,
        result: { command: "check", exitCode: 1, ok: true },
      }).ok
    ).toBe(false);
  });

  it("rejects local paths and credential-bearing repository identities", () => {
    for (const identity of [
      "/Users/mg/project",
      "https://user@example.com/org/repo?token=x",
      "C:\\Users\\mg\\project",
    ]) {
      expect(
        validateSkillsetReport({
          ...report,
          workspace: { ...report.workspace, repository: { identity } },
        }).ok
      ).toBe(false);
    }
  });

  it("shares one workspace identity length boundary", () => {
    const maximum = "a".repeat(WORKSPACE_ID_MAX_LENGTH);
    const overlong = `${maximum}a`;
    expect(isWorkspaceId(maximum)).toBe(true);
    expect(isWorkspaceId(overlong)).toBe(false);
    expect(
      validateSkillsetReport({
        ...report,
        workspace: { id: maximum },
      }).ok
    ).toBe(true);
    expect(
      validateSkillsetReport({
        ...report,
        workspace: { id: overlong },
      }).ok
    ).toBe(false);
  });
});
