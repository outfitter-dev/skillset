export type LintSeverity = "error" | "warn";

export interface LintGuidance {
  readonly summary: string;
  readonly steps?: readonly string[];
  readonly docs?: readonly string[];
}

export interface LintDiagnostic {
  readonly rule: string;
  readonly code?: string;
  readonly severity: LintSeverity;
  readonly message: string;
  readonly path: string;
  readonly line?: number;
  readonly guidance?: LintGuidance;
}

/**
 * Minimal lint subject shape. SET-56/57 grow this as rules migrate in.
 */
export interface LintSubject {
  readonly kind: "skill";
  readonly path: string;
  readonly frontmatter: Record<string, unknown>;
  readonly body: string;
  readonly files: readonly string[];
}

export interface LintRule {
  readonly name: string;
  readonly severity: LintSeverity;
  readonly description: string;
  readonly check: (subject: LintSubject) => readonly LintDiagnostic[];
}
