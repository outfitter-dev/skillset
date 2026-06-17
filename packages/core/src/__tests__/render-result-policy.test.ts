import { describe, expect, it } from "bun:test";

import { defineRenderResult } from "../render-result";
import { enforceRenderResultPolicy } from "../render-result-policy";
import type { SkillsetRenderResultStatus } from "../render-result";

describe("render result policy", () => {
  it("blocks failed, lossy, and unsupported outcomes", () => {
    for (const status of ["failed", "lossy", "unsupported"] satisfies readonly SkillsetRenderResultStatus[]) {
      expect(() => enforceRenderResultPolicy([outcome(status)], "error")).toThrow(
        "unsupported destination policy blocked 1 render result"
      );
    }
  });

  it("does not block degraded outcomes by default", () => {
    expect(() => enforceRenderResultPolicy([outcome("degraded")], "error")).not.toThrow();
  });
});

function outcome(status: SkillsetRenderResultStatus) {
  return defineRenderResult({
    featureId: "test-feature",
    reason: `${status} test reason`,
    sourcePath: ".skillset/test",
    sourceUnit: "skill:test",
    status,
    target: "codex",
  });
}
