import { posix } from "node:path";

import { markdownCodeRanges } from "./preprocess";

/**
 * Where an authored rule's relative links are anchored, and where one
 * rendering of it lands. Both are workspace-relative POSIX directories; `""`
 * and `"."` both mean the repository root.
 */
export interface RuleLinkBase {
  readonly scopeDir: string;
  readonly outputDir: string;
}

// `](destination "optional title")`: matching on `](` also reaches the outer
// target of a link whose text holds an image, as in `[![badge](a.svg)](b.md)`.
const INLINE_DESTINATION = /\]\(([ \t]*)([^\s()<>]+)((?:[ \t]+(?:"[^"\n]*"|'[^'\n]*'|\([^)\n]*\)))?[ \t]*\))/g;
// `[label]: destination` reference definitions; `[^1]:` footnotes are not links.
const REFERENCE_DEFINITION = /^( {0,3}\[(?!\^)[^\]\n]+\]:[ \t]*)([^\s<>]+)/gm;

/**
 * Rebase relative Markdown link targets in a rule body for one destination.
 *
 * Authors write a rule's relative links as seen from the directory the rule
 * applies to: the repository root for `RULES.md`, `apps/` for
 * `rules/apps/*.md`. That is where its `AGENTS.md` lands, so that projection is
 * unchanged. Every other destination (`.claude/CLAUDE.md`, `.claude/rules/`,
 * `.cursor/rules/`) sits at a different depth and gets the same targets
 * re-expressed relative to itself. Inline links (with or without a title) and
 * reference definitions are rebased; URLs, anchors, absolute paths,
 * angle-bracket targets, template references, and anything inside code are
 * left alone.
 */
export function rebaseRuleLinks(body: string, base: RuleLinkBase): string {
  const scopeDir = normalizeDir(base.scopeDir);
  const outputDir = normalizeDir(base.outputDir);
  if (scopeDir === outputDir) return body;

  const codeRanges = literalRanges(body);
  const inCode = (index: number): boolean =>
    codeRanges.some(([start, end]) => index >= start && index < end);
  const rebase = (target: string): string | undefined =>
    rebaseTarget(target, scopeDir, outputDir);

  const inlineRebased = body.replaceAll(
    INLINE_DESTINATION,
    (match, space: string, target: string, rest: string, offset: number) => {
      if (inCode(offset)) return match;
      const rebased = rebase(target);
      return rebased === undefined ? match : `](${space}${rebased}${rest}`;
    }
  );
  // Inline rebasing shifts offsets, so code ranges are recomputed for the
  // reference-definition pass.
  const definitionRanges = literalRanges(inlineRebased);
  return inlineRebased.replaceAll(
    REFERENCE_DEFINITION,
    (match, prefix: string, target: string, offset: number) => {
      if (definitionRanges.some(([start, end]) => offset >= start && offset < end)) return match;
      const rebased = rebase(target);
      return rebased === undefined ? match : `${prefix}${rebased}`;
    }
  );
}

type Range = readonly [start: number, end: number];

/** Fenced blocks and inline spans from the preprocessor, plus indented code blocks. */
function literalRanges(body: string): readonly Range[] {
  return [...markdownCodeRanges(body), ...indentedCodeRanges(body)];
}

const LIST_ITEM = /^ {0,3}(?:[-*+]|\d{1,9}[.)])(?:[ \t]|$)/;
const INDENTED = /^(?: {4}|\t)/;

/**
 * Indented code blocks: lines indented four spaces or a tab that follow a blank
 * line (or another such line) outside a list, where the same indentation is a
 * list item's continuation instead.
 */
function indentedCodeRanges(body: string): readonly Range[] {
  const ranges: Range[] = [];
  let lineStart = 0;
  let previousBlank = true;
  let inBlock = false;
  let inList = false;
  for (const line of body.split("\n")) {
    const blank = line.trim().length === 0;
    if (!blank && !INDENTED.test(line)) inList = LIST_ITEM.test(line) || (inList && !previousBlank);
    inBlock = !blank && INDENTED.test(line) && !inList && (previousBlank || inBlock);
    if (inBlock) ranges.push([lineStart, lineStart + line.length]);
    previousBlank = blank;
    lineStart += line.length + 1;
  }
  return ranges;
}

function rebaseTarget(target: string, scopeDir: string, outputDir: string): string | undefined {
  if (!isRelativeTarget(target)) return undefined;
  const suffixIndex = target.search(/[?#]/u);
  const path = suffixIndex === -1 ? target : target.slice(0, suffixIndex);
  const suffix = suffixIndex === -1 ? "" : target.slice(suffixIndex);
  if (path.length === 0) return undefined;
  const rebased = posix.relative(outputDir, posix.join(scopeDir, path));
  return `${rebased.length === 0 ? "." : rebased}${suffix}`;
}

function isRelativeTarget(target: string): boolean {
  if (target.startsWith("#") || target.startsWith("/") || target.startsWith("?")) return false;
  if (target.includes("{{")) return false;
  return !/^[a-z][a-z0-9+.-]*:/i.test(target);
}

function normalizeDir(directory: string): string {
  const normalized = posix.normalize(directory.replaceAll("\\", "/"));
  return normalized === "." ? "" : normalized.replace(/\/$/u, "");
}
