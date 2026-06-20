import { createWorkbenchDiagnostic } from "./diagnostics";
import type {
  WorkbenchDiagnostic,
  WorkbenchRuleLevel,
  WorkbenchScope,
  WorkbenchSubject,
} from "./types";

export interface WorkbenchLintGuidanceInput {
  readonly docs?: readonly string[];
  readonly steps?: readonly string[];
  readonly summary: string;
}

export interface WorkbenchLintDiagnosticInput {
  readonly code?: string;
  readonly featureId?: string;
  readonly guidance?: WorkbenchLintGuidanceInput;
  readonly line?: number;
  readonly message: string;
  readonly path: string;
  readonly rule: string;
  readonly severity: "error" | "warn";
}

export interface LintDiagnosticBridgeOptions {
  readonly ruleLevel?: WorkbenchRuleLevel;
  readonly rulePrefix?: string;
  readonly scope?: WorkbenchScope;
  readonly subject?: WorkbenchSubject;
}

export function workbenchDiagnosticFromLintDiagnostic(
  diagnostic: WorkbenchLintDiagnosticInput,
  options: LintDiagnosticBridgeOptions = {}
): WorkbenchDiagnostic {
  const help = lintHelp(diagnostic);
  return createWorkbenchDiagnostic({
    ...(diagnostic.featureId === undefined ? {} : { featureId: diagnostic.featureId }),
    ...(help.length === 0 ? {} : { help }),
    ...(diagnostic.line === undefined
      ? { location: { path: diagnostic.path } }
      : { location: { line: diagnostic.line, path: diagnostic.path } }),
    message: diagnostic.message,
    ruleId: lintRuleId(diagnostic, options.rulePrefix ?? "lint"),
    ...(options.ruleLevel === undefined ? {} : { ruleLevel: options.ruleLevel }),
    scope: options.scope ?? "source",
    severity: diagnostic.severity === "warn" ? "warning" : "error",
    subject: options.subject ?? { kind: "skill", path: diagnostic.path },
  });
}

export function workbenchDiagnosticsFromLintDiagnostics(
  diagnostics: readonly WorkbenchLintDiagnosticInput[],
  options: LintDiagnosticBridgeOptions = {}
): readonly WorkbenchDiagnostic[] {
  return diagnostics.map((diagnostic) =>
    workbenchDiagnosticFromLintDiagnostic(diagnostic, options)
  );
}

function lintHelp(diagnostic: WorkbenchLintDiagnosticInput): readonly string[] {
  if (diagnostic.guidance === undefined) return [];
  return [
    diagnostic.guidance.summary,
    ...(diagnostic.guidance.steps ?? []),
    ...(diagnostic.guidance.docs ?? []),
  ];
}

function lintRuleId(
  diagnostic: WorkbenchLintDiagnosticInput,
  rulePrefix: string
): string {
  const code = diagnostic.code === undefined ? diagnostic.rule : `${diagnostic.rule}:${diagnostic.code}`;
  return `${rulePrefix}/${code}`;
}
