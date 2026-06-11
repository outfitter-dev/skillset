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
 * Compiler-agnostic: adapters construct one subject per skill.
 */
export interface LintSubject {
  readonly kind: "skill";
  /** Repo-relative path to the skill's SKILL.md. */
  readonly path: string;
  /** Name of the directory containing SKILL.md. */
  readonly directoryName: string;
  readonly frontmatter: Record<string, unknown>;
  /** Markdown body with frontmatter stripped. */
  readonly body: string;
  /** Full original SKILL.md text, frontmatter included. */
  readonly raw: string;
  readonly files: readonly string[];
}

export interface LintRule {
  readonly name: string;
  readonly severity: LintSeverity;
  readonly description: string;
  readonly check: (subject: LintSubject) => readonly LintDiagnostic[];
}
