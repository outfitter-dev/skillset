import { Parser } from "commonmark";

/** Zero-based, half-open line ranges; raw HTML is a boundary, not literal code. */
export function markdownHtmlBlockLines(content: string): readonly (readonly [number, number])[] {
  // This permissive filter admits any possible container/list prefix. Only the
  // parser decides whether the candidate is HTML; inline tags need no block AST.
  if (!/(?:^|[\r\n])[ \t>+*0-9.)-]*<[A-Za-z!/?]/u.test(content)) return [];
  const ranges: (readonly [number, number])[] = [];
  const walker = new Parser().parse(content).walker();
  for (let event = walker.next(); event !== null; event = walker.next()) {
    if (event.entering && event.node.type === "html_block") {
      ranges.push([event.node.sourcepos[0][0] - 1, event.node.sourcepos[1][0]]);
    }
  }
  return ranges;
}
