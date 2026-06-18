import type { SkillsetRenderResult } from "./render-result";
import type { OutputBackupRecord } from "./output-safety";

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
  | "restore"
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

export class SkillsetFeatureDiagnosticError extends Error {
  readonly code: string;
  readonly featureId: string;
  readonly path?: string;

  constructor(args: {
    readonly code: string;
    readonly featureId: string;
    readonly message: string;
    readonly path?: string;
  }) {
    super(args.message);
    this.name = "SkillsetFeatureDiagnosticError";
    this.code = args.code;
    this.featureId = args.featureId;
    if (args.path !== undefined) this.path = args.path;
  }
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
  /** Central manifest for backed-up originals created before overwrites or deletes. */
  readonly backupManifestPath?: string;
  /** Records for backed-up originals created during this write. */
  readonly backupRecords?: readonly OutputBackupRecord[];
  /** Short backup run id used in backup filenames and manifests. */
  readonly backupRunId?: string;
}

export interface SkillsetOperationResult<Data> {
  readonly data: Data;
  readonly diagnostics: readonly SkillsetDiagnostic[];
  readonly renderResults: readonly SkillsetRenderResult[];
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
