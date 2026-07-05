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

  it("non-error policies still block failed outcomes", () => {
    for (const policy of ["warn", "skip", "force"] as const) {
      expect(() => enforceRenderResultPolicy([outcome("failed")], policy)).toThrow(
        `compile.unsupportedDestination: ${policy}`
      );
    }
  });

  it("non-error policies allow lossy and unsupported outcomes", () => {
    for (const policy of ["warn", "skip", "force"] as const) {
      expect(() => enforceRenderResultPolicy([outcome("lossy"), outcome("unsupported")], policy)).not.toThrow();
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
