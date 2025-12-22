import type { InvocationToken } from "@skillset/types";
import { normalizeTokenRef } from "../normalize";

// Match: $[(skill|set):]<ref>[:ref]* (ref segments allow mixed case/underscores)
// Capture groups: 1=kind (optional), 2=full ref
const TOKEN_REGEX =
  /\$(?:(skill|set):)?([A-Za-z0-9_][A-Za-z0-9_-]*(?::[A-Za-z0-9_][A-Za-z0-9_-]*)*)/gi;

function isBoundary(char: string | undefined): boolean {
  return char === undefined || /[\s[{(<"'`.,;!?)]/.test(char);
}

function isAfterBoundary(char: string | undefined): boolean {
  // After a token, colon is NOT a valid boundary (it could be $set: which is invalid)
  return char === undefined || /[\s[{(<"'`.,;!?)\]]/.test(char);
}

export function tokenizePrompt(prompt: string): InvocationToken[] {
  const tokens: InvocationToken[] = [];
  // Skip fenced code blocks and inline code
  const segments = stripCodeBlocks(prompt);
  for (const segment of segments) {
    TOKEN_REGEX.lastIndex = 0;
    let match: RegExpExecArray | null = TOKEN_REGEX.exec(segment.text);
    while (match !== null) {
      const start = match.index;
      const end = start + match[0].length;
      const before = segment.text[start - 1];
      const after = segment.text[end];
      if (!(isBoundary(before) && isAfterBoundary(after))) {
        match = TOKEN_REGEX.exec(segment.text);
        continue;
      }
      const kindRaw = match[1]; // Capture group 1: kind
      const kind = kindRaw
        ? (kindRaw.toLowerCase() as "skill" | "set")
        : undefined;
      const captured = match[2]; // Capture group 2: full ref
      if (!captured) {
        match = TOKEN_REGEX.exec(segment.text);
        continue;
      }
      const normalizedRef = normalizeTokenRef(captured);
      if (!normalizedRef) {
        match = TOKEN_REGEX.exec(segment.text);
        continue;
      }
      const parts = normalizedRef.split(":").filter(Boolean);
      const maybeNamespace = parts.length > 1 ? parts[0] : undefined;
      const maybeAlias = parts.length > 1 ? parts.slice(1).join(":") : parts[0];
      if (!maybeAlias) {
        match = TOKEN_REGEX.exec(segment.text);
        continue;
      }
      const normalizedNamespace = maybeNamespace;
      const normalizedAlias = maybeAlias;
      if (!normalizedAlias) {
        match = TOKEN_REGEX.exec(segment.text);
        continue;
      }

      const token: InvocationToken = {
        raw: match[0],
        alias: normalizedAlias,
        namespace: normalizedNamespace,
      };
      if (kind) {
        token.kind = kind;
      }
      tokens.push(token);
      match = TOKEN_REGEX.exec(segment.text);
    }
  }
  return tokens;
}

interface Segment {
  text: string;
}

function stripCodeBlocks(input: string): Segment[] {
  const lines = input.split(/\r?\n/);
  const segments: Segment[] = [];
  let inFence = false;
  let fenceMarker = "```";
  let buffer: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    const fenceMatch = trimmed.match(/^(?:```+|~~~+)/);

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
        fenceMarker = fence;
      }
      continue;
    }

    if (inFence) continue;

    buffer.push(stripInlineCode(line));
  }

  if (buffer.length) segments.push({ text: buffer.join("\n") });
  return segments;
}

function stripInlineCode(line: string): string {
  let processed = "";
  let inInline = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === "`") {
      inInline = !inInline;
      processed += " ";
      continue;
    }
    processed += inInline ? " " : char;
  }
  return processed;
}
