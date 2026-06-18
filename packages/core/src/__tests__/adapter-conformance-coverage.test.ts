import { describe, expect, it } from "bun:test";

import {
  createAdapterConformanceCoverageReport,
  defineFeatureRegistry,
  formatAdapterConformanceCoverageReport,
  type AdapterConformanceCase,
  type SkillsetFeatureEntry,
  type SkillsetFeatureRegistry,
} from "@skillset/core";

describe("adapter conformance coverage", () => {
  it("reports stable JSON rows and gap rows from registry plus fixture refs", () => {
    const report = createAdapterConformanceCoverageReport([
      {
        featureId: "covered-feature",
        fixtureRef: "packages/core/src/__tests__/adapter-conformance.test.ts",
        sourceUnit: "skill:demo",
        target: "claude",
      },
      {
        featureId: "unsupported-feature",
        fixtureRef: "packages/core/src/__tests__/adapter-conformance.test.ts",
        sourceUnit: "plugin.demo.feature:bin",
        target: "claude",
      },
      {
        featureId: "deleted-feature",
        fixtureRef: "packages/core/src/__tests__/deleted-conformance.test.ts",
        sourceUnit: "deleted:demo",
        target: "claude",
      },
      {
        featureId: "future-feature",
        fixtureRef: "packages/core/src/__tests__/adapter-conformance.test.ts",
        sourceUnit: "future:demo",
        target: "codex",
      },
    ], registry());

    expect(report.ok).toBe(false);
    expect(JSON.stringify(report, null, 2)).toBe(`{
  "entries": [
    {
      "coverage": "covered",
      "featureId": "covered-feature",
      "featureStatus": "implemented",
      "fixtureRefs": [
        "packages/core/src/__tests__/adapter-conformance.test.ts"
      ],
      "supportStatus": "native",
      "target": "claude",
      "title": "Covered Feature"
    },
    {
      "coverage": "missing_fixture",
      "featureId": "covered-feature",
      "featureStatus": "implemented",
      "fixtureRefs": [],
      "supportStatus": "transformed",
      "target": "codex",
      "title": "Covered Feature"
    },
    {
      "coverage": "stale_fixture",
      "featureId": "deleted-feature",
      "fixtureRefs": [
        "packages/core/src/__tests__/deleted-conformance.test.ts"
      ],
      "reason": "feature id is not present in registry",
      "target": "claude"
    },
    {
      "coverage": "future",
      "featureId": "future-feature",
      "featureStatus": "future",
      "fixtureRefs": [],
      "supportStatus": "future",
      "target": "claude",
      "title": "Future Feature"
    },
    {
      "coverage": "invalid_fixture",
      "featureId": "future-feature",
      "featureStatus": "future",
      "fixtureRefs": [
        "packages/core/src/__tests__/adapter-conformance.test.ts"
      ],
      "supportStatus": "not_applicable",
      "target": "codex",
      "title": "Future Feature"
    },
    {
      "coverage": "covered",
      "featureId": "unsupported-feature",
      "featureStatus": "implemented",
      "fixtureRefs": [
        "packages/core/src/__tests__/adapter-conformance.test.ts"
      ],
      "reason": "Claude does not support this demo feature.",
      "supportStatus": "unsupported",
      "target": "claude",
      "title": "Unsupported Feature"
    },
    {
      "coverage": "unsupported_without_fixture",
      "featureId": "unsupported-feature",
      "featureStatus": "implemented",
      "fixtureRefs": [],
      "reason": "Codex does not support this demo feature.",
      "supportStatus": "unsupported",
      "target": "codex",
      "title": "Unsupported Feature"
    }
  ],
  "gaps": [
    {
      "coverage": "missing_fixture",
      "featureId": "covered-feature",
      "featureStatus": "implemented",
      "fixtureRefs": [],
      "supportStatus": "transformed",
      "target": "codex",
      "title": "Covered Feature"
    },
    {
      "coverage": "stale_fixture",
      "featureId": "deleted-feature",
      "fixtureRefs": [
        "packages/core/src/__tests__/deleted-conformance.test.ts"
      ],
      "reason": "feature id is not present in registry",
      "target": "claude"
    },
    {
      "coverage": "invalid_fixture",
      "featureId": "future-feature",
      "featureStatus": "future",
      "fixtureRefs": [
        "packages/core/src/__tests__/adapter-conformance.test.ts"
      ],
      "supportStatus": "not_applicable",
      "target": "codex",
      "title": "Future Feature"
    },
    {
      "coverage": "unsupported_without_fixture",
      "featureId": "unsupported-feature",
      "featureStatus": "implemented",
      "fixtureRefs": [],
      "reason": "Codex does not support this demo feature.",
      "supportStatus": "unsupported",
      "target": "codex",
      "title": "Unsupported Feature"
    }
  ],
  "ok": false
}`);
  });

  it("formats the gap list without coverage percentages", () => {
    const report = createAdapterConformanceCoverageReport([], registry());

    expect(formatAdapterConformanceCoverageReport(report)).toContain(
      "adapter conformance coverage found 4 gaps"
    );
    expect(formatAdapterConformanceCoverageReport(report)).not.toContain("%");
  });

  it("can summarize representative current-registry conformance fixture refs", () => {
    const cases = [
      { featureId: "standalone-skills", fixtureRef: "packages/core/src/__tests__/adapter-conformance.test.ts", target: "claude" },
      { featureId: "plugin-skills", fixtureRef: "packages/core/src/__tests__/adapter-conformance.test.ts", target: "codex" },
      { featureId: "plugin-bin", fixtureRef: "packages/core/src/__tests__/adapter-conformance.test.ts", target: "codex" },
    ] satisfies readonly AdapterConformanceCase[];

    const report = createAdapterConformanceCoverageReport(cases);
    const covered = report.entries.filter((entry) => entry.coverage === "covered");

    expect(covered.map((entry) => `${entry.featureId}:${entry.target}`)).toContain("plugin-bin:codex");
    expect(report.gaps.some((entry) => entry.coverage === "unsupported_without_fixture")).toBe(true);
  });
});

function registry(): SkillsetFeatureRegistry {
  return defineFeatureRegistry([
    feature({
      id: "covered-feature",
      status: "implemented",
      title: "Covered Feature",
      targetSupport: {
        claude: { status: "native" },
        codex: { status: "transformed" },
      },
    }),
    feature({
      id: "future-feature",
      status: "future",
      title: "Future Feature",
      targetSupport: {
        claude: { status: "future" },
        codex: { status: "not_applicable" },
      },
    }),
    feature({
      id: "unsupported-feature",
      status: "implemented",
      title: "Unsupported Feature",
      targetSupport: {
        claude: { reason: "Claude does not support this demo feature.", status: "unsupported" },
        codex: { reason: "Codex does not support this demo feature.", status: "unsupported" },
      },
    }),
  ]);
}

function feature(
  overrides: Pick<SkillsetFeatureEntry, "id" | "status" | "targetSupport" | "title">
): SkillsetFeatureEntry {
  const evidence = [{ kind: "test" as const, ref: "packages/core/src/__tests__/adapter-conformance-coverage.test.ts" }];
  return {
    docs: ["docs/features/feature-registry.md"],
    evidence,
    kind: "source",
    renderOwner: "packages/core/src/__tests__/adapter-conformance-coverage.test.ts",
    sourceShape: "test fixture",
    summary: `${overrides.title} summary.`,
    targetSupport: {
      claude: { evidence, ...overrides.targetSupport.claude },
      codex: { evidence, ...overrides.targetSupport.codex },
    },
    validationOwner: "packages/core/src/__tests__/adapter-conformance-coverage.test.ts",
    id: overrides.id,
    status: overrides.status,
    title: overrides.title,
  };
}
