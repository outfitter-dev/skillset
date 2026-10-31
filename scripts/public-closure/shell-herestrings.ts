import type Parser from "tree-sitter";
import { commandName } from "./shell-operands";
import { readShellSegments } from "./shell-tokens";
import { unwrapShellCommand } from "./shell-wrappers";

// Shared recognition does not imply that every interpreter uses shell grammar.
export const STDIN_INTERPRETERS = new Set([
  "bash", "bun", "dash", "ksh", "node", "perl", "python", "python3", "ruby", "sh", "zsh",
]);
const LITERAL_SHELL_INTERPRETERS = new Set(["bash", "dash", "sh"]);

interface Payload {
  readonly boundaryMap: readonly number[];
  readonly dialect: "bash" | "sh";
  readonly endIndex: number;
  readonly startIndex: number;
  readonly text: string;
}
interface InputIssue {
  readonly endIndex: number;
  readonly message: string;
  readonly startIndex: number;
}
export interface HereStringAnalysis {
  readonly issues: readonly InputIssue[];
  readonly payloads: readonly Payload[];
}

/** Recognize direct literal stdin programs without evaluating expansions or wrappers. */
export function literalHereStringInputs(root: Parser.SyntaxNode): HereStringAnalysis {
  const issues: InputIssue[] = [];
  const payloads: Payload[] = [];
  for (const redirect of root.descendantsOfType("herestring_redirect")) {
    const owner = redirect.parent;
    if (owner?.type !== "command") continue;
    const tokens = readShellSegments(owner.text)[0] ?? [];
    const unwrapped = unwrapShellCommand(tokens);
    const name = commandName(unwrapped[0]);
    if (!STDIN_INTERPRETERS.has(name)) continue;
    const unsupported = (reason: string): void => {
      issues.push({ startIndex: redirect.startIndex, endIndex: redirect.endIndex,
        message: `here-string input analysis is bounded: ${reason}` });
    };
    if (tokens.length !== unwrapped.length) {
      unsupported("interpreter wrappers and their working-directory or environment effects are not interpreted");
      continue;
    }
    if (!LITERAL_SHELL_INTERPRETERS.has(name)) {
      unsupported(`${name} stdin semantics are outside the literal Bash/POSIX-shell scanner`);
      continue;
    }
    const prefix = owner.text.slice(0, redirect.startIndex - owner.startIndex);
    if (/\d$/u.test(prefix)) {
      unsupported("explicit file-descriptor here-string syntax is not modeled");
      continue;
    }
    const args = unwrapped.slice(1);
    // -c and a script operand do not select the here-string as the shell program.
    if (args[0] === "-c" || (args[0] !== undefined && !args[0].startsWith("-"))) continue;
    if (args.length > 0 && !(args.length === 1 && args[0] === "-s")) {
      unsupported("only a bare interpreter or its -s stdin form is supported");
      continue;
    }
    if (owner.parent?.type === "redirected_statement" || owner.namedChildren.filter((node) => node.type.endsWith("redirect")).length !== 1) {
      unsupported("multiple or enclosing redirects do not establish a unique stdin program");
      continue;
    }
    const input = redirect.namedChildren[0];
    if (input === undefined || !["raw_string", "string"].includes(input.type)) {
      unsupported("the stdin program must be one single- or double-quoted literal");
      continue;
    }
    const quote = input.type === "raw_string" ? "'" : '"';
    if (input.hasError || !input.text.startsWith(quote) || !input.text.endsWith(quote)) {
      unsupported("the quoted stdin program is incomplete or recovered syntax");
      continue;
    }
    if (input.type === "string" && input.namedChildren.some((node) => node.type !== "string_content")) {
      unsupported("expanded stdin text is dynamic; outer substitutions are scanned separately");
      continue;
    }
    const body = input.text.slice(1, -1);
    const decoded = input.type === "raw_string" ? {
      boundaryMap: Array.from({ length: body.length + 1 }, (_, index) => index), text: body,
    } : decodeDoubleQuoted(body);
    payloads.push({ ...decoded, dialect: name === "bash" ? "bash" : "sh",
      startIndex: input.startIndex + 1, endIndex: input.endIndex - 1 });
  }
  return { issues, payloads };
}

/** Shell double quotes remove only these escapes; other backslashes survive. */
function decodeDoubleQuoted(source: string): { readonly boundaryMap: readonly number[]; readonly text: string } {
  let text = "";
  const boundaryMap = [0];
  for (let index = 0; index < source.length;) {
    const next = source[index + 1];
    if (source[index] === "\\" && next === "\n") {
      index += 2;
      boundaryMap[boundaryMap.length - 1] = index;
    } else if (source[index] === "\\" && next !== undefined && "$`\\\"".includes(next)) {
      text += next;
      index += 2;
      boundaryMap.push(index);
    } else {
      text += source[index];
      index++;
      boundaryMap.push(index);
    }
  }
  return { boundaryMap, text };
}
