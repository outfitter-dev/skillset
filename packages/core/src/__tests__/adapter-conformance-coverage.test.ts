import { describe, expect, it } from "bun:test";

import {
  createAdapterConformanceCoverageReport,
  defineFeatureRegistry,
  formatAdapterConformanceCoverageReport,
  type AdapterConformanceCase,
  type SkillsetFeatureEntry,
  type SkillsetFeatureRegistry,
  targetRecord,
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
    expect(report.entries.map((entry) => `${entry.featureId}:${entry.target}:${entry.coverage}:${entry.supportStatus ?? ""}`)).toEqual([
      "covered-feature:claude:covered:native",
      "covered-feature:codex:missing_fixture:transformed",
      "covered-feature:cursor:planned:planned",
      "deleted-feature:claude:stale_fixture:",
      "future-feature:claude:future:future",
      "future-feature:codex:invalid_fixture:not_applicable",
      "future-feature:cursor:future:planned",
      "unsupported-feature:claude:covered:unsupported",
      "unsupported-feature:codex:unsupported_without_fixture:unsupported",
      "unsupported-feature:cursor:planned:planned",
    ]);
    expect(report.gaps.map((entry) => `${entry.featureId}:${entry.target}:${entry.coverage}`)).toEqual([
      "covered-feature:codex:missing_fixture",
      "deleted-feature:claude:stale_fixture",
      "future-feature:codex:invalid_fixture",
      "unsupported-feature:codex:unsupported_without_fixture",
    ]);
    expect(report.gaps).toHaveLength(4);
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
  overrides: Pick<SkillsetFeatureEntry, "id" | "status" | "title"> & {
    readonly targetSupport: Partial<SkillsetFeatureEntry["targetSupport"]> & Pick<SkillsetFeatureEntry["targetSupport"], "claude" | "codex">;
  }
): SkillsetFeatureEntry {
  const evidence = [{ kind: "test" as const, ref: "packages/core/src/__tests__/adapter-conformance-coverage.test.ts" }];
  return {
    docs: ["docs/features/feature-registry.md"],
    evidence,
    kind: "source",
    renderOwner: "packages/core/src/__tests__/adapter-conformance-coverage.test.ts",
    sourceShape: "test fixture",
    summary: `${overrides.title} summary.`,
    targetSupport: targetRecord((target) => ({
      evidence,
      ...(overrides.targetSupport[target] ?? { reason: "Cursor fixture support is not asserted here.", status: "planned" }),
    })),
    validationOwner: "packages/core/src/__tests__/adapter-conformance-coverage.test.ts",
    id: overrides.id,
    status: overrides.status,
    title: overrides.title,
  };
}
