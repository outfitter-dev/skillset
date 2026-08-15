import { compareStrings } from "./path";
import { SkillsetFeatureDiagnosticError } from "./operation-result";
import {
  SkillsetRenderResultError,
  type SkillsetRenderResult,
} from "./render-result";

export const SKILLSET_OUTPUT_STATES = [
  "no-output-baseline",
  "current",
  "source-ahead",
  "output-diverged",
  "blocked",
] as const;

export type SkillsetOutputState = (typeof SKILLSET_OUTPUT_STATES)[number];

export interface SkillsetOutputStateBlocker {
  readonly code: string;
  readonly path?: string;
}

export interface SkillsetOutputStateEvidence {
  readonly blockers: readonly SkillsetOutputStateBlocker[];
  readonly hasBaseline: boolean;
  readonly outputChanges: readonly string[];
  readonly sourceChanges: readonly string[];
  readonly state: SkillsetOutputState;
}

export interface ClassifySkillsetOutputStateInput {
  readonly blockers?: readonly SkillsetOutputStateBlocker[];
  readonly hasBaseline: boolean;
  readonly outputChanges?: readonly string[];
  readonly sourceChanges?: readonly string[];
}

/**
 * Classify generated-output evidence without applying command-specific
 * presentation, exit, recovery, or write policy.
 */
export function classifySkillsetOutputState(
  input: ClassifySkillsetOutputStateInput
): SkillsetOutputStateEvidence {
  const blockers = uniqueBlockers(input.blockers ?? []);
  const outputChanges = uniquePaths(input.outputChanges ?? []);
  const sourceChanges = uniquePaths(input.sourceChanges ?? []);
  const state: SkillsetOutputState =
    blockers.length > 0
      ? "blocked"
      : outputChanges.length > 0
        ? "output-diverged"
        : sourceChanges.length > 0
          ? input.hasBaseline
            ? "source-ahead"
            : "no-output-baseline"
          : input.hasBaseline
            ? "current"
            : "no-output-baseline";

  return {
    blockers,
    hasBaseline: input.hasBaseline,
    outputChanges,
    sourceChanges,
    state,
  };
}

/** Preserve derivation diagnostics as blocked classifier evidence. */
export function classifySkillsetOutputFailure(
  error: unknown,
  hasBaseline: boolean
): SkillsetOutputStateEvidence {
  const blockers: SkillsetOutputStateBlocker[] = [];
  if (error instanceof SkillsetFeatureDiagnosticError) {
    blockers.push({
      code: error.code,
      ...(error.path === undefined ? {} : { path: error.path }),
    });
  } else if (error instanceof SkillsetRenderResultError) {
    for (const result of error.renderResults) {
      if (!isBlockingRenderResult(result)) continue;
      if ((result.diagnostics?.length ?? 0) > 0) {
        for (const diagnostic of result.diagnostics ?? []) {
          blockers.push({
            code: diagnostic.code,
            ...(diagnostic.path === undefined && result.sourcePath === undefined
              ? {}
              : { path: diagnostic.path ?? result.sourcePath }),
          });
        }
      } else {
        blockers.push({
          code: result.status === "failed" ? "render-failed" : "unsupported-destination",
          ...(result.sourcePath === undefined ? {} : { path: result.sourcePath }),
        });
      }
    }
  }
  if (blockers.length === 0) blockers.push({ code: "output-derivation-failed" });
  return classifySkillsetOutputState({ blockers, hasBaseline });
}

function isBlockingRenderResult(result: SkillsetRenderResult): boolean {
  if (result.status === "failed" || result.status === "unsupported") return true;
  if (result.status !== "lossy") return false;
  return (
    result.policy !== "unsupported:force" &&
    result.policy !== "unsupported:skip" &&
    result.policy !== "unsupported:warn"
  );
}

function uniquePaths(paths: readonly string[]): readonly string[] {
  return [...new Set(paths)].sort(compareStrings);
}

function uniqueBlockers(
  blockers: readonly SkillsetOutputStateBlocker[]
): readonly SkillsetOutputStateBlocker[] {
  const keyed = new Map(
    blockers.map((blocker) => [
      `${blocker.code}\0${blocker.path ?? ""}`,
      blocker,
    ])
  );
  return [...keyed.values()].sort((left, right) =>
    compareStrings(
      `${left.code}\0${left.path ?? ""}`,
      `${right.code}\0${right.path ?? ""}`
    )
  );
}
