import { describe, expect, it } from "bun:test";

describe("@skillset/core", () => {
  it("is importable as a private workspace package", async () => {
    const core = await import("@skillset/core");

    expect(core.buildSkillsetResult).toBeFunction();
    expect(core.checkSkillsetResult).toBeFunction();
    expect(core.diffSkillset).toBeFunction();
    expect(core.diffSkillsetResult).toBeFunction();
  });
});
