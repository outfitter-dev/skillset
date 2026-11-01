import { Parser } from "commonmark";

/** Zero-based, half-open line ranges; raw HTML is a boundary, not literal code. */
type LineRange = readonly [number, number];

export function markdownSpecialBlockLines(content: string): { html: LineRange[]; fences: LineRange[] } {
  // This permissive filter admits any possible container/list prefix. Only the
  // parser decides the block grammar; inline tags need no block AST.
  const html: LineRange[] = [];
  const fences: LineRange[] = [];
  const htmlCandidate = /(?:^|[\r\n])[ \t>+*0-9.)-]*<[A-Za-z!/?]/u.test(content);
  const fenceCandidate = /(?:^|[\r\n])[ \t>+*0-9.)-]+(?:`{3,}|~{3,})/u.test(content);
  if (!htmlCandidate && !fenceCandidate) return { html, fences };
  const walker = new Parser().parse(content).walker();
  for (let event = walker.next(); event !== null; event = walker.next()) {
    if (event.entering && event.node.type === "html_block") {
      html.push([event.node.sourcepos[0][0] - 1, event.node.sourcepos[1][0]]);
    } else if (event.entering && event.node.type === "code_block" && event.node.info !== null && event.node.parent?.type !== "document") {
      // Public info distinguishes fenced code from the separate indented-code policy.
      fences.push([event.node.sourcepos[0][0] - 1, event.node.sourcepos[1][0]]);
    }
  }
  return { html, fences };
}
