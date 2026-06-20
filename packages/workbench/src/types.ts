export type WorkbenchSeverity = "error" | "info" | "warning";

export type WorkbenchScope =
  | "generated"
  | "provider"
  | "release"
  | "resource"
  | "runtime"
  | "source"
  | "workspace";

export interface WorkbenchLocation {
  readonly column?: number;
  readonly endColumn?: number;
  readonly endLine?: number;
  readonly line?: number;
  readonly path: string;
}

export interface WorkbenchSubject {
  readonly id?: string;
  readonly kind: string;
  readonly path?: string;
}

export interface WorkbenchFix {
  readonly kind: "manual" | "suggestion";
  readonly message: string;
}

export interface WorkbenchRuleMetadata {
  readonly category?: string;
  readonly description: string;
  readonly docs?: readonly string[];
  readonly id: string;
  readonly scope: WorkbenchScope;
}

export interface WorkbenchDiagnostic {
  readonly fix?: WorkbenchFix;
  readonly help?: readonly string[];
  readonly location?: WorkbenchLocation;
  readonly message: string;
  readonly ruleId: string;
  readonly scope: WorkbenchScope;
  readonly severity: WorkbenchSeverity;
  readonly subject: WorkbenchSubject;
}

export interface WorkbenchRunResult {
  readonly diagnostics: readonly WorkbenchDiagnostic[];
  readonly errorCount: number;
  readonly infoCount: number;
  readonly ok: boolean;
  readonly warningCount: number;
}
