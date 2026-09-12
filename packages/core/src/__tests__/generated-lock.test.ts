import { describe, expect, it } from "bun:test";

import { parseGeneratedLock } from "@skillset/core/internal/generated-lock";

const HISTORICAL_EMPTY_WORKSPACE_LOCK = {
  generatedBy: "skillset@0.1.0",
  items: [],
  outputRoot: ".",
  schemaVersion: 1,
  target: "workspace",
} as const;

describe("parseGeneratedLock", () => {
  it.each(["inspect", "require"] as const)(
    "reads a historical empty v1 workspace lock without selectedTargets in %s mode",
    (provenance) => {
      expect(
        parseGeneratedLock(HISTORICAL_EMPTY_WORKSPACE_LOCK, "skillset.lock", {
          provenance,
        })
      ).toMatchObject({
        generatedBy: "skillset@0.1.0",
        items: [],
        outputRoot: ".",
        schemaVersion: 1,
        selectedStandards: [],
        selectedTargets: [],
        target: "workspace",
      });
    }
  );

  it("still rejects a present non-array selectedTargets field", () => {
    expect(() =>
      parseGeneratedLock(
        {
          ...HISTORICAL_EMPTY_WORKSPACE_LOCK,
          selectedTargets: "codex",
        },
        "skillset.lock"
      )
    ).toThrow("selectedTargets must be an array");
  });
});
