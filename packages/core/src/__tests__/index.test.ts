import { describe, expect, it } from "bun:test";

describe("@skillset/core", () => {
  it("is importable as a private workspace package", async () => {
    const core = await import("@skillset/core");

    expect(core.buildSkillsetResult).toBeFunction();
    expect(core.verifySkillsetResult).toBeFunction();
    expect(core.diffSkillset).toBeFunction();
    expect(core.diffSkillsetResult).toBeFunction();
    expect(core.readReportBundle).toBeFunction();
    for (const internalName of [
      "containsSensitiveReportContent",
      "createOperationReport",
      "createReportBundle",
      "importReportBundle",
      "reportKindRegistry",
      "resolveReportStoreRoot",
      "sanitizeAndValidateSkillsetReport",
      "serializeSkillsetReport",
    ]) {
      expect(core).not.toHaveProperty(internalName);
    }
  });
});
