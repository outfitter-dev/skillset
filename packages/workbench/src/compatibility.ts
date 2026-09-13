import type {
  AdapterConformanceCoverageEntry,
  AdapterConformanceCoverageReport,
  AdapterConformanceIssue,
  AdapterConformanceReport,
  FeatureRegistryDriftIssue,
  FeatureRegistryDriftReport,
} from "@skillset/core";
import { adapterConformanceIdentityLabel } from "@skillset/core";

import { createWorkbenchDiagnostic, sortWorkbenchDiagnostics } from "./diagnostics";
import type {
  WorkbenchDiagnostic,
  WorkbenchLocation,
  WorkbenchRuleLevel,
  WorkbenchSeverity,
} from "./types";

export interface WorkbenchCompatibilityDiagnosticOptions {
  readonly locationPath?: string;
}

export function workbenchDiagnosticsFromAdapterConformanceReport(
  report: AdapterConformanceReport,
  options: WorkbenchCompatibilityDiagnosticOptions = {}
): readonly WorkbenchDiagnostic[] {
  return sortWorkbenchDiagnostics(report.issues.map((issue) =>
    adapterConformanceDiagnostic(issue, options)
  ));
}

export function workbenchDiagnosticsFromAdapterCoverageReport(
  report: AdapterConformanceCoverageReport,
  options: WorkbenchCompatibilityDiagnosticOptions = {}
): readonly WorkbenchDiagnostic[] {
  return sortWorkbenchDiagnostics(report.gaps.map((entry) =>
    adapterCoverageDiagnostic(entry, options)
  ));
}

export function workbenchDiagnosticsFromFeatureRegistryDriftReport(
  report: FeatureRegistryDriftReport,
  options: WorkbenchCompatibilityDiagnosticOptions = {}
): readonly WorkbenchDiagnostic[] {
  return sortWorkbenchDiagnostics(report.issues.map((issue) =>
    featureRegistryDriftDiagnostic(issue, options)
  ));
}

function adapterConformanceDiagnostic(
  issue: AdapterConformanceIssue,
  options: WorkbenchCompatibilityDiagnosticOptions
): WorkbenchDiagnostic {
  const identity = adapterConformanceIdentityLabel(issue);
  const standard = "standardProfile" in issue;
  const help = compactHelp([
    issue.sourceUnit === undefined ? undefined : `Source unit: ${issue.sourceUnit}`,
    issue.expected === undefined ? undefined : `Expected: ${issue.expected.join(", ")}`,
    issue.observed === undefined ? undefined : `Observed: ${issue.observed.join(", ")}`,
  ]);
  const diagnosticLocation = location(options);
  return createWorkbenchDiagnostic({
    featureId: issue.featureId,
    ...(help === undefined ? {} : { help }),
    ...(diagnosticLocation === undefined ? {} : { location: diagnosticLocation }),
    message: `${identity} ${issue.featureId}: ${issue.message}`,
    ruleId: `compat/${issue.code}`,
    scope: standard ? "workspace" : "provider",
    severity: "error",
    subject: {
      id: `${issue.featureId}:${identity}`,
      kind: standard ? "standard-compatibility" : "provider-compatibility",
      ...(issue.sourceUnit === undefined ? {} : { path: issue.sourceUnit }),
    },
  });
}

function adapterCoverageDiagnostic(
  entry: AdapterConformanceCoverageEntry,
  options: WorkbenchCompatibilityDiagnosticOptions
): WorkbenchDiagnostic {
  const identity = adapterConformanceIdentityLabel(entry);
  const standard = "standardProfile" in entry;
  const help = compactHelp([
    entry.title === undefined ? undefined : `Feature: ${entry.title}`,
    entry.supportStatus === undefined ? undefined : `Support: ${entry.supportStatus}`,
    entry.profileLifecycle === undefined ? undefined : `Profile lifecycle: ${entry.profileLifecycle}`,
    entry.evidenceRefs === undefined || entry.evidenceRefs.length === 0
      ? undefined
      : `Profile evidence: ${entry.evidenceRefs.join(", ")}`,
    entry.reason === undefined ? undefined : `Reason: ${entry.reason}`,
    entry.fixtureRefs.length === 0 ? undefined : `Fixtures: ${entry.fixtureRefs.join(", ")}`,
  ]);
  const diagnosticLocation = location(options);
  return createWorkbenchDiagnostic({
    featureId: entry.featureId,
    ...(help === undefined ? {} : { help }),
    ...(diagnosticLocation === undefined ? {} : { location: diagnosticLocation }),
    message: `${identity} ${entry.featureId}: ${entry.coverage}`,
    ruleId: `compat/coverage/${entry.coverage}`,
    ruleLevel: "strict",
    scope: standard ? "workspace" : "provider",
    severity: "warning",
    subject: {
      id: `${entry.featureId}:${identity}`,
      kind: standard ? "standard-coverage" : "provider-coverage",
    },
  });
}

function featureRegistryDriftDiagnostic(
  issue: FeatureRegistryDriftIssue,
  options: WorkbenchCompatibilityDiagnosticOptions
): WorkbenchDiagnostic {
  const help = compactHelp([
    `Field: ${issue.field}`,
    issue.ref === undefined ? undefined : `Ref: ${issue.ref}`,
  ]);
  const diagnosticLocation = location(options);
  return createWorkbenchDiagnostic({
    featureId: issue.featureId,
    ...(help === undefined ? {} : { help }),
    ...(diagnosticLocation === undefined ? {} : { location: diagnosticLocation }),
    message: issue.message,
    ruleId: `compat/feature-registry/${issue.code}`,
    scope: "workspace",
    severity: "error",
    subject: {
      id: issue.featureId,
      kind: "feature-registry",
    },
  });
}

function location(options: WorkbenchCompatibilityDiagnosticOptions): WorkbenchLocation | undefined {
  if (options.locationPath === undefined) return undefined;
  return { path: options.locationPath };
}

function compactHelp(values: readonly (string | undefined)[]): readonly string[] | undefined {
  const help = values.filter((value): value is string => value !== undefined);
  return help.length === 0 ? undefined : help;
}
