import type { SourceMutationOperation } from "./source-rename-types";
import type { SourceRenameGeneratedOperation } from "./source-rename-types";
import type { WorkspaceTransactionOptions } from "./workspace-transaction";

interface SourceDraftMutationPlan {
  readonly draftSelector: string;
  readonly from: string;
  readonly generatedOperations: readonly SourceRenameGeneratedOperation[];
  readonly operations: readonly SourceMutationOperation[];
  readonly planHash: string;
  readonly removeEmptyParents?: boolean;
  readonly selector: string;
  readonly to: string;
  readonly warnings: readonly string[];
}

export interface SourceDraftRequest {
  readonly rootPath: string;
  readonly shippedPath: string;
}

export interface SourceDraftPlan extends SourceDraftMutationPlan {
  readonly action: "draft";
  readonly sourceHash: string;
}

export interface SourceDraftApplyRequest extends SourceDraftRequest {
  readonly expectedPlanHash: string;
  /** Deterministic fault injection for transaction tests. @internal */
  readonly transactionOptions?: WorkspaceTransactionOptions;
}

export interface SourceDraftReport extends SourceDraftPlan {
  readonly applied: true;
  readonly writtenPaths: readonly string[];
}

export interface SourcePromotionRequest {
  readonly draftPath: string;
  readonly rootPath: string;
}

export interface SourcePromotionPlan extends SourceDraftMutationPlan {
  readonly action: "promote";
  readonly baselineSourceHash?: string;
  readonly changedSinceDraft: boolean;
  readonly diff: readonly string[];
  readonly draftEventId?: string;
  readonly draftSourceHash: string;
  readonly kind: "paired" | "unpaired";
  readonly removeEmptyParents: true;
}

export interface SourcePromotionApplyRequest extends SourcePromotionRequest {
  readonly expectedPlanHash: string;
  /** Deterministic fault injection for transaction tests. @internal */
  readonly transactionOptions?: WorkspaceTransactionOptions;
}

export interface SourcePromotionReport extends SourcePromotionPlan {
  readonly applied: true;
  readonly writtenPaths: readonly string[];
}

export class SourceDraftPlanError extends Error {
  public constructor(message: string) {
    super(`skillset: source draft ${message}`);
    this.name = "SourceDraftPlanError";
  }
}

export class SourcePromotionPlanError extends Error {
  public constructor(message: string) {
    super(`skillset: source promote ${message}`);
    this.name = "SourcePromotionPlanError";
  }
}
