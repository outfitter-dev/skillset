import type {
  WorkbenchDiagnostic,
  WorkbenchLocation,
  WorkbenchRunResult,
  WorkbenchScope,
  WorkbenchSeverity,
  WorkbenchSubject,
} from "./types";

export function createWorkbenchDiagnostic(args: {
  readonly fix?: WorkbenchDiagnostic["fix"];
  readonly help?: readonly string[];
  readonly location?: WorkbenchLocation;
  readonly message: string;
  readonly ruleId: string;
  readonly scope: WorkbenchScope;
  readonly severity: WorkbenchSeverity;
  readonly subject: WorkbenchSubject;
}): WorkbenchDiagnostic {
  return {
    ...(args.location === undefined ? {} : { location: { ...args.location } }),
    ...(args.help === undefined ? {} : { help: [...args.help] }),
    ...(args.fix === undefined ? {} : { fix: { ...args.fix } }),
    message: args.message,
    ruleId: args.ruleId,
    scope: args.scope,
    severity: args.severity,
    subject: { ...args.subject },
  };
}

export function summarizeWorkbenchDiagnostics(
  diagnostics: readonly WorkbenchDiagnostic[]
): WorkbenchRunResult {
  let errorCount = 0;
  let infoCount = 0;
  let warningCount = 0;
  for (const diagnostic of diagnostics) {
    if (diagnostic.severity === "error") errorCount += 1;
    if (diagnostic.severity === "info") infoCount += 1;
    if (diagnostic.severity === "warning") warningCount += 1;
  }
  return {
    diagnostics: sortWorkbenchDiagnostics(diagnostics),
    errorCount,
    infoCount,
    ok: errorCount === 0,
    warningCount,
  };
}

export function sortWorkbenchDiagnostics(
  diagnostics: readonly WorkbenchDiagnostic[]
): readonly WorkbenchDiagnostic[] {
  return [...diagnostics].sort(compareWorkbenchDiagnostics);
}

export function compareWorkbenchDiagnostics(
  left: WorkbenchDiagnostic,
  right: WorkbenchDiagnostic
): number {
  return (
    compareStrings(locationPath(left), locationPath(right)) ||
    compareNumbers(locationLine(left), locationLine(right)) ||
    compareNumbers(locationColumn(left), locationColumn(right)) ||
    compareStrings(left.scope, right.scope) ||
    compareStrings(left.ruleId, right.ruleId) ||
    compareStrings(subjectKey(left.subject), subjectKey(right.subject)) ||
    compareStrings(left.message, right.message)
  );
}

export function formatWorkbenchDiagnostic(diagnostic: WorkbenchDiagnostic): string {
  const location = formatLocation(diagnostic.location);
  const prefix = location === "" ? "" : `${location}: `;
  return `${prefix}${diagnostic.severity}: ${diagnostic.ruleId}: ${diagnostic.message}`;
}

function formatLocation(location: WorkbenchLocation | undefined): string {
  if (location === undefined) return "";
  if (location.line === undefined) return location.path;
  if (location.column === undefined) return `${location.path}:${location.line}`;
  return `${location.path}:${location.line}:${location.column}`;
}

function locationPath(diagnostic: WorkbenchDiagnostic): string {
  return diagnostic.location?.path ?? diagnostic.subject.path ?? "";
}

function locationLine(diagnostic: WorkbenchDiagnostic): number {
  return diagnostic.location?.line ?? Number.POSITIVE_INFINITY;
}

function locationColumn(diagnostic: WorkbenchDiagnostic): number {
  return diagnostic.location?.column ?? Number.POSITIVE_INFINITY;
}

function subjectKey(subject: WorkbenchSubject): string {
  return `${subject.kind}:${subject.path ?? ""}:${subject.id ?? ""}`;
}

function compareStrings(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function compareNumbers(left: number, right: number): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}
