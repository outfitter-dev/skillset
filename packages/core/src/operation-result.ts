import type { SkillsetLoweringOutcome } from "./lowering-outcome";

export type SkillsetOperation =
  | "adopt"
  | "build"
  | "change"
  | "check"
  | "ci"
  | "diff"
  | "doctor"
  | "explain"
  | "import"
  | "lint"
  | "list"
  | "release"
  | "test";

export type SkillsetDiagnosticSeverity = "error" | "info" | "warning";

export interface SkillsetDiagnostic {
  readonly code: string;
  readonly featureId?: string;
  readonly message: string;
  readonly outputPath?: string;
  readonly path?: string;
  readonly severity: SkillsetDiagnosticSeverity;
  readonly sourceUnit?: string;
  readonly target?: string;
}

export type SkillsetWriteMode = "dry-run" | "read" | "write";

export interface SkillsetWriteSummary {
  /** Actual filesystem paths changed by the operation. Read and dry-run operations return an empty list. */
  readonly mode: SkillsetWriteMode;
  readonly paths: readonly string[];
  /** Files or directories written by the operation. */
  readonly writtenPaths: readonly string[];
  /** Files or directories removed by the operation. */
  readonly deletedPaths: readonly string[];
}

export interface SkillsetOperationResult<Data> {
  readonly data: Data;
  readonly diagnostics: readonly SkillsetDiagnostic[];
  readonly loweringOutcomes: readonly SkillsetLoweringOutcome[];
  readonly ok: boolean;
  readonly operation: SkillsetOperation;
  readonly writes: SkillsetWriteSummary;
}

export function sourceWarningDiagnostic(message: string): SkillsetDiagnostic {
  return {
    code: "source-warning",
    message,
    severity: "warning",
  };
}
