export interface MarkdownCodeSpan {
  readonly end: number;
  readonly marker: string;
  readonly start: number;
  readonly value: string;
  readonly valueStart: number;
}

/** Reads the single-line CommonMark code spans used by closure guidance. */
export function readMarkdownCodeSpans(
  text: string
): readonly MarkdownCodeSpan[] {
  const spans: MarkdownCodeSpan[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    if (text[cursor] !== "`") {
      cursor += 1;
      continue;
    }
    const start = cursor;
    while (text[cursor] === "`") cursor += 1;
    const marker = text.slice(start, cursor);
    let search = cursor;
    let end: number | undefined;
    while (search < text.length) {
      const candidate = text.indexOf("`", search);
      if (candidate < 0) break;
      let candidateEnd = candidate;
      while (text[candidateEnd] === "`") candidateEnd += 1;
      if (candidateEnd - candidate === marker.length) {
        end = candidateEnd;
        break;
      }
      search = candidateEnd;
    }
    if (end === undefined) continue;
    let valueStart = cursor;
    let value = text.slice(valueStart, end - marker.length);
    if (/^ .* $/u.test(value) && /[^ ]/u.test(value)) {
      value = value.slice(1, -1);
      valueStart += 1;
    }
    spans.push({ end, marker, start, value, valueStart });
    cursor = end;
  }
  return spans;
}
