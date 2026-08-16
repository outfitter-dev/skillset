/**
 * Shell tokenization shared by every command grammar the public-closure guard
 * reads. Nothing here knows about protected owners; it only turns text into
 * command segments and reads operands fused into option tokens.
 */

export interface CommandToken {
  readonly end: number;
  readonly value: string;
}

const LITERAL_OPEN_BRACE = "\u{e000}";
const LITERAL_CLOSE_BRACE = "\u{e001}";

export function normalizeShellToken(token: string): string {
  return token.replace(/^\.\//u, "").replace(/\/+$/u, "");
}

/**
 * Replaces braces that shell quoting or escaping makes literal with private-use
 * placeholders, so brace-expansion reading cannot mistake them for alternation.
 */
function markLiteralShellBraces(text: string): string {
  return text.replace(/'(?:[^']*)'|"(?:\\.|[^"])*"|\\[{}]/gu, (literal) =>
    literal
      .replaceAll("\\{", LITERAL_OPEN_BRACE)
      .replaceAll("\\}", LITERAL_CLOSE_BRACE)
      .replaceAll("{", LITERAL_OPEN_BRACE)
      .replaceAll("}", LITERAL_CLOSE_BRACE)
  );
}

export function readCommandToken(
  text: string,
  offset: number
): CommandToken | null {
  let start = offset;
  while (/\s/u.test(text[start] ?? "")) start += 1;
  while (text[start] === "`") start += 1;
  let end = start;
  let value = "";
  let consumed = false;
  while (end < text.length) {
    const character = text[end] ?? "";
    if (/[\s`();,<>|&]/u.test(character)) break;
    if (character === '"' || character === "'") {
      const quote = character;
      consumed = true;
      end += 1;
      let closed = false;
      while (end < text.length) {
        const quotedCharacter = text[end] ?? "";
        if (quotedCharacter === quote) {
          closed = true;
          end += 1;
          break;
        }
        if (
          quote === '"' &&
          quotedCharacter === "\\" &&
          end + 1 < text.length &&
          /[$`"\\\n]/u.test(text[end + 1] ?? "")
        ) {
          end += 1;
          value += text[end];
        } else {
          value += quotedCharacter;
        }
        end += 1;
      }
      if (!closed) return null;
      continue;
    }
    if (character === "\\" && end + 1 < text.length) {
      end += 1;
      value += text[end];
    } else {
      value += character;
    }
    consumed = true;
    end += 1;
  }
  return consumed ? { end, value } : null;
}

function readShellCommandSegments(
  text: string
): readonly (readonly string[])[] {
  const segments: string[][] = [[]];
  let offset = 0;
  while (offset < text.length) {
    while (/\s/u.test(text[offset] ?? "")) offset += 1;
    if (
      (segments.at(-1)?.length ?? 0) === 0 &&
      text[offset] === ">" &&
      /\s/u.test(text[offset + 1] ?? "")
    ) {
      segments.at(-1)?.push(">");
      offset += 1;
      continue;
    }
    const boundary = /^(?:&&|\|\||[;&|])/u.exec(text.slice(offset));
    if (boundary) {
      if ((segments.at(-1)?.length ?? 0) > 0) segments.push([]);
      offset += boundary[0].length;
      continue;
    }
    const redirection = /^(?:\d+)?(?:<>|>&|<&|>>|<<|>|<)/u.exec(
      text.slice(offset)
    );
    if (redirection) {
      offset += redirection[0].length;
      const target = readCommandToken(text, offset);
      offset = target?.end ?? offset;
      continue;
    }
    const token = readCommandToken(text, offset);
    if (token) {
      segments.at(-1)?.push(token.value);
      offset = token.end;
    } else {
      offset += 1;
    }
  }
  return segments.filter((segment) => segment.length > 0);
}

/**
 * Reads command segments out of a raw command string, applying the literal
 * brace marking every grammar in this directory expects.
 */
export function readShellSegments(
  command: string
): readonly (readonly string[])[] {
  return readShellCommandSegments(markLiteralShellBraces(command));
}

/**
 * Finds the value-taking short flag inside a clustered token (`-rtdir`), and
 * reports whether its operand is fused into the same token.
 */
export function shortValueFlag(
  token: string,
  valueFlags: ReadonlySet<string>
):
  | {
      readonly attached: boolean;
      readonly flag: string;
      readonly valueStart: number;
    }
  | undefined {
  if (!/^-[^-]/u.test(token)) return undefined;
  for (let index = 1; index < token.length; index += 1) {
    const flag = `-${token[index] ?? ""}`;
    if (valueFlags.has(flag)) {
      return {
        attached: index + 1 < token.length,
        flag,
        valueStart: index + 1,
      };
    }
  }
  return undefined;
}

/**
 * Reads the operand fused into an option token, covering the attached long
 * (`--target-directory=dir`) and attached short (`-tdir`, including the bundled
 * `-rtdir`) spellings GNU option parsing accepts.
 */
export function attachedOptionValue(
  token: string,
  flags: ReadonlySet<string>
): string | undefined {
  if (token.startsWith("--")) {
    const separator = token.indexOf("=");
    if (separator <= 0 || !flags.has(token.slice(0, separator))) {
      return undefined;
    }
    const attached = token.slice(separator + 1);
    return attached.length > 0 ? attached : undefined;
  }
  const shortValue = shortValueFlag(token, flags);
  return shortValue?.attached === true
    ? token.slice(shortValue.valueStart)
    : undefined;
}
