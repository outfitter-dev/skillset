import YAML, { isMap, isScalar, type Document, type Pair } from "yaml";

import type { JsonRecord, JsonValue, MarkdownParts } from "./types";
import { isJsonRecord, stripUndefined } from "./yaml";

export type SourceDocumentUpdate = (
  current: JsonRecord
) => JsonRecord;

/**
 * Updates an authored YAML document by replacing only changed AST nodes.
 * The serializer may normalize presentation, so this is not a byte-preserving
 * formatter. Generated and normalized output must continue to use
 * `stringifyYaml`.
 */
export function updateYamlSourceDocument(
  source: string,
  label: string,
  update: SourceDocumentUpdate
): string {
  const document = parseSourceDocument(source, label);
  const current = sourceRecord(document, label);
  const next = stripUndefined(update(current));
  if (jsonValuesEqual(current, next)) return source;

  reconcileRecord(document, [], current, next);
  moveRootSkillsetFirst(document);
  return document.toString({ lineWidth: 0 });
}

/** Renders newly-created authored YAML while retaining insertion order. */
export function stringifyYamlSourceDocument(value: JsonRecord): string {
  const document = new YAML.Document(stripUndefined(value));
  moveRootSkillsetFirst(document);
  return document.toString({ lineWidth: 0 });
}

/**
 * Updates Markdown frontmatter and/or body while keeping an untouched
 * frontmatter block verbatim. This is deliberately an authored-source helper.
 */
export function updateMarkdownSourceDocument(
  source: string,
  label: string,
  update: (current: MarkdownParts) => MarkdownParts
): string {
  if (!/^---(?:\r\n|\n|\r)/u.test(source)) {
    const current: MarkdownParts = {
      body: source.replaceAll(/\r\n?/g, "\n"),
      frontmatter: {},
    };
    const next = update(current);
    const frontmatterChanged = !jsonValuesEqual(current.frontmatter, next.frontmatter);
    const bodyChanged = current.body !== next.body;
    if (!frontmatterChanged && !bodyChanged) return source;
    const body = next.body.replaceAll(/\r\n?/g, "\n").replace(/^\n+/, "").trimEnd();
    if (!frontmatterChanged) return `${body}\n`;
    return `---\n${stringifyYamlSourceDocument(next.frontmatter).trimEnd()}\n---\n\n${body}\n`;
  }
  const framing = markdownFraming(source, label);
  const document = parseSourceDocument(framing.frontmatter, label);
  const current: MarkdownParts = {
    body: framing.body.replaceAll(/\r\n?/g, "\n"),
    frontmatter: sourceRecord(document, label),
  };
  const next = update(current);
  const updatedFrontmatter = updateYamlSourceDocument(
    framing.frontmatter,
    label,
    () => next.frontmatter
  );
  const bodyChanged = next.body !== current.body;
  if (updatedFrontmatter === framing.frontmatter && !bodyChanged) return source;

  const frontmatterChanged = updatedFrontmatter !== framing.frontmatter;
  const frontmatter = !frontmatterChanged
    ? framing.frontmatter
    : updatedFrontmatter.trimEnd().replaceAll("\n", framing.eol);
  const closing = !frontmatterChanged
    ? framing.closing
    : `${frontmatter === "" ? "" : framing.delimiterEol || framing.eol}---${framing.trailingEol}`;
  const body = bodyChanged
    ? `${next.body.replaceAll(/\r\n?/g, "\n").replace(/^\n+/, "").trimEnd()}\n`
    : framing.body;
  return `${framing.opening}${frontmatter}${closing}${bodyChanged ? framing.bodySeparator : ""}${body}`;
}

function parseSourceDocument(source: string, label: string): Document.Parsed {
  const document = YAML.parseDocument(source);
  if (document.errors.length > 0) {
    throw new Error(
      `skillset: ${label} is not valid YAML: ${document.errors[0]?.message ?? "unknown error"}`
    );
  }
  return document;
}

function sourceRecord(document: Document.Parsed, label: string): JsonRecord {
  const value = document.toJS() as unknown;
  if (value === null) return {};
  if (!isJsonRecord(value)) {
    throw new Error(`skillset: expected ${label} to contain a YAML object`);
  }
  return value;
}

function reconcileRecord(
  document: Document.Parsed,
  path: readonly string[],
  current: JsonRecord,
  next: JsonRecord
): void {
  for (const key of Object.keys(current)) {
    if (!(key in next)) document.deleteIn([...path, key]);
  }
  for (const [key, nextValue] of Object.entries(next)) {
    if (nextValue === undefined) continue;
    const currentValue = current[key];
    if (isJsonRecord(currentValue) && isJsonRecord(nextValue)) {
      reconcileRecord(document, [...path, key], currentValue, nextValue);
      continue;
    }
    if (!jsonValuesEqual(currentValue, nextValue)) {
      document.setIn([...path, key], nextValue);
    }
  }
}

function moveRootSkillsetFirst(document: Document): void {
  if (!isMap(document.contents)) return;
  const index = document.contents.items.findIndex((pair) => pairKey(pair) === "skillset");
  if (index <= 0) return;
  const [skillset] = document.contents.items.splice(index, 1);
  if (skillset !== undefined) document.contents.items.unshift(skillset);
}

function pairKey(pair: Pair): string | undefined {
  if (isScalar(pair.key) && typeof pair.key.value === "string") return pair.key.value;
  return undefined;
}

function jsonValuesEqual(left: JsonValue | undefined, right: JsonValue | undefined): boolean {
  if (left === right) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => jsonValuesEqual(value, right[index]));
  }
  if (isJsonRecord(left) || isJsonRecord(right)) {
    if (!isJsonRecord(left) || !isJsonRecord(right)) return false;
    const leftKeys = Object.keys(left).filter((key) => left[key] !== undefined);
    const rightKeys = Object.keys(right).filter((key) => right[key] !== undefined);
    return leftKeys.length === rightKeys.length &&
      leftKeys.every((key) => key in right && jsonValuesEqual(left[key], right[key]));
  }
  return false;
}

interface MarkdownFraming {
  readonly body: string;
  readonly bodySeparator: string;
  readonly closing: string;
  readonly delimiterEol: string;
  readonly eol: string;
  readonly frontmatter: string;
  readonly opening: string;
  readonly trailingEol: string;
}

function markdownFraming(source: string, label: string): MarkdownFraming {
  const opening = source.match(/^---(\r\n|\n|\r)/u);
  if (opening === null) {
    throw new Error(`skillset: ${label} requires Markdown frontmatter`);
  }
  const eol = opening[1] ?? "\n";
  const frontmatterStart = opening[0].length;
  const closingPattern = /^---(?=\r\n|\n|\r|$)/gmu;
  closingPattern.lastIndex = frontmatterStart;
  const closingMatch = closingPattern.exec(source);
  if (closingMatch === null) {
    throw new Error(`skillset: frontmatter in ${label} starts with --- but never closes`);
  }
  const closingStart = closingMatch.index;
  const precedingEol = source.slice(0, closingStart).match(/(\r\n|\n|\r)$/u)?.[0] ?? "";
  const hasFrontmatterContent = closingStart > frontmatterStart;
  const delimiterEol = hasFrontmatterContent ? precedingEol : "";
  const frontmatterEnd = hasFrontmatterContent ? closingStart - precedingEol.length : closingStart;
  const closingLineEnd = closingStart + 3;
  const trailingEol = source.slice(closingLineEnd).match(/^(\r\n|\n|\r)/u)?.[0] ?? "";
  return {
    body: source.slice(closingLineEnd + trailingEol.length),
    bodySeparator: trailingEol || eol,
    closing: `${delimiterEol}---${trailingEol}`,
    delimiterEol,
    eol,
    frontmatter: source.slice(frontmatterStart, frontmatterEnd),
    opening: opening[0],
    trailingEol,
  };
}
