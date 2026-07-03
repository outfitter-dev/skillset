import { describe, expect, test } from "bun:test";
import type {
  AdapterConformanceCoverageReport,
  AdapterConformanceReport,
  FeatureRegistryDriftReport,
} from "@skillset/core";

import {
  formatWorkbenchDiagnostic,
  workbenchDiagnosticsFromAdapterConformanceReport,
  workbenchDiagnosticsFromAdapterCoverageReport,
  workbenchDiagnosticsFromFeatureRegistryDriftReport,
} from "../index";

describe("workbench compatibility diagnostics", () => {
  test("maps adapter conformance issues into provider errors", () => {
    const report = {
      issues: [
        {
          code: "reason-mismatch",
          expected: ["degraded"],
          featureId: "dependencies",
          message: "plugin.alpha.feature:dependencies reason does not match registry support reason",
          observed: ["degraded"],
          sourceUnit: "plugin.alpha.feature:dependencies",
          target: "codex",
        },
      ],
      ok: false,
    } satisfies AdapterConformanceReport;

    const [diagnostic] = workbenchDiagnosticsFromAdapterConformanceReport(report, {
      locationPath: "fixtures/kitchen-sink",
    });

    expect(formatWorkbenchDiagnostic(diagnostic!)).toBe(
      "fixtures/kitchen-sink: error: compat/reason-mismatch: codex dependencies: plugin.alpha.feature:dependencies reason does not match registry support reason"
    );
    expect(diagnostic).toMatchObject({
      featureId: "dependencies",
      help: [
        "Source unit: plugin.alpha.feature:dependencies",
        "Expected: degraded",
        "Observed: degraded",
      ],
      scope: "provider",
      severity: "error",
      subject: {
        id: "dependencies:codex",
        kind: "provider-compatibility",
        path: "plugin.alpha.feature:dependencies",
      },
    });
  });

  test("maps adapter coverage gaps into strict provider warnings", () => {
    const report = {
      entries: [],
      gaps: [
        {
          coverage: "missing_fixture",
          featureId: "tools-policy",
          featureStatus: "implemented",
          fixtureRefs: [],
          supportStatus: "transformed",
          target: "codex",
          title: "Tools Policy",
        },
        {
          coverage: "stale_fixture",
          featureId: "deleted-feature",
          fixtureRefs: ["fixtures/deleted"],
          reason: "feature id is not present in registry",
          target: "claude",
        },
      ],
      ok: false,
    } satisfies AdapterConformanceCoverageReport;

    const diagnostics = workbenchDiagnosticsFromAdapterCoverageReport(report);

    expect(diagnostics.map(formatWorkbenchDiagnostic)).toEqual([
      "warning: compat/coverage/missing_fixture: codex tools-policy: missing_fixture",
      "warning: compat/coverage/stale_fixture: claude deleted-feature: stale_fixture",
    ]);
    expect(diagnostics.map((diagnostic) => diagnostic.ruleLevel)).toEqual(["strict", "strict"]);
    expect(diagnostics[0]?.help).toEqual([
      "Feature: Tools Policy",
      "Support: transformed",
    ]);
    expect(diagnostics[1]?.help).toEqual([
      "Reason: feature id is not present in registry",
      "Fixtures: fixtures/deleted",
    ]);
  });

  test("maps feature registry drift into workspace errors", () => {
    const report = {
      checkedFeatures: 1,
      issues: [
        {
          code: "missing-doc-ref",
          featureId: "hooks",
          field: "docs[0]",
          message: "hooks docs[0] points to missing doc ref docs/features/hooks.md",
          ref: "docs/features/hooks.md",
        },
      ],
      ok: false,
    } satisfies FeatureRegistryDriftReport;

    const [diagnostic] = workbenchDiagnosticsFromFeatureRegistryDriftReport(report, {
      locationPath: "docs/features/feature-registry.md",
    });

    expect(formatWorkbenchDiagnostic(diagnostic!)).toBe(
      "docs/features/feature-registry.md: error: compat/feature-registry/missing-doc-ref: hooks docs[0] points to missing doc ref docs/features/hooks.md"
    );
    expect(diagnostic).toMatchObject({
      featureId: "hooks",
      help: [
        "Field: docs[0]",
        "Ref: docs/features/hooks.md",
      ],
      scope: "workspace",
      severity: "error",
      subject: {
        id: "hooks",
        kind: "feature-registry",
      },
    });
  });
});
