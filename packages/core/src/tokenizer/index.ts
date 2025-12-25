import type { InvocationToken } from "@skillset/types";
import { normalizeTokenRef } from "../normalize";

// Match: $[(skill|set):]<ref>[:ref]* (ref segments allow mixed case/underscores)
// Capture groups: 1=kind (optional), 2=full ref
const TOKEN_REGEX =
  /\$(?:(skill|set):)?([A-Za-z0-9_][A-Za-z0-9_-]*(?::[A-Za-z0-9_][A-Za-z0-9_-]*)*)/gi;
const BOUNDARY_REGEX = /[\s[{(<"'`.,;!?)]/;
const AFTER_BOUNDARY_REGEX = /[\s[{(<"'`.,;!?)\]]/;
const LINE_SPLIT_REGEX = /\r?\n/;
const FENCE_REGEX = /^(?:```+|~~~+)/;

function isBoundary(char: string | undefined): boolean {
  return char === undefined || BOUNDARY_REGEX.test(char);
}

function isAfterBoundary(char: string | undefined): boolean {
  // After a token, colon is NOT a valid boundary (it could be $set: which is invalid)
  return char === undefined || AFTER_BOUNDARY_REGEX.test(char);
}

function parseTokenKind(
  kindRaw: string | undefined
): "skill" | "set" | undefined {
  if (!kindRaw) {
    return undefined;
  }
  const lower = kindRaw.toLowerCase();
  if (lower === "skill" || lower === "set") {
    return lower;
  }
  return undefined;
}

function buildToken(
  match: RegExpExecArray,
  text: string
): InvocationToken | undefined {
  const start = match.index;
  const end = start + match[0].length;
  const before = text[start - 1];
  const after = text[end];
  if (!(isBoundary(before) && isAfterBoundary(after))) {
    return undefined;
  }
  const captured = match[2]; // Capture group 2: full ref
  if (!captured) {
    return undefined;
  }
  const normalizedRef = normalizeTokenRef(captured);
  if (!normalizedRef) {
    return undefined;
  }
  const parts = normalizedRef.split(":").filter(Boolean);
  const maybeNamespace = parts.length > 1 ? parts[0] : undefined;
  const maybeAlias = parts.length > 1 ? parts.slice(1).join(":") : parts[0];
  if (!maybeAlias) {
    return undefined;
  }

  const token: InvocationToken = {
    raw: match[0],
    alias: maybeAlias,
    namespace: maybeNamespace,
  };
  const kind = parseTokenKind(match[1]);
  if (kind) {
    token.kind = kind;
  }
  return token;
}

export function tokenizePrompt(prompt: string): InvocationToken[] {
  const tokens: InvocationToken[] = [];
  // Skip fenced code blocks and inline code
  const segments = stripCodeBlocks(prompt);
  for (const segment of segments) {
    TOKEN_REGEX.lastIndex = 0;
    let match: RegExpExecArray | null = TOKEN_REGEX.exec(segment.text);
    while (match !== null) {
      const token = buildToken(match, segment.text);
      if (token) {
        tokens.push(token);
      }
      match = TOKEN_REGEX.exec(segment.text);
    }
  }
  return tokens;
}

interface Segment {
  text: string;
}

function stripCodeBlocks(input: string): Segment[] {
  const lines = input.split(LINE_SPLIT_REGEX);
  const segments: Segment[] = [];
  let inFence = false;
  let buffer: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    const fenceMatch = trimmed.match(FENCE_REGEX);

    if (fenceMatch) {
      const fence = fenceMatch[0];
      if (inFence) {
        // closing fence: flush buffer
        segments.push({ text: buffer.join("\n") });
        buffer = [];
        inFence = false;
        // allow trailing content after closing fence on the same line
        const remainder = line.slice(line.indexOf(fence) + fence.length);
        if (remainder.trim().length) {
          buffer.push(stripInlineCode(remainder));
        }
      } else {
        // opening fence
        inFence = true;
      }
      continue;
    }

    if (inFence) {
      continue;
    }

    buffer.push(stripInlineCode(line));
  }

  if (buffer.length) {
    segments.push({ text: buffer.join("\n") });
  }
  return segments;
}

function stripInlineCode(line: string): string {
  let processed = "";
  let inInline = false;
  for (const char of line) {
    if (char === "`") {
      inInline = !inInline;
      processed += " ";
      continue;
    }
    processed += inInline ? " " : char;
  }
  return processed;
}
