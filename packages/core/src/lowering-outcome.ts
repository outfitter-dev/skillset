import type { TargetName } from "./types";

export type SkillsetLoweringOutcomeStatus =
  | "degraded_notice"
  | "emitted"
  | "intentionally_skipped"
  | "lossy"
  | "metadata_only"
  | "target_native"
  | "unsupported";

export interface SkillsetLoweringOutcome {
  readonly diagnosticIds?: readonly string[];
  readonly featureId: string;
  readonly message?: string;
  readonly outputPath?: string;
  readonly sourcePath?: string;
  readonly status: SkillsetLoweringOutcomeStatus;
  readonly target?: TargetName;
}
