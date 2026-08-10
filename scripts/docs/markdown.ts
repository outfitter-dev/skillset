import { Parser } from "commonmark";

export interface MarkdownLink {
  readonly column: number;
  readonly destination: string;
  readonly label: string;
  readonly line: number;
}

export interface MarkdownHeading {
  readonly anchor: string;
  readonly depth: number;
  readonly line: number;
  readonly text: string;
}

export type GeneratedMarkerKind = "end" | "invalid" | "start";

export interface GeneratedMarker {
  readonly id: string;
  readonly kind: GeneratedMarkerKind;
  readonly line: number;
}

export type GeneratedMarkerIssueKind =
  | "duplicate-id"
  | "invalid-id"
  | "invalid-syntax"
  | "mismatched-end"
  | "nested-start"
  | "unclosed-start"
  | "unexpected-end";

export interface GeneratedMarkerIssue {
  readonly expectedId?: string;
  readonly id: string;
  readonly kind: GeneratedMarkerIssueKind;
  readonly line: number;
}

interface GeneratedMarkerLocation extends GeneratedMarker {
  readonly end: number;
  readonly start: number;
}

const MARKER_CANDIDATE_PATTERN =
  /<!--\s*skillset:generated:[^\n]*?(?:-->|(?=\n|$))/g;
const CLOSED_MARKER_PATTERN =
  /^<!--\s*skillset:generated:([^\s>]*)([^\n]*?)-->$/;
const VALID_MARKER_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Extract ordinary inline Markdown links, excluding images and code examples. */
export function extractInlineMarkdownLinks(
  source: string
): readonly MarkdownLink[] {
  const visible = maskHtmlComments(maskMarkdownCode(source));
  const definitions = extractReferenceDefinitions(visible);
  const links: MarkdownLink[] = [];

  for (let index = 0; index < visible.length; index += 1) {
    if (
      visible[index] !== "[" ||
      isEscaped(visible, index) ||
      isImageStart(visible, index)
    )
      continue;
    const labelEnd = findClosingBracket(visible, index);
    const position = sourcePosition(source, index);
    if (labelEnd === -1) continue;
    const label = unescapeMarkdown(source.slice(index + 1, labelEnd));
    if (visible[labelEnd + 1] === "(") {
      const parsed = parseLinkDestination(visible, labelEnd + 2);
      if (parsed === undefined) continue;
      links.push({
        column: position.column,
        destination: unescapeMarkdown(parsed.destination),
        label,
        line: position.line,
      });
      index = parsed.end;
      continue;
    }
    if (visible[labelEnd + 1] === ":") continue;
    let reference = label;
    let end = labelEnd;
    if (visible[labelEnd + 1] === "[") {
      const referenceEnd = findClosingBracket(visible, labelEnd + 1);
      if (referenceEnd === -1) continue;
      reference = visible.slice(labelEnd + 2, referenceEnd) || label;
      end = referenceEnd;
    }
    const destination = definitions.get(normalizeReferenceLabel(reference));
    if (destination === undefined) continue;
    links.push({
      column: position.column,
      destination,
      label,
      line: position.line,
    });
    index = end;
  }

  return links;
}

function extractReferenceDefinitions(
  source: string
): ReadonlyMap<string, string> {
  const definitions = new Map<string, string>();
  for (const line of source.split("\n")) {
    const match =
      /^ {0,3}\[([^\]]+)\]:[ \t]*(?:<([^>]+)>|(\S+))(?:[ \t]+.*)?$/u.exec(line);
    if (match === null) continue;
    const label = match[1];
    const destination = match[2] ?? match[3];
    if (label === undefined || destination === undefined) continue;
    const normalized = normalizeReferenceLabel(label);
    if (!definitions.has(normalized)) {
      definitions.set(normalized, unescapeMarkdown(destination));
    }
  }
  return definitions;
}

function normalizeReferenceLabel(label: string): string {
  return label.trim().replaceAll(/\s+/gu, " ").toLocaleLowerCase("en-US");
}

/** Extract ATX headings and assign anchors with GitHub's duplicate suffix convention. */
export function extractMarkdownHeadings(
  source: string
): readonly MarkdownHeading[] {
  const visible = maskMarkdownCode(source, false);
  const headings: MarkdownHeading[] = [];
  const anchorCounts = new Map<string, number>();
  const lines = visible.split("\n");
  const renderedTextByLine = commonMarkHeadingTextByLine(visible);

  for (const [lineIndex, line] of lines.entries()) {
    const match = /^ {0,3}(#{1,6})(?:[ \t]+|$)(.*)$/.exec(line);
    if (match === null) continue;
    const hashes = match[1];
    const body = match[2];
    if (hashes === undefined || body === undefined) continue;
    const text =
      renderedTextByLine.get(lineIndex + 1) ??
      cleanHeadingText(body.replace(/[ \t]+#+[ \t]*$/, "").trim());
    const baseAnchor = githubHeadingSlug(text);
    const count = anchorCounts.get(baseAnchor) ?? 0;
    anchorCounts.set(baseAnchor, count + 1);
    headings.push({
      anchor: count === 0 ? baseAnchor : `${baseAnchor}-${count}`,
      depth: hashes.length,
      line: lineIndex + 1,
      text,
    });
  }

  return headings;
}

/** Derive the base fragment GitHub uses for a rendered heading. */
export function githubHeadingSlug(heading: string): string {
  return cleanHeadingText(heading)
    .normalize("NFC")
    .toLocaleLowerCase("en-US")
    .replace(/<[^>]*>/g, "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[\p{P}\p{S}]/gu, (character) =>
      character === "-" || character === "_" ? character : ""
    )
    .replace(/[\u200d\u20e3\ufe0e\ufe0f]/gu, "")
    .replace(/\u00a0/giu, "")
    .trim()
    .replace(/\s/g, "-");
}

/** Extract visible generated-block markers. Marker-looking code is ignored. */
export function extractGeneratedMarkers(
  source: string
): readonly GeneratedMarker[] {
  return extractGeneratedMarkerLocations(source).map(({ id, kind, line }) => ({
    id,
    kind,
    line,
  }));
}

/**
 * Preserve reader-visible authored Markdown while masking examples, raw HTML,
 * comments, and generated block contents without changing source positions.
 */
export function extractAuthoredMarkdown(source: string): string {
  const markers = extractGeneratedMarkerLocations(source);
  let visible = maskHtmlComments(maskMarkdownCode(source, false));
  let generatedStart: number | undefined;

  for (const marker of markers) {
    if (marker.kind === "start") {
      generatedStart ??= marker.start;
      continue;
    }
    if (marker.kind === "end" && generatedStart !== undefined) {
      visible = maskRange(visible, generatedStart, marker.end);
      generatedStart = undefined;
    }
  }
  if (generatedStart !== undefined) {
    visible = maskRange(visible, generatedStart, visible.length);
  }
  return visible;
}

/**
 * Replace one generated block body exactly, preserving both marker comments and
 * every byte outside them. The caller owns any desired surrounding newlines.
 */
export function replaceGeneratedBlock(
  source: string,
  id: string,
  body: string
): string {
  if (!VALID_MARKER_ID.test(id)) {
    throw new Error(`invalid generated block ID: ${id}`);
  }

  const locations = extractGeneratedMarkerLocations(source);
  const issues = validateGeneratedMarkers(locations);
  if (issues.length > 0) {
    const summary = issues
      .map((issue) => `${issue.kind} at line ${issue.line}: ${issue.id}`)
      .join("; ");
    throw new Error(`invalid generated markers: ${summary}`);
  }

  const starts = locations.filter(
    (marker) => marker.kind === "start" && marker.id === id
  );
  const ends = locations.filter(
    (marker) => marker.kind === "end" && marker.id === id
  );
  if (starts.length !== 1 || ends.length !== 1) {
    throw new Error(`expected exactly one generated block: ${id}`);
  }

  const start = starts[0];
  const end = ends[0];
  if (start === undefined || end === undefined || start.end > end.start) {
    throw new Error(`invalid generated block boundaries: ${id}`);
  }
  return `${source.slice(0, start.end)}${body}${source.slice(end.start)}`;
}

function extractGeneratedMarkerLocations(
  source: string
): readonly GeneratedMarkerLocation[] {
  const visible = maskMarkdownCode(source);
  const markers: GeneratedMarkerLocation[] = [];
  for (const match of visible.matchAll(MARKER_CANDIDATE_PATTERN)) {
    const candidate = match[0];
    const closed = CLOSED_MARKER_PATTERN.exec(candidate);
    const action = closed?.[1] ?? "";
    const remainder = (closed?.[2] ?? "").trim();
    const parts = remainder.length === 0 ? [] : remainder.split(/\s+/u);
    const kind =
      closed !== null &&
      (action === "start" || action === "end") &&
      parts.length === 1
        ? action
        : "invalid";
    if (match.index === undefined) continue;
    markers.push({
      end: match.index + match[0].length,
      id:
        kind === "invalid"
          ? closed === null
            ? candidate.replace(/^<!--\s*skillset:generated:/u, "").trim()
            : [action, ...parts].filter(Boolean).join(" ")
          : parts[0]!,
      kind,
      line: sourcePosition(source, match.index).line,
      start: match.index,
    });
  }
  return markers;
}

/** Validate marker pairing, ordering, nesting, IDs, and per-file uniqueness. */
export function validateGeneratedMarkers(
  markers: readonly GeneratedMarker[]
): readonly GeneratedMarkerIssue[] {
  const issues: GeneratedMarkerIssue[] = [];
  const seenStarts = new Set<string>();
  let open: GeneratedMarker | undefined;

  for (const marker of markers) {
    if (marker.kind === "invalid") {
      issues.push({ id: marker.id, kind: "invalid-syntax", line: marker.line });
      continue;
    }
    if (!VALID_MARKER_ID.test(marker.id)) {
      issues.push({ id: marker.id, kind: "invalid-id", line: marker.line });
    }

    if (marker.kind === "start") {
      if (seenStarts.has(marker.id)) {
        issues.push({ id: marker.id, kind: "duplicate-id", line: marker.line });
      }
      seenStarts.add(marker.id);
      if (open !== undefined) {
        issues.push({
          expectedId: open.id,
          id: marker.id,
          kind: "nested-start",
          line: marker.line,
        });
      } else {
        open = marker;
      }
      continue;
    }

    if (open === undefined) {
      issues.push({ id: marker.id, kind: "unexpected-end", line: marker.line });
    } else if (open.id !== marker.id) {
      issues.push({
        expectedId: open.id,
        id: marker.id,
        kind: "mismatched-end",
        line: marker.line,
      });
      open = undefined;
    } else {
      open = undefined;
    }
  }

  if (open !== undefined) {
    issues.push({ id: open.id, kind: "unclosed-start", line: open.line });
  }
  return issues;
}

function maskMarkdownCode(source: string, inlineCode = true): string {
  const maskedLines: string[] = [];
  let fence:
    | { readonly character: "`" | "~"; readonly length: number }
    | undefined;

  for (const line of source.split("\n")) {
    const fenceMatch = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    const run = fenceMatch?.[1];
    const validOpeningRun =
      run !== undefined &&
      !(run[0] === "`" && line.slice(fenceMatch?.[0].length).includes("`"));
    if (fence === undefined && validOpeningRun) {
      fence = { character: run[0] as "`" | "~", length: run.length };
      maskedLines.push(maskLine(line));
      continue;
    }
    if (fence !== undefined) {
      maskedLines.push(maskLine(line));
      if (
        run !== undefined &&
        run[0] === fence.character &&
        run.length >= fence.length &&
        line.slice(fenceMatch?.[0].length).trim() === ""
      )
        fence = undefined;
      continue;
    }
    maskedLines.push(inlineCode ? maskInlineCode(line) : line);
  }
  return maskedLines.join("\n");
}

function maskInlineCode(line: string): string {
  const characters = line.split("");
  let index = 0;
  while (index < line.length) {
    if (line[index] !== "`") {
      index += 1;
      continue;
    }
    const runLength = countRun(line, index, "`");
    const closing = findExactRun(line, index + runLength, "`", runLength);
    if (closing === -1) {
      index += runLength;
      continue;
    }
    for (let cursor = index; cursor < closing + runLength; cursor += 1)
      characters[cursor] = " ";
    index = closing + runLength;
  }
  return characters.join("");
}

function maskHtmlComments(source: string): string {
  const lines = source.split("\n");
  const walker = new Parser().parse(source).walker();
  let event = walker.next();
  while (event !== null) {
    if (event.entering && event.node.type === "html_block") {
      const [[startLine], [endLine]] = event.node.sourcepos;
      for (let line = startLine - 1; line < endLine; line += 1) {
        lines[line] = maskLine(lines[line] ?? "");
      }
    }
    event = walker.next();
  }
  return lines
    .join("\n")
    .replace(/<!--[\s\S]*?(?:-->|$)/gu, (comment) =>
      comment.replace(/[^\n]/gu, " ")
    );
}

function maskRange(source: string, start: number, end: number): string {
  return `${source.slice(0, start)}${source
    .slice(start, end)
    .replace(/[^\n]/gu, " ")}${source.slice(end)}`;
}

function findClosingBracket(source: string, start: number): number {
  let depth = 1;
  for (
    let index = start + 1;
    index < source.length && source[index] !== "\n";
    index += 1
  ) {
    if (isEscaped(source, index)) continue;
    if (source[index] === "[") depth += 1;
    if (source[index] === "]") depth -= 1;
    if (depth === 0) return index;
  }
  return -1;
}

function parseLinkDestination(
  source: string,
  start: number
): { readonly destination: string; readonly end: number } | undefined {
  let cursor = start;
  while (source[cursor] === " " || source[cursor] === "\t") cursor += 1;
  let destination = "";

  if (source[cursor] === "<") {
    cursor += 1;
    const destinationStart = cursor;
    while (cursor < source.length && source[cursor] !== "\n") {
      if (source[cursor] === ">" && !isEscaped(source, cursor)) break;
      cursor += 1;
    }
    if (source[cursor] !== ">") return undefined;
    destination = source.slice(destinationStart, cursor);
    cursor += 1;
  } else {
    const destinationStart = cursor;
    let parentheses = 0;
    while (cursor < source.length && source[cursor] !== "\n") {
      const character = source[cursor];
      if (character === undefined) break;
      if (!isEscaped(source, cursor) && character === "(") parentheses += 1;
      if (!isEscaped(source, cursor) && character === ")") {
        if (parentheses === 0) break;
        parentheses -= 1;
      }
      if (parentheses === 0 && (character === " " || character === "\t")) break;
      cursor += 1;
    }
    if (parentheses !== 0) return undefined;
    destination = source.slice(destinationStart, cursor);
  }

  while (source[cursor] === " " || source[cursor] === "\t") cursor += 1;
  if (source[cursor] !== ")") {
    const quote = source[cursor];
    if (quote !== '"' && quote !== "'" && quote !== "(") return undefined;
    const closingQuote = quote === "(" ? ")" : quote;
    cursor += 1;
    while (cursor < source.length && source[cursor] !== "\n") {
      if (source[cursor] === closingQuote && !isEscaped(source, cursor)) break;
      cursor += 1;
    }
    if (source[cursor] !== closingQuote) return undefined;
    cursor += 1;
    while (source[cursor] === " " || source[cursor] === "\t") cursor += 1;
  }
  if (source[cursor] !== ")") return undefined;
  return { destination, end: cursor };
}

function cleanHeadingText(text: string): string {
  return commonMarkHeadingTextByLine(`# ${text}\n`).get(1)?.trim() ?? "";
}

function commonMarkHeadingTextByLine(
  source: string
): ReadonlyMap<number, string> {
  const headings = new Map<number, string>();
  const walker = new Parser().parse(source).walker();
  let event = walker.next();
  while (event !== null) {
    if (event.entering && event.node.type === "heading") {
      headings.set(event.node.sourcepos[0][0], inlineText(event.node));
    }
    event = walker.next();
  }
  return headings;
}

function inlineText(root: import("commonmark").Node): string {
  let text = "";
  const walker = root.walker();
  let event = walker.next();
  while (event !== null) {
    if (
      event.entering &&
      (event.node.type === "text" || event.node.type === "code")
    ) {
      text += event.node.literal ?? "";
    }
    if (
      event.entering &&
      (event.node.type === "softbreak" || event.node.type === "linebreak")
    ) {
      text += " ";
    }
    event = walker.next();
  }
  return text;
}

function isImageStart(source: string, index: number): boolean {
  return (
    index > 0 && source[index - 1] === "!" && !isEscaped(source, index - 1)
  );
}

function isEscaped(source: string, index: number): boolean {
  let slashes = 0;
  for (
    let cursor = index - 1;
    cursor >= 0 && source[cursor] === "\\";
    cursor -= 1
  )
    slashes += 1;
  return slashes % 2 === 1;
}

function unescapeMarkdown(value: string): string {
  return value.replace(/\\([!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~])/g, "$1");
}

function sourcePosition(
  source: string,
  index: number
): { readonly column: number; readonly line: number } {
  const before = source.slice(0, index);
  const lastNewline = before.lastIndexOf("\n");
  return {
    column: index - lastNewline,
    line: before.split("\n").length,
  };
}

function maskLine(line: string): string {
  return " ".repeat(line.length);
}

function countRun(source: string, start: number, character: string): number {
  let length = 0;
  while (source[start + length] === character) length += 1;
  return length;
}

function findExactRun(
  source: string,
  start: number,
  character: string,
  length: number
): number {
  for (let index = start; index < source.length; index += 1) {
    if (source[index] !== character) continue;
    const candidateLength = countRun(source, index, character);
    if (candidateLength === length) return index;
    index += candidateLength - 1;
  }
  return -1;
}
