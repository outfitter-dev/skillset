import type { WorkspaceTransactionOptions } from "./workspace-transaction";
import type { GeneratedFileMode } from "./types";

export interface SourceRenameRequest {
  readonly from: string;
  readonly rootPath: string;
  readonly to: string;
}

export type SourceRenameKind = "file" | "plugin-skill" | "standalone-skill";

export interface SourceRenameMoveOperation {
  readonly from: string;
  readonly kind: "move";
  readonly to: string;
}

/** A source-document replacement to apply after its enclosing move, if any. */
export interface SourceRenameUpdateOperation {
  readonly content: string;
  readonly kind: "update";
  readonly path: string;
}

export type SourceRenameOperation =
  | SourceRenameMoveOperation
  | SourceRenameUpdateOperation;

export type SourceRenameGeneratedOperation =
  | {
      readonly content: Uint8Array;
      readonly kind: "create" | "update";
      readonly mode: GeneratedFileMode;
      readonly path: string;
    }
  | {
      readonly kind: "delete";
      readonly path: string;
    };

export interface SourceRenamePlan {
  readonly from: string;
  readonly generatedOperations: readonly SourceRenameGeneratedOperation[];
  readonly kind: SourceRenameKind;
  readonly operations: readonly SourceRenameOperation[];
  readonly planHash: string;
  readonly to: string;
  readonly warnings: readonly string[];
}

export interface SourceRenameApplyRequest extends SourceRenameRequest {
  readonly expectedPlanHash: string;
  /** Deterministic fault injection for transaction tests. @internal */
  readonly transactionOptions?: WorkspaceTransactionOptions;
}

export interface SourceRenameReport extends SourceRenamePlan {
  readonly applied: true;
  readonly writtenPaths: readonly string[];
}

export class SourceRenamePlanError extends Error {
  public constructor(message: string) {
    super(`skillset: source rename ${message}`);
    this.name = "SourceRenamePlanError";
  }
}
