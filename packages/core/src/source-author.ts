import {
  readSourceAuthorName,
  readSourceAuthorRecord,
} from "@skillset/schema";

import type { JsonRecord, JsonValue } from "./types";

const CLAUDE_AUTHOR_KEYS = ["name", "email", "url"] as const;

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
  const author = readAuthorRecord(value);
  if (author === undefined || typeof author.name !== "string") return undefined;
  return Object.fromEntries(
    CLAUDE_AUTHOR_KEYS.flatMap((key) =>
      typeof author[key] === "string" ? [[key, author[key]]] : []
    )
  );
}

export function omittedClaudeAuthorKeys(
  value: JsonValue | undefined
): readonly string[] {
  const author = readAuthorRecord(value);
  if (author === undefined) return [];
  const supported = new Set<string>(CLAUDE_AUTHOR_KEYS);
  return Object.keys(author).filter((key) => !supported.has(key)).sort();
}
