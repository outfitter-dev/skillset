/**
 * CommonMark 0.31.2 URI/email autolink syntax, matching the installed parser.
 * Offsets remain UTF-16 source offsets. These are candidate ranges: an earlier
 * code span can consume '<', so the delimiter scanner must check that boundary.
 */
export function markdownAutolinkCandidates(
  line: string
): readonly { start: number; end: number }[] {
  const candidates: { start: number; end: number }[] = [];
  const patterns = [
    /<[A-Za-z][A-Za-z0-9.+-]{1,31}:[^<>\x00-\x20]*>/gu,
    /<[a-zA-Z0-9.!#$%&'*+\/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*>/gu,
  ];
  for (const pattern of patterns) {
    for (const match of line.matchAll(pattern)) {
      let backslashes = 0;
      while (line[match.index - backslashes - 1] === "\\") backslashes++;
      if (backslashes % 2 === 0)
        candidates.push({
          start: match.index,
          end: match.index + match[0].length,
        });
    }
  }
  return candidates.sort((a, b) => a.start - b.start || a.end - b.end);
}
