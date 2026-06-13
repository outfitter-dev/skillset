import { describe, expect, it } from "bun:test";

import {
  FEATURE_STATUS_VALUES,
  TARGET_SUPPORT_STATUS_VALUES,
  assertFeatureIdsUnique,
  defineFeatureRegistry,
  getSkillsetFeature,
  listSkillsetFeatures,
  listSkillsetFeaturesByTarget,
  type SkillsetFeatureEntry,
} from "../feature-registry";

describe("feature registry", () => {
  it("sorts entries, looks up by id, and filters target-applicable features", () => {
    const registry = defineFeatureRegistry([
      feature({
        id: "project-instructions",
        targetSupport: {
          claude: { status: "native" },
          codex: { status: "native" },
        },
      }),
      feature({
        id: "plugin-bin",
        targetSupport: {
          claude: { status: "pass_through" },
          codex: { reason: "Codex plugins do not expose a plugin-local bin contract.", status: "unsupported" },
        },
      }),
      feature({
        id: "change-state",
        kind: "change-management",
        targetSupport: {
          claude: { status: "not_applicable" },
          codex: { status: "not_applicable" },
        },
      }),
    ]);

    expect(listSkillsetFeatures(registry).map((entry) => entry.id)).toEqual([
      "change-state",
      "plugin-bin",
      "project-instructions",
    ]);
    expect(getSkillsetFeature("plugin-bin", registry)?.targetSupport.claude.status).toBe("pass_through");
    expect(getSkillsetFeature("missing", registry)).toBeUndefined();
    expect(listSkillsetFeaturesByTarget("claude", registry).map((entry) => entry.id)).toEqual([
      "plugin-bin",
      "project-instructions",
    ]);
    expect(listSkillsetFeaturesByTarget("codex", registry).map((entry) => entry.id)).toEqual([
      "plugin-bin",
      "project-instructions",
    ]);
  });

  it("rejects duplicate ids and unknown vocabulary", () => {
    const duplicate = feature({ id: "same" });

    expect(() => assertFeatureIdsUnique([duplicate, duplicate])).toThrow("duplicate feature registry id same");
    expect(() =>
      defineFeatureRegistry([
        feature({ id: "bad-status", status: "invented" as SkillsetFeatureEntry["status"] }),
      ])
    ).toThrow("unknown feature registry status invented");
    expect(() =>
      defineFeatureRegistry([
        feature({
          id: "bad-target-status",
          targetSupport: {
            claude: { status: "native" },
            codex: { status: "magical" as SkillsetFeatureEntry["targetSupport"]["codex"]["status"] },
          },
        }),
      ])
    ).toThrow("unknown target support status magical");
  });

  it("requires reasons for unsupported and lossy target states", () => {
    expect(() =>
      defineFeatureRegistry([
        feature({
          id: "unsupported-without-reason",
          targetSupport: {
            claude: { status: "native" },
            codex: { status: "unsupported" },
          },
        }),
      ])
    ).toThrow("unsupported support requires a reason");

    expect(() =>
      defineFeatureRegistry([
        feature({
          id: "lossy-without-reason",
          targetSupport: {
            claude: { status: "lossy" },
            codex: { status: "native" },
          },
        }),
      ])
    ).toThrow("lossy support requires a reason");
  });

  it("pins the status vocabularies", () => {
    expect(FEATURE_STATUS_VALUES).toEqual([
      "deferred",
      "future",
      "implemented",
      "planned",
      "reserved",
      "unsupported",
    ]);
    expect(TARGET_SUPPORT_STATUS_VALUES).toEqual([
      "degraded",
      "externally_managed",
      "future",
      "lossy",
      "metadata_only",
      "native",
      "not_applicable",
      "pass_through",
      "planned",
      "transformed",
      "unsupported",
    ]);
  });
});

function feature(overrides: Partial<SkillsetFeatureEntry> & { readonly id: string }): SkillsetFeatureEntry {
  return {
    docs: ["docs/features/README.md"],
    evidence: [{ kind: "test", ref: "packages/core/src/__tests__/feature-registry.test.ts" }],
    kind: "source",
    loweringOwner: "packages/core/src/render.ts",
    sourceShape: ".skillset/**",
    status: "implemented",
    summary: `${overrides.id} summary.`,
    targetSupport: {
      claude: { status: "native" },
      codex: { status: "native" },
    },
    title: overrides.id,
    validationOwner: "packages/core/src/resolver.ts",
    ...overrides,
  };
}
