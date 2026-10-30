import { markdownCodeRanges } from "./preprocess";

export type MarkdownRange = readonly [start: number, end: number];

/** Fenced blocks and inline spans from the preprocessor, plus indented code blocks. */
export function markdownCodeLiteralRanges(body: string): readonly MarkdownRange[] {
  return [...markdownCodeRanges(body), ...indentedCodeRanges(body)];
}

const LIST_ITEM = /^ {0,3}(?:[-*+]|\d{1,9}[.)])(?:[ \t]|$)/;
const INDENTED = /^(?: {4}|\t)/;

/**
 * Indented code blocks: lines indented four spaces or a tab that follow a blank
 * line (or another such line) outside a list, where the same indentation is a
 * list item's continuation instead.
 */
function indentedCodeRanges(body: string): readonly MarkdownRange[] {
  const ranges: MarkdownRange[] = [];
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

/** Protect literal contexts while retaining the existing narrow inline-link grammar. */
export function markdownLinkIsActive(body: string): (match: string, offset: number) => boolean {
  const code = markdownCodeLiteralRanges(body);
  const comments: MarkdownRange[] = [];
  let commentStart: number | undefined;
  for (const match of body.matchAll(/<!--|-->/g)) {
    if (commentStart !== undefined) {
      if (match[0] === "-->") {
        comments.push([commentStart, match.index + match[0].length]);
        commentStart = undefined;
      }
    } else if (match[0] === "<!--" && !inside(code, match.index) && !escaped(body, match.index)) {
      commentStart = match.index;
    }
  }
  if (commentStart !== undefined) comments.push([commentStart, body.length]);
  // Backticks inside HTML comments cannot open spans over following prose.
  let visible = body;
  for (const [start, end] of comments) {
    visible = visible.slice(0, start) + visible.slice(start, end).replace(/[^\n]/g, " ") + visible.slice(end);
  }
  const literals = [...markdownCodeLiteralRanges(visible), ...comments];
  return (match, offset) => {
    const opening = offset + (match.startsWith("!") ? 1 : 0);
    const closing = offset + match.indexOf("](");
    // Only the opening bracket is tested for code containment: code in a
    // genuine link's label does not turn its destination into literal text.
    return !inside(literals, opening) && !escaped(body, opening) && !escaped(body, closing);
  };
}

function inside(ranges: readonly MarkdownRange[], offset: number): boolean {
  return ranges.some(([start, end]) => offset >= start && offset < end);
}

function escaped(body: string, offset: number): boolean {
  let count = 0;
  for (let index = offset - 1; index >= 0 && body[index] === "\\"; index -= 1) count += 1;
  return count % 2 === 1;
}
