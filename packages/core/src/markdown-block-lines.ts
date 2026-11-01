import { Parser } from "commonmark";

/** Zero-based, half-open line ranges; raw HTML is a boundary, not literal code. */
type LineRange = readonly [number, number];

interface ContainerFenceContext {
  readonly fenceLines: LineRange;
  readonly startLine: number;
  readonly endLine: number;
  readonly continuationPrefix: string;
}

export function markdownSpecialBlockLines(content: string): { html: LineRange[]; fences: LineRange[]; containers: ContainerFenceContext[] } {
  // This permissive filter admits any possible container/list prefix. Only the
  // parser decides the block grammar; inline tags need no block AST.
  const html: LineRange[] = [];
  const fences: LineRange[] = [];
  const containers: ContainerFenceContext[] = [];
  const htmlCandidate = /(?:^|[\r\n])[ \t>+*0-9.)-]*<[A-Za-z!/?]/u.test(content);
  const fenceCandidate = /(?:^|[\r\n])[ \t>+*0-9.)-]+(?:`{3,}|~{3,})/u.test(content);
  // A nested fence also requires a list or quote opener somewhere in the document.
  // Indented fence-looking text alone is not a container and needs no full AST.
  const containerCandidate = /(?:^|[\r\n])[ \t]*(?:>|(?:[-+*]|[0-9]{1,9}[.)])(?:[ \t\r\n]|$))/u.test(content);
  if (!htmlCandidate && !(fenceCandidate && containerCandidate)) return { html, fences, containers };
  const lines = content.split(/\r\n?|\n/u);
  const walker = new Parser().parse(content).walker();
  for (let event = walker.next(); event !== null; event = walker.next()) {
    if (event.entering && event.node.type === "html_block") {
      html.push([event.node.sourcepos[0][0] - 1, event.node.sourcepos[1][0]]);
    } else if (event.entering && event.node.type === "code_block" && event.node.info !== null && event.node.parent?.type !== "document") {
      // Public info distinguishes fenced code from the separate indented-code policy.
      const startLine = event.node.sourcepos[0][0] - 1;
      const fenceLines: LineRange = [startLine, event.node.sourcepos[1][0]];
      fences.push(fenceLines);
      const opener = lines[startLine]!;
      const prefix = opener.slice(0, event.node.sourcepos[0][1] - 1);
      containers.push({
        fenceLines,
        startLine: startLine + 1,
        endLine: startLine + 1 + (event.node.literal?.match(/\n/g)?.length ?? 0),
        continuationPrefix: continuationPrefix(prefix),
      });
    }
  }
  return { html, fences, containers };
}

/** The parser has already proved this prefix consists of containers and indent. */
function continuationPrefix(prefix: string): string {
  const markersAsIndent = prefix.replace(/[0-9]{1,9}[.)]|[-+*]/g, (marker) => " ".repeat(marker.length));
  let result = "";
  let column = 0;
  for (const [index, character] of Array.from(markersAsIndent).entries()) {
    const width = character === "\t" ? 4 - column % 4 : 1;
    result += character === "\t" ? " ".repeat(width) : character;
    column += width;
    // A compact quote must not consume the first space of generated JSON.
    if (character === ">" && prefix[index + 1] !== " " && prefix[index + 1] !== "\t") result += " ";
  }
  return result;
}
