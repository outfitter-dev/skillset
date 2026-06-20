import type {
  LintIssue,
  SkillsetFeatureEntry,
  SkillsetRuntimeId,
  SkillsetRuntimeSupport,
} from "@skillset/core";

import { createWorkbenchDiagnostic, sortWorkbenchDiagnostics } from "./diagnostics";
import type {
  WorkbenchDiagnostic,
  WorkbenchLocation,
  WorkbenchSeverity,
} from "./types";

const RESOURCE_LINT_CODES = new Set([
  "resource-script-not-executable",
  "resource-undeclared-link",
  "skill-plugin-root-script",
]);

export interface WorkbenchResourceDiagnosticOptions {
  readonly rulePrefix?: string;
}

export interface WorkbenchRuntimeSupportDiagnosticOptions {
  readonly locationPath?: string;
  readonly runtimes?: readonly SkillsetRuntimeId[];
}

export function workbenchDiagnosticsFromResourceLintIssues(
  issues: readonly LintIssue[],
  options: WorkbenchResourceDiagnosticOptions = {}
): readonly WorkbenchDiagnostic[] {
  const rulePrefix = options.rulePrefix ?? "resource";
  const diagnostics = issues
    .filter(isResourceLintIssue)
    .map((issue) => resourceLintDiagnostic(issue, rulePrefix));
  return sortWorkbenchDiagnostics(diagnostics);
}

export function workbenchDiagnosticsFromRuntimeSupport(
  features: readonly SkillsetFeatureEntry[],
  options: WorkbenchRuntimeSupportDiagnosticOptions = {}
): readonly WorkbenchDiagnostic[] {
  const runtimeFilter = options.runtimes === undefined ? undefined : new Set(options.runtimes);
  const diagnostics: WorkbenchDiagnostic[] = [];

  for (const feature of features) {
    const supportEntries = Object.entries(feature.runtimeSupport ?? {}) as readonly [
      SkillsetRuntimeId,
      SkillsetRuntimeSupport,
    ][];

    for (const [runtime, support] of supportEntries) {
      if (runtimeFilter !== undefined && !runtimeFilter.has(runtime)) continue;
      diagnostics.push(...runtimeSupportDiagnostics(feature, runtime, support, options));
    }
  }

  return sortWorkbenchDiagnostics(diagnostics);
}

function isResourceLintIssue(issue: LintIssue): boolean {
  return issue.featureId === "resources" || RESOURCE_LINT_CODES.has(issue.code);
}

function resourceLintDiagnostic(
  issue: LintIssue,
  rulePrefix: string
): WorkbenchDiagnostic {
  return createWorkbenchDiagnostic({
    ...(issue.featureId === undefined ? {} : { featureId: issue.featureId }),
    location: { path: issue.path },
    message: issue.message,
    ruleId: `${rulePrefix}/${issue.code}`,
    scope: "resource",
    severity: lintSeverity(issue.severity),
    subject: { kind: "resource", path: issue.path },
  });
}

function runtimeSupportDiagnostics(
  feature: SkillsetFeatureEntry,
  runtime: SkillsetRuntimeId,
  support: SkillsetRuntimeSupport,
  options: WorkbenchRuntimeSupportDiagnosticOptions
): readonly WorkbenchDiagnostic[] {
  const diagnostics: WorkbenchDiagnostic[] = [];
  const diagnosticLocation = location(options);
  const help = runtimeHelp(support);

  for (const diagnostic of support.diagnostics ?? []) {
    diagnostics.push(createWorkbenchDiagnostic({
      featureId: feature.id,
      ...(help === undefined ? {} : { help }),
      ...(diagnosticLocation === undefined ? {} : { location: diagnosticLocation }),
      message: `${runtime} ${feature.id}: ${diagnostic}`,
      ruleId: `runtime/${support.status}`,
      scope: "runtime",
      severity: "warning",
      subject: {
        id: `${feature.id}:${runtime}`,
        kind: "runtime-support",
      },
    }));
  }

  return diagnostics;
}

function runtimeHelp(support: SkillsetRuntimeSupport): readonly string[] | undefined {
  const help = [
    support.mechanism === undefined ? undefined : `Mechanism: ${support.mechanism}`,
    support.reason === undefined ? undefined : `Reason: ${support.reason}`,
    ...(support.setup ?? []).map((step) => `Setup: ${step}`),
    ...(support.caveats ?? []).map((caveat) => `Caveat: ${caveat}`),
    ...(support.evidence ?? []).map((evidence) => {
      const suffix = evidence.note === undefined ? "" : ` (${evidence.note})`;
      return `Evidence: ${evidence.kind} ${evidence.ref}${suffix}`;
    }),
  ].filter((value): value is string => value !== undefined);

  return help.length === 0 ? undefined : help;
}

function lintSeverity(severity: LintIssue["severity"]): WorkbenchSeverity {
  return severity === "warn" ? "warning" : "error";
}

function location(options: WorkbenchRuntimeSupportDiagnosticOptions): WorkbenchLocation | undefined {
  if (options.locationPath === undefined) return undefined;
  return { path: options.locationPath };
}
