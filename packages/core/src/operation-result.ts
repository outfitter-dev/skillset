import { toLogicalDiagnosticPath } from "./path";
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
  | "test"
  | "verify";

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
    const normalized = withLogicalDiagnosticPaths({
      message: args.message,
      ...(args.path === undefined ? {} : { path: args.path }),
    });
    super(normalized.message);
    this.name = "SkillsetFeatureDiagnosticError";
    this.code = args.code;
    this.featureId = args.featureId;
    if (normalized.path !== undefined) this.path = normalized.path;
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
  /** Short backup run id used in backup manifests and restore commands. */
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
  return skillsetDiagnostic({
    code: "source-warning",
    message,
    severity: "warning",
  });
}

/**
 * Construct a Core operation diagnostic with portable logical path fields.
 *
 * Path fragments that already appear in `message` and match `path` or
 * `outputPath` are rewritten to the same POSIX spelling. Selectors, JSON
 * pointers, and filesystem operands must not be passed as those fields.
 */
export function skillsetDiagnostic(diagnostic: SkillsetDiagnostic): SkillsetDiagnostic {
  return withLogicalDiagnosticPaths(diagnostic);
}

function withLogicalDiagnosticPaths<
  T extends { readonly message: string; readonly outputPath?: string; readonly path?: string },
>(value: T): T {
  const path = value.path === undefined ? undefined : toLogicalDiagnosticPath(value.path);
  const outputPath =
    value.outputPath === undefined ? undefined : toLogicalDiagnosticPath(value.outputPath);
  let message = value.message;
  if (value.path !== undefined && path !== undefined && path !== value.path) {
    message = message.replaceAll(value.path, path);
  }
  if (value.outputPath !== undefined && outputPath !== undefined && outputPath !== value.outputPath) {
    message = message.replaceAll(value.outputPath, outputPath);
  }
  return {
    ...value,
    message,
    ...(outputPath === undefined ? {} : { outputPath }),
    ...(path === undefined ? {} : { path }),
  };
}
