import type { InvocationToken } from "@skillset/types";

const TOKEN_REGEX = /\bw\/([a-zA-Z0-9_-]+(?::[a-zA-Z0-9_-]+)?)/g;

function isBoundary(char: string | undefined): boolean {
  return char === undefined || /[\s[{(<"'`.,;:!?)]/.test(char);
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
      if (!(isBoundary(before) && isBoundary(after))) {
        match = TOKEN_REGEX.exec(segment.text);
        continue;
      }
      const captured = match[1];
      if (!captured) {
        match = TOKEN_REGEX.exec(segment.text);
        continue;
      }
      const [maybeNamespace, maybeAlias] = captured.includes(":")
        ? captured.split(":")
        : [undefined, captured];
      tokens.push({
        raw: match[0],
        alias: maybeAlias ?? captured,
        namespace: maybeNamespace,
      });
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
