/**
 * Quote/depth-aware scanners for the bash command strings inside Claude
 * Code's `` !`command` `` pre-resolution placeholders.
 *
 * Ported from the reference implementation in compound-engineering-plugin's
 * tests/skill-shell-safety.test.ts (`hasTopLevelMixedAndOr`,
 * `findCommandSubstitutionContents`), which documents the Claude Code
 * permission-checker incidents behind each pattern (their issues #709/#710).
 */

export type TopLevelSeparator = ";" | "&&" | "||";

/**
 * Separators (`;`, `&&`, `||`) at the top lexical level of a command:
 * outside single/double quotes and outside `(...)` subshells and `$(...)`
 * command substitutions.
 */
export const findTopLevelSeparators = (
  command: string
): readonly TopLevelSeparator[] => {
  const found: TopLevelSeparator[] = [];
  let depth = 0;
  let inSingleQuote = false;
  let inDoubleQuote = false;

  for (let index = 0; index < command.length; index += 1) {
    const char = command[index];
    const next = command[index + 1];

    if (!inDoubleQuote && char === "'") {
      inSingleQuote = !inSingleQuote;
      continue;
    }
    if (!inSingleQuote && char === '"') {
      inDoubleQuote = !inDoubleQuote;
      continue;
    }
    if (inSingleQuote || inDoubleQuote) {
      continue;
    }

    if (char === "$" && next === "(") {
      depth += 1;
      index += 1;
      continue;
    }
    if (char === "(") {
      depth += 1;
      continue;
    }
    if (char === ")") {
      depth -= 1;
      continue;
    }
    if (depth !== 0) {
      continue;
    }

    if (char === ";") {
      found.push(";");
      continue;
    }
    if (char === "&" && next === "&") {
      found.push("&&");
      index += 1;
      continue;
    }
    if (char === "|" && next === "|") {
      found.push("||");
      index += 1;
    }
  }

  return found;
};

/**
 * True when both `&&` and `||` appear at the same top lexical depth — the
 * `[A] && B || C` shape Claude Code rejects as "ambiguous syntax with
 * command separators". `(A && B) || C` is fine.
 */
export const hasTopLevelMixedAndOr = (command: string): boolean => {
  const separators = findTopLevelSeparators(command);
  return separators.includes("&&") && separators.includes("||");
};

/**
 * True when a lone `;` separator appears at the top lexical depth. A `;`
 * inside a `(...)` subshell is not flagged: wrapping a multi-statement
 * chain in a subshell is the documented fix shape (compound-engineering
 * ships `(top=$(...); ...) || echo fallback` in production skills).
 */
export const hasTopLevelSemicolon = (command: string): boolean =>
  findTopLevelSeparators(command).includes(";");

/**
 * Contents of every top-level `$(...)` in the command, with parens matched
 * correctly even when nested. Only single quotes suppress detection
 * (matching the reference implementation): the canonical offender
 * `basename "$(dirname "$common")"` places `$(` inside a double-quoted
 * string, so double quotes must not hide substitutions.
 */
export const findCommandSubstitutions = (
  command: string
): readonly string[] => {
  const results: string[] = [];
  let index = 0;
  let inSingleQuote = false;

  while (index < command.length) {
    const char = command[index];
    if (char === "'") {
      inSingleQuote = !inSingleQuote;
      index += 1;
      continue;
    }
    if (inSingleQuote) {
      index += 1;
      continue;
    }
    if (char === "$" && command[index + 1] === "(") {
      let depth = 1;
      let scan = index + 2;
      const start = scan;
      while (scan < command.length && depth > 0) {
        if (command[scan] === "$" && command[scan + 1] === "(") {
          depth += 1;
          scan += 2;
          continue;
        }
        if (command[scan] === "(") {
          depth += 1;
          scan += 1;
          continue;
        }
        if (command[scan] === ")") {
          depth -= 1;
          scan += 1;
          continue;
        }
        scan += 1;
      }
      results.push(command.slice(start, Math.max(start, scan - 1)));
      index = scan;
      continue;
    }
    index += 1;
  }

  return results;
};
