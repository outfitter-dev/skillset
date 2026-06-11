import { listTransformEntries, transformEntries } from "./registry";
import type {
  TransformDialect,
  TransformEntry,
  TransformMatch,
  TransformTarget,
} from "./types";

interface Candidate {
  readonly entry: TransformEntry;
  readonly index: number;
  /** Registration position; the deterministic tiebreak for equal spans. */
  readonly order: number;
  readonly text: string;
}

/**
 * Recognize every registered construct of `dialect` in `body`.
 *
 * Overlapping spans never double-report: the longest match wins (then the
 * earlier match, then registration order), which is what makes the
 * skills-dir entries shadow the generic config-dir prefixes on
 * `.claude/skills/...` spans. Code fences and inline code are scanned like
 * any other text on purpose — for skills, dynamic constructs inside fences
 * are usually the real usage. Results are sorted by index.
 */
export function recognizeTransforms(
  body: string,
  dialect: TransformDialect
): readonly TransformMatch[] {
  const candidates: Candidate[] = [];
  let order = 0;
  for (const entry of listTransformEntries()) {
    const form = entry.forms[dialect];
    if (form !== undefined) {
      for (const match of execAll(form.pattern, body)) {
        candidates.push({ entry, index: match.index, order, text: match[0] });
      }
    }
    order += 1;
  }

  candidates.sort(
    (a, b) => b.text.length - a.text.length || a.index - b.index || a.order - b.order
  );

  const kept: Candidate[] = [];
  for (const candidate of candidates) {
    const end = candidate.index + candidate.text.length;
    const overlaps = kept.some(
      (other) => candidate.index < other.index + other.text.length && other.index < end
    );
    if (!overlaps) kept.push(candidate);
  }

  return kept
    .sort((a, b) => a.index - b.index)
    .map(({ entry, index, text }) => ({
      dialect,
      index,
      intent: entry.intent,
      lowering: entry.lowering,
      text,
      ...(entry.reason === undefined ? {} : { reason: entry.reason }),
    }));
}

/**
 * Lower a recognized construct into `target`'s surface form. Returns
 * `undefined` when no faithful lowering exists: `lowering: "none"` entries,
 * a `to-codex` entry asked for a non-codex target, or a missing target
 * form/renderer. Lowering into the match's own dialect is the identity.
 */
export function lowerTransform(
  match: TransformMatch,
  target: TransformTarget
): string | undefined {
  if (match.lowering === "none") return undefined;
  if (match.lowering === "to-codex" && target !== "codex") return undefined;
  if (target === match.dialect) return match.text;

  const entry = transformEntries.get(match.intent);
  const sourceForm = entry?.forms[match.dialect];
  const render = entry?.forms[target]?.render;
  if (entry === undefined || sourceForm === undefined || render === undefined) {
    return undefined;
  }

  // Re-derive the canonical capture by re-running the source recognizer on
  // the matched text alone; `^`/whitespace context guards hold at offset 0.
  const exec = cloneWithoutGlobal(sourceForm.pattern).exec(match.text);
  if (exec === null || exec[0] !== match.text) return undefined;
  return render(exec);
}

/** Iterate all matches on a private clone so shared patterns stay stateless. */
function execAll(pattern: RegExp, body: string): readonly RegExpExecArray[] {
  const regex = new RegExp(pattern.source, pattern.flags);
  const matches: RegExpExecArray[] = [];
  let match = regex.exec(body);
  while (match !== null) {
    matches.push(match);
    if (match[0].length === 0) regex.lastIndex += 1;
    match = regex.exec(body);
  }
  return matches;
}

function cloneWithoutGlobal(pattern: RegExp): RegExp {
  return new RegExp(pattern.source, pattern.flags.replaceAll(/[gy]/gu, ""));
}
