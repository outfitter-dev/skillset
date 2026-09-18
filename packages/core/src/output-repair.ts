/**
 * Three-way generated-output drift verdicts (SET-599).
 *
 * The lock is a merge base. `outputHash` records what the previous build
 * produced, so drift is a three-way comparison between the file on disk, the
 * lock, and what a fresh render would produce — never a two-way diff.
 *
 * | file vs lock | render vs lock | verdict         | action     |
 * | ------------ | -------------- | --------------- | ---------- |
 * | same         | same           | `clean`         | none       |
 * | same         | differs        | `source-ahead`  | regenerate |
 * | differs      | same           | `output-edited` | preserve   |
 * | differs      | differs        | `diverged`      | refuse     |
 *
 * When the lock yields no trustworthy verdict at all the result is
 * `lock-untrusted`, which is deliberately not `output-edited`: the fault is in
 * the lock, not the output, and saying otherwise sends a reader off to port an
 * edit that does not exist.
 *
 * A managed path the current source no longer produces is `output-obsolete`
 * and will be removed — unless it was hand-edited, in which case deleting it
 * would lose the edit just as surely as overwriting it would.
 *
 * A managed path that is absent from disk is `output-missing`: no edit can be
 * lost by rewriting it, so it always restores. A path whose bytes already equal
 * the render is `clean` whatever the lock says, because writing it would change
 * nothing and so nothing is at stake. That short-circuit matters: `outputHash`
 * is recorded per lock *item* — a group of files — so one edited file drags
 * every untouched sibling into the item's drift evidence.
 *
 * Modification times are deliberately not an input. A rebase or checkout
 * rewrites mtimes across the tree, so in exactly the situation where drift
 * matters most every file looks equally fresh. Content hashes have no such
 * failure mode and the lock already stores them.
 */

import { compareStrings } from "./path";

export const SKILLSET_REPAIR_VERDICTS = [
  "clean",
  "output-missing",
  "source-ahead",
  "output-edited",
  "output-obsolete",
  "lock-untrusted",
  "diverged",
] as const;

export type SkillsetRepairVerdict = (typeof SKILLSET_REPAIR_VERDICTS)[number];

export const SKILLSET_REPAIR_ACTIONS = [
  "none",
  "restore",
  "regenerate",
  "remove",
  "preserve",
  "refuse",
] as const;

export type SkillsetRepairAction = (typeof SKILLSET_REPAIR_ACTIONS)[number];

export interface SkillsetRepairPathVerdict {
  readonly action: SkillsetRepairAction;
  readonly outputPath: string;
  readonly verdict: SkillsetRepairVerdict;
}

export interface ClassifyRepairPathInput {
  /** Explicit confirmation that a hand-edited output may be overwritten. */
  readonly discardEdits?: boolean;
  /** The file on disk matches the `outputHash` recorded by the lock. */
  readonly fileMatchesLock: boolean;
  readonly filePresent: boolean;
  /**
   * The lock yields a trustworthy verdict for this path. False when the lock
   * records no hash for it, or when a sibling file in the same lock item is
   * absent so the item hash cannot be recomputed.
   */
  readonly lockComparable?: boolean;
  readonly outputPath: string;
  /** The current source still produces this path. Defaults to true. */
  readonly rendered?: boolean;
  /** A fresh render matches the file currently on disk. */
  readonly renderMatchesFile: boolean;
  /** A fresh render matches the `outputHash` recorded by the lock. */
  readonly renderMatchesLock: boolean;
}

/** Classify one managed output path against the lock and a fresh render. */
export function classifyRepairPath(
  input: ClassifyRepairPathInput
): SkillsetRepairPathVerdict {
  const { outputPath } = input;
  const preserveEdit: SkillsetRepairPathVerdict = {
    action: input.discardEdits === true ? "regenerate" : "preserve",
    outputPath,
    verdict: "output-edited",
  };
  if (input.rendered === false) {
    // The lock still claims it but source no longer produces it.
    if (!input.filePresent) {
      return { action: "none", outputPath, verdict: "clean" };
    }
    if (input.lockComparable === false) {
      return { action: "preserve", outputPath, verdict: "lock-untrusted" };
    }
    return input.fileMatchesLock
      ? { action: "remove", outputPath, verdict: "output-obsolete" }
      : preserveEdit;
  }
  if (!input.filePresent) {
    return { action: "restore", outputPath, verdict: "output-missing" };
  }
  if (input.renderMatchesFile) {
    return { action: "none", outputPath, verdict: "clean" };
  }
  // Every case below has a write pending, so the lock decides who moved.
  if (input.lockComparable === false) {
    // No lock verdict is available. A repair never discards an edit it cannot
    // rule out, but it also must not claim the output was hand-edited when the
    // evidence it would need to say so is the very thing that is missing.
    return { action: "preserve", outputPath, verdict: "lock-untrusted" };
  }
  if (input.fileMatchesLock) {
    return { action: "regenerate", outputPath, verdict: "source-ahead" };
  }
  return input.renderMatchesLock
    ? preserveEdit
    : { action: "refuse", outputPath, verdict: "diverged" };
}

export interface SkillsetRepairPlan {
  /** Paths whose lock records no verdict this repair can rely on. */
  readonly lockUntrusted: readonly string[];
  /** Paths a repair refuses to touch because source and output both moved. */
  readonly refused: readonly string[];
  /** Hand-edited paths a repair preserves rather than silently discarding. */
  readonly preserved: readonly string[];
  readonly verdicts: readonly SkillsetRepairPathVerdict[];
  /** No path in scope needs a human decision, so the repair may write. */
  readonly writable: boolean;
}

/** Fold per-path verdicts into the decision a repair build acts on. */
export function planOutputRepair(
  verdicts: readonly SkillsetRepairPathVerdict[]
): SkillsetRepairPlan {
  const ordered = [...verdicts].sort((left, right) =>
    compareStrings(left.outputPath, right.outputPath)
  );
  const refused = ordered
    .filter((entry) => entry.action === "refuse")
    .map((entry) => entry.outputPath);
  const preserved = ordered
    .filter((entry) => entry.verdict === "output-edited" && entry.action === "preserve")
    .map((entry) => entry.outputPath);
  const lockUntrusted = ordered
    .filter((entry) => entry.verdict === "lock-untrusted")
    .map((entry) => entry.outputPath);
  return {
    lockUntrusted,
    preserved,
    refused,
    verdicts: ordered,
    writable:
      refused.length === 0 &&
      preserved.length === 0 &&
      lockUntrusted.length === 0,
  };
}
