import type { SourceLifecycleLedgerEvent } from "./source-lifecycle-ledger";
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

export interface SourceMutationCopyOperation {
  readonly from: string;
  readonly kind: "copy";
  readonly to: string;
}

export interface SourceMutationDeleteOperation {
  readonly kind: "delete";
  readonly path: string;
}

/** A source-document replacement to apply after its enclosing move, if any. */
export interface SourceRenameUpdateOperation {
  readonly content: string;
  readonly kind: "update";
  readonly path: string;
}

/**
 * A lifecycle event appended to the change ledger. The record's id and
 * timestamp are derived from the ledger bytes read when the transaction
 * applies, so the plan names only the event.
 */
export interface SourceLedgerAppendOperation {
  readonly event: SourceLifecycleLedgerEvent;
  readonly kind: "append";
  readonly path: string;
}

export type SourceRenameOperation =
  | SourceLedgerAppendOperation
  | SourceRenameMoveOperation
  | SourceRenameUpdateOperation;

export type SourceMutationOperation =
  | SourceMutationCopyOperation
  | SourceMutationDeleteOperation
  | SourceRenameOperation;

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
