import { createWorkbenchDiagnostic, sortWorkbenchDiagnostics } from "./diagnostics";
import type {
  WorkbenchDiagnostic,
  WorkbenchLocation,
  WorkbenchRuleLevel,
  WorkbenchScope,
  WorkbenchSeverity,
  WorkbenchSubject,
} from "./types";

export interface WorkbenchAstGrepRule {
  readonly id: string;
  readonly message: string;
  readonly ruleLevel?: WorkbenchRuleLevel;
  readonly scope: WorkbenchScope;
  readonly severity: WorkbenchSeverity;
  readonly subjectKind: string;
}

export interface WorkbenchAstGrepMatch {
  readonly column?: number;
  readonly endColumn?: number;
  readonly endLine?: number;
  readonly file: string;
  readonly line?: number;
  readonly text?: string;
}

export interface WorkbenchAstGrepAvailability {
  readonly command?: string;
  readonly ok: boolean;
}

export async function probeAstGrepAvailability(
  command = "ast-grep"
): Promise<WorkbenchAstGrepAvailability> {
  try {
    const proc = Bun.spawn({
      cmd: [command, "--version"],
      stderr: "ignore",
      stdout: "ignore",
    });
    const exitCode = await proc.exited;
    return exitCode === 0 ? { command, ok: true } : { ok: false };
  } catch (error) {
    if (isMissingExecutableError(error)) return { ok: false };
    throw error;
  }
}

export function workbenchDiagnosticsFromAstGrepMatches(args: {
  readonly matches: readonly WorkbenchAstGrepMatch[];
  readonly rule: WorkbenchAstGrepRule;
}): readonly WorkbenchDiagnostic[] {
  return sortWorkbenchDiagnostics(args.matches.map((match) =>
    astGrepDiagnostic(match, args.rule)
  ));
}

function astGrepDiagnostic(
  match: WorkbenchAstGrepMatch,
  rule: WorkbenchAstGrepRule
): WorkbenchDiagnostic {
  const location = astGrepLocation(match);
  return createWorkbenchDiagnostic({
    ...(match.text === undefined ? {} : { help: [`Match: ${match.text}`] }),
    location,
    message: rule.message,
    ruleId: `ast-grep/${rule.id}`,
    ...(rule.ruleLevel === undefined ? {} : { ruleLevel: rule.ruleLevel }),
    scope: rule.scope,
    severity: rule.severity,
    subject: astGrepSubject(match, rule),
  });
}

function astGrepLocation(match: WorkbenchAstGrepMatch): WorkbenchLocation {
  return {
    ...(match.column === undefined ? {} : { column: match.column }),
    ...(match.endColumn === undefined ? {} : { endColumn: match.endColumn }),
    ...(match.endLine === undefined ? {} : { endLine: match.endLine }),
    ...(match.line === undefined ? {} : { line: match.line }),
    path: match.file,
  };
}

function astGrepSubject(
  match: WorkbenchAstGrepMatch,
  rule: WorkbenchAstGrepRule
): WorkbenchSubject {
  return { kind: rule.subjectKind, path: match.file };
}

function isMissingExecutableError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}
