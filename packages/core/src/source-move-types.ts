import type {
  SourceRenameGeneratedOperation,
  SourceRenameOperation,
} from "./source-rename-types";
import type { WorkspaceTransactionOptions } from "./workspace-transaction";

export interface SourceMoveRequest {
  readonly from: string;
  readonly rootPath: string;
  readonly to: string;
}

export type SourceMoveKind = "plugin-to-workspace" | "workspace-to-plugin";

export interface SourceMovePlan {
  readonly from: string;
  readonly generatedOperations: readonly SourceRenameGeneratedOperation[];
  readonly kind: SourceMoveKind;
  readonly notices: readonly string[];
  readonly operations: readonly SourceRenameOperation[];
  readonly planHash: string;
  readonly to: string;
  readonly warnings: readonly string[];
}

export interface SourceMoveApplyRequest extends SourceMoveRequest {
  readonly expectedPlanHash: string;
  /** Deterministic fault injection for transaction tests. @internal */
  readonly transactionOptions?: WorkspaceTransactionOptions;
}

export interface SourceMoveReport extends SourceMovePlan {
  readonly applied: true;
  readonly writtenPaths: readonly string[];
}

export class SourceMovePlanError extends Error {
  public constructor(message: string) {
    super(`skillset: source move ${message}`);
    this.name = "SourceMovePlanError";
  }
}
