/**
 * Detect generated-output drift that changes only whitespace or layout, the
 * signature of a repository formatter run over generated files (SET-618).
 *
 * The comparison is deliberately conservative. JSON counts as layout-only
 * when both sides are valid and their tokens match once whitespace outside
 * strings is removed. Markdown counts when frontmatter, fenced code, and every
 * block that carries line-sensitive syntax (headings, setext underlines,
 * quotes, tables, HTML, indented code, hard breaks) are identical, and each
 * remaining prose block has the same words, the same first-line indentation,
 * and the same list-item indentation. Everything else keeps its ordinary
 * drift classification. Isolated builds are not compared.
 */

import { resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";

import { scopedRenderedFiles } from "@skillset/core/internal/build";
import { MISSING_PATH_ENOENT, readOptionalText } from "@skillset/core/internal/fs-existence";
import { resolveInside } from "@skillset/core/internal/path";
import { renderBuildGraph } from "@skillset/core/internal/render";
import { loadBuildGraph } from "@skillset/core/internal/resolver";
import type { SkillsetOptions } from "@skillset/core/internal/types";

const textDecoder = new TextDecoder();

/** Return the drifted paths whose on-disk bytes differ from a fresh render only in layout. */
export async function layoutOnlyDriftPaths(
  rootPath: string,
  paths: readonly string[],
  options: SkillsetOptions = {}
): Promise<readonly string[]> {
  const candidates = paths.filter(isLayoutComparablePath);
  if (candidates.length === 0 || options.isolated === true) return [];
  const graph = await loadBuildGraph(rootPath, options);
  const expected = new Map(
    scopedRenderedFiles(graph, await renderBuildGraph(graph), options.scopes)
      .map((file) => [file.path, textDecoder.decode(file.content)])
  );
  const layoutOnly: string[] = [];
  for (const path of candidates) {
    const rendered = expected.get(path);
    if (rendered === undefined) continue;
    const actual = await readOptionalText(resolveInside(resolve(rootPath), path), { missing: MISSING_PATH_ENOENT });
    if (actual === undefined || actual === rendered) continue;
    if (isLayoutOnlyDifference(path, rendered, actual)) layoutOnly.push(path);
  }
  return layoutOnly.toSorted();
}

/** @internal Exported for focused tests of the layout-only definition. */
export function isLayoutOnlyDifference(path: string, expected: string, actual: string): boolean {
  if (path.endsWith(".json")) return jsonValuesEqual(expected, actual);
  if (path.endsWith(".md")) return markdownLayoutEqual(expected, actual);
  return false;
}

function isLayoutComparablePath(path: string): boolean {
  return (path.endsWith(".json") || path.endsWith(".md")) && !path.endsWith("skillset.lock");
}

/**
 * Compare JSON token by token with insignificant whitespace removed. This is
 * stricter than comparing parsed values: rounding of long numbers, duplicate
 * keys, and key reordering all stay visible as real changes.
 */
function jsonValuesEqual(expected: string, actual: string): boolean {
  try {
    JSON.parse(expected);
    JSON.parse(actual);
  } catch {
    return false;
  }
  return stripJsonWhitespace(expected) === stripJsonWhitespace(actual);
}

function stripJsonWhitespace(text: string): string {
  return text.replaceAll(/"(?:[^"\\]|\\.)*"|\s+/g, (token) => (token.startsWith('"') ? token : ""));
}

interface MarkdownSegment {
  readonly kind: "prose" | "verbatim";
  readonly lines: readonly string[];
}

function markdownLayoutEqual(expected: string, actual: string): boolean {
  const left = markdownSegments(expected);
  const right = markdownSegments(actual);
  if (left.length !== right.length) return false;
  return left.every((segment, index) => {
    const other = right[index];
    if (other === undefined || other.kind !== segment.kind) return false;
    return segment.kind === "verbatim"
      ? isDeepStrictEqual(segment.lines, other.lines)
      : proseBlockLayoutEqual(segment.lines, other.lines);
  });
}

/**
 * Split Markdown into frontmatter and fenced code (compared verbatim) and
 * blank-line-separated prose blocks (compared by words and structure).
 */
function markdownSegments(text: string): readonly MarkdownSegment[] {
  const lines = text.replaceAll("\r\n", "\n").split("\n").map(trimLayoutWhitespace);
  const segments: MarkdownSegment[] = [];
  let index = 0;
  if (lines[0] === "---") {
    const end = lines.indexOf("---", 1);
    if (end > 0) {
      segments.push({ kind: "verbatim", lines: lines.slice(0, end + 1) });
      index = end + 1;
    }
  }
  let prose: string[] = [];
  const flushProse = (): void => {
    if (prose.length > 0) segments.push({ kind: "prose", lines: prose });
    prose = [];
  };
  while (index < lines.length) {
    const line = lines[index] ?? "";
    const fence = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
    if (fence !== undefined) {
      flushProse();
      const block = [line];
      index += 1;
      while (index < lines.length) {
        const inner = lines[index] ?? "";
        block.push(inner);
        index += 1;
        if (inner.trimStart().startsWith(fence)) break;
      }
      segments.push({ kind: "verbatim", lines: block });
      continue;
    }
    if (line.trim() === "") flushProse();
    else prose.push(line);
    index += 1;
  }
  flushProse();
  return segments;
}

function proseBlockLayoutEqual(left: readonly string[], right: readonly string[]): boolean {
  if (left.some(isLineSensitive) || right.some(isLineSensitive)) return isDeepStrictEqual(left, right);
  return (
    collapseWhitespace(left) === collapseWhitespace(right) &&
    leadingIndent(left[0] ?? "") === leadingIndent(right[0] ?? "") &&
    isDeepStrictEqual(listItemIndents(left), listItemIndents(right))
  );
}

/** Trailing spaces are layout, except the two-space hard line break. */
function trimLayoutWhitespace(line: string): string {
  const trimmed = line.trimEnd();
  return / {2,}$/.test(line) && trimmed.length > 0 ? `${trimmed}  ` : trimmed;
}

/** Lines whose meaning depends on where the line breaks fall. */
function isLineSensitive(line: string): boolean {
  if (/ {2}$|\\$/.test(line)) return true;
  if (/^(?: {4}|\t)/.test(line) && !/^\s*(?:[-*+]|\d+[.)])\s/.test(line)) return true;
  return /^\s{0,3}(?:#|>|\||<|=+\s*$|-+\s*$)/.test(line);
}

function collapseWhitespace(lines: readonly string[]): string {
  return lines.join(" ").split(/\s+/).filter((word) => word.length > 0).join(" ");
}

function leadingIndent(line: string): string {
  return /^\s*/.exec(line)?.[0] ?? "";
}

function listItemIndents(lines: readonly string[]): readonly string[] {
  return lines.flatMap((line) => {
    const match = /^(\s*)(?:[-*+]|\d+[.)])\s/.exec(line);
    return match === null ? [] : [match[1] ?? ""];
  });
}
