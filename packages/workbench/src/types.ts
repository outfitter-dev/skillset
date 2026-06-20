export type WorkbenchSeverity = "error" | "info" | "warning";

export type WorkbenchPresetId = "standard" | "strict";

export type WorkbenchRuleLevel = "standard" | "strict";

export type WorkbenchParseKind = "json" | "markdown" | "toml" | "unknown" | "yaml";

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
  readonly ruleLevel?: WorkbenchRuleLevel;
  readonly scope: WorkbenchScope;
}

export interface WorkbenchPreset {
  readonly description: string;
  readonly id: WorkbenchPresetId;
  readonly ruleLevels: readonly WorkbenchRuleLevel[];
  readonly scopes: readonly WorkbenchScope[];
}

export interface WorkbenchDiagnosticSelection {
  readonly preset?: WorkbenchPresetId;
  readonly ruleIds?: readonly string[];
  readonly scopes?: readonly WorkbenchScope[];
}

export interface WorkbenchDiagnostic {
  readonly featureId?: string;
  readonly fix?: WorkbenchFix;
  readonly help?: readonly string[];
  readonly location?: WorkbenchLocation;
  readonly message: string;
  readonly ruleId: string;
  readonly ruleLevel?: WorkbenchRuleLevel;
  readonly scope: WorkbenchScope;
  readonly severity: WorkbenchSeverity;
  readonly subject: WorkbenchSubject;
}

export interface WorkbenchMarkdownHeading {
  readonly depth: number;
  readonly line: number;
  readonly text: string;
}

export type WorkbenchParseResult =
  | WorkbenchJsonParseResult
  | WorkbenchMarkdownParseResult
  | WorkbenchTomlParseResult
  | WorkbenchUnknownParseResult
  | WorkbenchYamlParseResult;

export interface WorkbenchJsonParseResult {
  readonly data?: unknown;
  readonly diagnostics: readonly WorkbenchDiagnostic[];
  readonly kind: "json";
  readonly path: string;
}

export interface WorkbenchYamlParseResult {
  readonly data?: unknown;
  readonly diagnostics: readonly WorkbenchDiagnostic[];
  readonly kind: "yaml";
  readonly path: string;
}

export interface WorkbenchTomlParseResult {
  readonly data?: unknown;
  readonly diagnostics: readonly WorkbenchDiagnostic[];
  readonly kind: "toml";
  readonly path: string;
}

export interface WorkbenchMarkdownParseResult {
  readonly body?: string;
  readonly bodyStartLine?: number;
  readonly diagnostics: readonly WorkbenchDiagnostic[];
  readonly frontmatter?: Record<string, unknown>;
  readonly headings: readonly WorkbenchMarkdownHeading[];
  readonly kind: "markdown";
  readonly path: string;
}

export interface WorkbenchUnknownParseResult {
  readonly diagnostics: readonly WorkbenchDiagnostic[];
  readonly kind: "unknown";
  readonly path: string;
}

export interface WorkbenchRunResult {
  readonly diagnostics: readonly WorkbenchDiagnostic[];
  readonly errorCount: number;
  readonly infoCount: number;
  readonly ok: boolean;
  readonly warningCount: number;
}
