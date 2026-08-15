import { describe, expect, it } from "bun:test";

import { cliVersion } from "../cli-version";
import { createCliOperationReport } from "../report-producer";

describe("CLI operational report producer", () => {
  it("injects the exact live CLI version and owns UUID/time generation", () => {
    const report = createCliOperationReport({
      command: "check",
      exitCode: 0,
      workspace: { id: "skillset--local-12abcdef3456" },
    });
    expect(report.skillset.version).toBe(cliVersion);
    expect(report.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );
    expect(new Date(report.createdAt).toISOString()).toBe(report.createdAt);
  });
});
