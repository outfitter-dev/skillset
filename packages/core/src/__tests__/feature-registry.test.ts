import { describe, expect, it } from "bun:test";

import {
  FEATURE_STATUS_VALUES,
  TARGET_SUPPORT_STATUS_VALUES,
  assertFeatureIdsUnique,
  defineFeatureRegistry,
  getSkillsetFeature,
  listSkillsetFeatures,
  listSkillsetFeaturesByTarget,
  type SkillsetFeatureEvidence,
  type SkillsetFeatureEntry,
} from "../feature-registry";

const SEEDED_FEATURE_IDS = [
  "changes",
  "dependencies",
  "future-companion-source-pointers",
  "plugin-agents",
  "plugin-apps",
  "plugin-assets",
  "plugin-bin",
  "plugin-commands",
  "plugin-hooks",
  "plugin-lsp-servers",
  "plugin-manifests",
  "plugin-mcp",
  "plugin-monitors",
  "plugin-output-styles",
  "plugin-readme",
  "plugin-scripts",
  "plugin-skills",
  "plugin-src",
  "plugin-themes",
  "project-agents",
  "project-instructions",
  "releases",
  "resources",
  "standalone-skills",
  "supports",
  "target-native-islands",
  "tool-intent",
  "workflows",
];

describe("feature registry", () => {
  it("ships the current feature seed in deterministic order with docs and evidence", () => {
    const features = listSkillsetFeatures();

    expect(features.map((entry) => entry.id)).toEqual(SEEDED_FEATURE_IDS);
    for (const feature of features) {
      expect(feature.docs.length).toBeGreaterThan(0);
      expect(feature.evidence.length).toBeGreaterThan(0);
      expect(feature.targetSupport.claude).toBeDefined();
      expect(feature.targetSupport.codex).toBeDefined();
      expect(feature.targetSupport.claude.evidence?.length ?? 0).toBeGreaterThan(0);
      expect(feature.targetSupport.codex.evidence?.length ?? 0).toBeGreaterThan(0);
      for (const support of [feature.targetSupport.claude, feature.targetSupport.codex]) {
        for (const evidence of support.evidence ?? []) {
          if (evidence.kind === "external-docs") expect(evidence.verifiedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        }
      }
    }
  });

  it("keeps current target support claims conservative", () => {
    expect(getSkillsetFeature("plugin-bin")?.targetSupport.codex).toEqual(expect.objectContaining({
      reason: "Codex plugins do not expose a documented plugin-local bin contract.",
      status: "unsupported",
    }));
    expect(getSkillsetFeature("dependencies")?.targetSupport.codex.status).toBe("degraded");
    expect(getSkillsetFeature("dependencies")?.targetSupport.codex.reason).toContain("Codex");
    expect(getSkillsetFeature("plugin-commands")?.targetSupport.codex.status).toBe("not_applicable");
    expect(getSkillsetFeature("plugin-assets")?.targetSupport.codex.status).toBe("pass_through");
    expect(getSkillsetFeature("supports")?.targetSupport.claude.status).toBe("metadata_only");
    expect(getSkillsetFeature("project-agents")?.targetSupport.codex.status).toBe("transformed");
    expect(listSkillsetFeaturesByTarget("claude").map((entry) => entry.id)).not.toContain("changes");
    expect(listSkillsetFeaturesByTarget("codex").map((entry) => entry.id)).not.toContain("workflows");
  });

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
          id: "degraded-without-reason",
          targetSupport: {
            claude: { status: "degraded" },
            codex: { status: "native" },
          },
        }),
      ])
    ).toThrow("degraded support requires a reason");

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
  const defaultEvidence: readonly SkillsetFeatureEvidence[] = [
    { kind: "test", ref: "packages/core/src/__tests__/feature-registry.test.ts" },
  ];
  const entry: SkillsetFeatureEntry = {
    docs: overrides.docs ?? ["docs/features/README.md"],
    evidence: overrides.evidence ?? defaultEvidence,
    id: overrides.id,
    kind: overrides.kind ?? "source",
    loweringOwner: overrides.loweringOwner ?? "packages/core/src/render.ts",
    sourceShape: overrides.sourceShape ?? ".skillset/**",
    status: overrides.status ?? "implemented",
    summary: overrides.summary ?? `${overrides.id} summary.`,
    targetSupport: overrides.targetSupport ?? {
      claude: { status: "native" },
      codex: { status: "native" },
    },
    title: overrides.title ?? overrides.id,
    validationOwner: overrides.validationOwner ?? "packages/core/src/resolver.ts",
  };
  return {
    ...entry,
    targetSupport: {
      claude: supportWithEvidence(entry.targetSupport.claude, entry.evidence),
      codex: supportWithEvidence(entry.targetSupport.codex, entry.evidence),
    },
  };
}

function supportWithEvidence(
  support: SkillsetFeatureEntry["targetSupport"]["claude"],
  evidence: SkillsetFeatureEntry["evidence"]
): SkillsetFeatureEntry["targetSupport"]["claude"] {
  if (support.evidence !== undefined && support.evidence.length > 0) return support;
  return { ...support, evidence };
}
