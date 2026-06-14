import { describe, expect, it } from "bun:test";

import { defineLoweringOutcome } from "../lowering-outcome";
import { enforceLoweringOutcomePolicy } from "../lowering-policy";
import type { SkillsetLoweringOutcomeStatus } from "../lowering-outcome";

describe("lowering outcome policy", () => {
  it("blocks failed, lossy, and unsupported outcomes", () => {
    for (const status of ["failed", "lossy", "unsupported"] satisfies readonly SkillsetLoweringOutcomeStatus[]) {
      expect(() => enforceLoweringOutcomePolicy([outcome(status)], "error")).toThrow(
        "lowering policy blocked 1 outcome"
      );
    }
  });

  it("does not block degraded outcomes by default", () => {
    expect(() => enforceLoweringOutcomePolicy([outcome("degraded")], "error")).not.toThrow();
  });
});

function outcome(status: SkillsetLoweringOutcomeStatus) {
  return defineLoweringOutcome({
    featureId: "test-feature",
    reason: `${status} test reason`,
    sourcePath: ".skillset/test",
    sourceUnit: "skill:test",
    status,
    target: "codex",
  });
}
