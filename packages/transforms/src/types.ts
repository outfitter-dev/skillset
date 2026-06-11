/** Source dialect a piece of authored content is written in. */
export type TransformDialect = "claude" | "codex";

/** Target a recognized construct can be lowered into. */
export type TransformTarget = "claude" | "codex";

/**
 * Target-truth provenance for an entry. Every entry must cite where its
 * mapping was verified and when, so registry maintenance is an evidence
 * refresh rather than archaeology.
 */
export interface TransformEvidence {
  /** Where the behavior was verified (docs URL, source file + lines). */
  readonly source: string;
  /** Verification date, ISO `YYYY-MM-DD`. */
  readonly verified: string;
  /** Optional clarification of what the source establishes. */
  readonly note?: string;
}

/**
 * One dialect's surface form of an intent.
 *
 * Capture-group contract: an entry's patterns across dialects must expose
 * compatible capture groups — the groups are the entry's canonical payload
 * (the "hub"). `render` receives an exec array produced by any dialect's
 * pattern for the same entry and must rebuild this dialect's surface form
 * from those groups alone.
 */
export interface TransformForm {
  /** Recognizer for this dialect's surface form. Must carry `g` and `u` flags. */
  readonly pattern: RegExp;
  /**
   * Produce this dialect's form from a canonical capture. Present only on
   * forms that are a lowering target for the entry (transformable entries);
   * `lowering: "none"` entries are recognized and reported, never rendered.
   */
  readonly render?: (match: RegExpExecArray) => string;
}

/**
 * One portable concept, keyed by intent, with per-dialect surface forms.
 * Data-first: entries carry no behavior beyond recognizers and renderers,
 * so the registry stays inspectable and testable as plain data.
 */
export interface TransformEntry {
  /** Stable intent key, e.g. `path.project-config-dir`. */
  readonly intent: string;
  /** What the portable concept is, in one sentence. */
  readonly description: string;
  /** Recognizers (and renderers, where transformable) per dialect. */
  readonly forms: Partial<Record<TransformDialect, TransformForm>>;
  /**
   * `bidirectional`: claude <-> codex round-trips byte-for-byte.
   * `to-codex`: claude lowers into codex prose; no codex -> claude path.
   * `none`: recognized and reported only — no faithful lowering exists.
   */
  readonly lowering: "bidirectional" | "to-codex" | "none";
  /** Why no faithful lowering exists. Required when `lowering` is `none`. */
  readonly reason?: string;
  /** Mandatory target-truth evidence backing the mapping. */
  readonly evidence: readonly TransformEvidence[];
}

/** One recognized construct in a body of text. */
export interface TransformMatch {
  /** Intent key of the entry that recognized this span. */
  readonly intent: string;
  /** Dialect the text was recognized as. */
  readonly dialect: TransformDialect;
  /** Exact matched text. */
  readonly text: string;
  /** Offset of the match in the scanned body. */
  readonly index: number;
  /** Lowering capability inherited from the entry. */
  readonly lowering: TransformEntry["lowering"];
  /** Entry reason, present for `lowering: "none"` entries. */
  readonly reason?: string;
}
