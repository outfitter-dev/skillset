import {
  readSourceAuthorName,
  readSourceAuthorRecord,
} from "@skillset/schema";

import type { JsonRecord, JsonValue } from "./types";

const CLAUDE_AUTHOR_KEYS = ["name", "email", "url"] as const;
const CODEX_AUTHOR_KEYS = ["name", "email", "url"] as const;
const CURSOR_AUTHOR_KEYS = ["name", "email"] as const;

export function readAuthorName(
  value: JsonValue | undefined
): string | undefined {
  return readSourceAuthorName(value);
}

export function readAuthorRecord(
  value: JsonValue | undefined
): JsonRecord | undefined {
  return readSourceAuthorRecord(value) as JsonRecord | undefined;
}

export function renderClaudeAuthor(
  value: JsonValue | undefined
): JsonRecord | undefined {
  return renderAuthor(value, CLAUDE_AUTHOR_KEYS);
}

export function renderCodexAuthor(
  value: JsonValue | undefined
): JsonRecord | undefined {
  return renderAuthor(value, CODEX_AUTHOR_KEYS);
}

export function renderCursorAuthor(
  value: JsonValue | undefined
): JsonRecord | undefined {
  return renderAuthor(value, CURSOR_AUTHOR_KEYS);
}

function renderAuthor(
  value: JsonValue | undefined,
  keys: readonly string[]
): JsonRecord | undefined {
  const author = readAuthorRecord(value);
  if (author === undefined || typeof author.name !== "string") return undefined;
  return Object.fromEntries(
    keys.flatMap((key) =>
      typeof author[key] === "string" ? [[key, author[key]]] : []
    )
  );
}

/**
 * Canonical author keys the destination supports but the emitted author record
 * does not carry. A `claude.marketplace` override can keep an entry's identity
 * while replacing its author, so a supported field such as `email` can still be
 * dropped; comparing against the author actually emitted is what makes that
 * loss visible, where the supported-key list alone reports none.
 *
 * An entry that emits no author record at all is not a partial loss and is not
 * reported here: the override supplied the whole entry shape, and the author it
 * left out is the entry's own metadata rather than a field the projection
 * silently discarded.
 */
export function droppedClaudeAuthorKeys(
  value: JsonValue | undefined,
  emitted: JsonValue | undefined
): readonly string[] {
  const author = readAuthorRecord(value);
  const rendered = readAuthorRecord(emitted);
  if (author === undefined || rendered === undefined) return [];
  return CLAUDE_AUTHOR_KEYS.filter(
    (key) => typeof author[key] === "string" && rendered[key] !== author[key]
  );
}

export function omittedClaudeAuthorKeys(
  value: JsonValue | undefined
): readonly string[] {
  return omittedAuthorKeys(value, CLAUDE_AUTHOR_KEYS);
}

export function omittedCursorAuthorKeys(
  value: JsonValue | undefined
): readonly string[] {
  return omittedAuthorKeys(value, CURSOR_AUTHOR_KEYS);
}

function omittedAuthorKeys(
  value: JsonValue | undefined,
  keys: readonly string[]
): readonly string[] {
  const author = readAuthorRecord(value);
  if (author === undefined) return [];
  const supported = new Set(keys);
  return Object.keys(author).filter((key) => !supported.has(key)).sort();
}
