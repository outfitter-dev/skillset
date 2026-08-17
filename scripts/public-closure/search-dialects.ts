import { pathMatchesOwner } from "./owner-paths";
import { isProtectedRootPathCommand } from "./path-commands";
import { readShellSegments, shortValueFlag } from "./shell-tokens";
import { unwrapShellCommand } from "./shell-wrappers";

/**
 * Search-tool grammars (`rg`, `grep`, `fd`). These tools share one shape —
 * `tool [options] pattern [path]...` — so they share one parser, and each tool
 * contributes only its option tables.
 */

interface SearchCommandDialect {
  readonly commandValueFlags: ReadonlySet<string>;
  readonly optionalAttachedValueFlags: ReadonlySet<string>;
  readonly pathOnlyFlags: ReadonlySet<string>;
  readonly pathValueFlags: ReadonlySet<string>;
  readonly patternValueFlags: ReadonlySet<string>;
  readonly valueFlags: ReadonlySet<string>;
}

/** What the caller needs to answer "does this operand reach the owner?". */
export interface SearchCommandOwner {
  /** False for owners whose bare name is also public plugin vocabulary. */
  readonly allowDirectOwner: boolean;
  /** Resolves a nested command (`fd --exec cat …`) through the full dispatch. */
  readonly matchesNestedCommand: (command: string) => boolean;
  readonly normalizedOwner: string;
  readonly repoRoot: string | undefined;
}

const RIPGREP_PATTERN_VALUE_FLAGS: ReadonlySet<string> = new Set([
  "--file",
  "--regexp",
  "-e",
  "-f",
]);
const RIPGREP_PATH_VALUE_FLAGS: ReadonlySet<string> = new Set([
  "--file",
  "--ignore-file",
  "-f",
]);
const RIPGREP_COMMAND_VALUE_FLAGS: ReadonlySet<string> = new Set([
  "--hostname-bin",
  "--pre",
]);
const RIPGREP_VALUE_FLAGS: ReadonlySet<string> = new Set([
  ...RIPGREP_PATTERN_VALUE_FLAGS,
  "--after-context",
  "--before-context",
  "--color",
  "--colors",
  "--context",
  "--context-separator",
  "--dfa-size-limit",
  "--encoding",
  "--engine",
  "--field-context-separator",
  "--field-match-separator",
  "--generate",
  "--glob",
  "--hostname-bin",
  "--hyperlink-format",
  "--iglob",
  "--ignore-file",
  "--max-columns",
  "--max-count",
  "--max-depth",
  "--max-filesize",
  "--path-separator",
  "--pre",
  "--pre-glob",
  "--regex-size-limit",
  "--replace",
  "--sort",
  "--sortr",
  "--threads",
  "--type",
  "--type-add",
  "--type-clear",
  "--type-not",
  "-A",
  "-B",
  "-C",
  "-d",
  "-E",
  "-g",
  "-j",
  "-m",
  "-M",
  "-r",
  "-t",
  "-T",
]);
const GREP_PATTERN_VALUE_FLAGS: ReadonlySet<string> = new Set([
  "--file",
  "--regexp",
  "-e",
  "-f",
]);
const GREP_PATH_VALUE_FLAGS: ReadonlySet<string> = new Set([
  "--exclude-from",
  "--file",
  "-f",
]);
const GREP_VALUE_FLAGS: ReadonlySet<string> = new Set([
  ...GREP_PATTERN_VALUE_FLAGS,
  "--after-context",
  "--before-context",
  "--binary-files",
  "--color",
  "--colour",
  "--context",
  "--devices",
  "--directories",
  "--exclude",
  "--exclude-dir",
  "--exclude-from",
  "--group-separator",
  "--include",
  "--label",
  "--max-count",
  "-A",
  "-B",
  "-C",
  "-d",
  "-D",
  "-m",
]);
// `fd --help` documents `fd [OPTIONS] [pattern] [path]...`, so fd shares the
// generic "first operand is the pattern, later operands are search roots"
// shape already used for grep and ripgrep.
const FD_PATTERN_VALUE_FLAGS: ReadonlySet<string> = new Set(["--and"]);
const FD_PATH_VALUE_FLAGS: ReadonlySet<string> = new Set([
  "--base-directory",
  "--ignore-file",
  "--search-path",
]);
const FD_COMMAND_VALUE_FLAGS: ReadonlySet<string> = new Set([
  "--exec",
  "--exec-batch",
  "-X",
  "-x",
]);
const FD_VALUE_FLAGS: ReadonlySet<string> = new Set([
  ...FD_COMMAND_VALUE_FLAGS,
  ...FD_PATH_VALUE_FLAGS,
  ...FD_PATTERN_VALUE_FLAGS,
  "--batch-size",
  "--changed-after",
  "--changed-before",
  "--changed-within",
  "--color",
  "--exact-depth",
  "--exclude",
  "--extension",
  "--format",
  "--max-depth",
  "--max-results",
  "--min-depth",
  "--newer",
  "--older",
  "--owner",
  "--path-separator",
  "--size",
  "--threads",
  "--type",
  "-c",
  "-d",
  "-E",
  "-e",
  "-j",
  "-o",
  "-S",
  "-t",
]);
const FD_SEARCH_COMMAND_DIALECT: SearchCommandDialect = {
  commandValueFlags: FD_COMMAND_VALUE_FLAGS,
  optionalAttachedValueFlags: new Set(),
  pathOnlyFlags: new Set(),
  pathValueFlags: FD_PATH_VALUE_FLAGS,
  patternValueFlags: FD_PATTERN_VALUE_FLAGS,
  valueFlags: FD_VALUE_FLAGS,
};
const SEARCH_COMMAND_DIALECTS: Readonly<Record<string, SearchCommandDialect>> =
  {
    fd: FD_SEARCH_COMMAND_DIALECT,
    fdfind: FD_SEARCH_COMMAND_DIALECT,
    grep: {
      commandValueFlags: new Set(),
      optionalAttachedValueFlags: new Set(["--color", "--colour"]),
      pathOnlyFlags: new Set(),
      pathValueFlags: GREP_PATH_VALUE_FLAGS,
      patternValueFlags: GREP_PATTERN_VALUE_FLAGS,
      valueFlags: GREP_VALUE_FLAGS,
    },
    rg: {
      commandValueFlags: RIPGREP_COMMAND_VALUE_FLAGS,
      optionalAttachedValueFlags: new Set(),
      pathOnlyFlags: new Set(["--files"]),
      pathValueFlags: RIPGREP_PATH_VALUE_FLAGS,
      patternValueFlags: RIPGREP_PATTERN_VALUE_FLAGS,
      valueFlags: RIPGREP_VALUE_FLAGS,
    },
  };

function searchCommandDialect(
  tokens: readonly string[]
): SearchCommandDialect | undefined {
  return SEARCH_COMMAND_DIALECTS[tokens[0]?.toLowerCase() ?? ""];
}

export function hasSearchCommandProtectedPathArgument(
  tokens: readonly string[],
  owner: SearchCommandOwner
): boolean {
  const dialect = searchCommandDialect(tokens);
  if (!dialect) return false;
  const { allowDirectOwner, normalizedOwner, repoRoot } = owner;
  const matchesPath = (value: string): boolean =>
    pathMatchesOwner(value, normalizedOwner, repoRoot, allowDirectOwner);
  let hasPattern = false;
  let pathsOnly = false;
  let parseOptions = true;

  for (let index = 1; index < tokens.length; index += 1) {
    const token = tokens[index] ?? "";
    if (parseOptions && token === "--") {
      parseOptions = false;
      continue;
    }
    if (parseOptions && token.startsWith("-") && token !== "-") {
      if (dialect.pathOnlyFlags.has(token)) {
        pathsOnly = true;
        continue;
      }
      const longFlag = token.split("=", 1)[0] ?? token;
      const shortValue = shortValueFlag(token, dialect.valueFlags);
      const valueFlag = dialect.valueFlags.has(token)
        ? token
        : dialect.valueFlags.has(longFlag)
          ? longFlag
          : shortValue?.flag;
      if (!valueFlag) continue;
      if (dialect.patternValueFlags.has(valueFlag)) hasPattern = true;
      const hasAttachedValue = token.startsWith("--")
        ? token.includes("=")
        : shortValue?.attached === true;
      if (
        dialect.optionalAttachedValueFlags.has(valueFlag) &&
        !hasAttachedValue
      ) {
        continue;
      }
      let operand: ReturnType<typeof readSearchCommandShellWord>;
      if (hasAttachedValue) {
        const value = token.startsWith("--")
          ? token.slice(token.indexOf("=") + 1)
          : token.slice(shortValue?.valueStart ?? token.length);
        operand = { lastIndex: index, values: [value] };
      } else {
        operand = readSearchCommandShellWord(tokens, index + 1);
      }
      if (!operand) return false;
      if (
        dialect.pathValueFlags.has(valueFlag) &&
        operand.values.some(matchesPath)
      ) {
        return true;
      }
      if (
        dialect.commandValueFlags.has(valueFlag) &&
        operand.values.some(
          (value) =>
            matchesPath(value) ||
            searchCommandValueMatchesOwner(value, owner) ||
            owner.matchesNestedCommand(value)
        )
      ) {
        return true;
      }
      if (!hasAttachedValue) {
        index = operand.lastIndex;
      }
      continue;
    }

    const operand = readSearchCommandShellWord(tokens, index);
    if (!operand) return false;
    index = operand.lastIndex;
    if (!(pathsOnly || hasPattern)) {
      hasPattern = true;
      continue;
    }
    if (operand.values.some(matchesPath)) return true;
  }
  return false;
}

/**
 * Reads a path-command operand out of a nested command string, for the
 * `--exec` family whose operand is itself a command line.
 */
function searchCommandValueMatchesOwner(
  command: string,
  owner: SearchCommandOwner
): boolean {
  return readShellSegments(command).some((segment) => {
    const tokens = unwrapShellCommand(segment);
    return (
      isProtectedRootPathCommand(tokens[0]?.toLowerCase() ?? "") &&
      tokens
        .slice(1)
        .some((token) =>
          pathMatchesOwner(
            token,
            owner.normalizedOwner,
            owner.repoRoot,
            owner.allowDirectOwner
          )
        )
    );
  });
}

/**
 * Reads one shell word starting at `index`, expanding a brace alternation that
 * the tokenizer split across several tokens back into its alternatives.
 */
function readSearchCommandShellWord(
  tokens: readonly string[],
  index: number
):
  | { readonly lastIndex: number; readonly values: readonly string[] }
  | undefined {
  const first = tokens[index];
  if (first === undefined) return undefined;
  const opening = first.indexOf("{");
  if (opening < 0) return { lastIndex: index, values: [first] };

  let lastIndex = index;
  while (
    lastIndex < tokens.length &&
    !(tokens[lastIndex] ?? "").includes("}")
  ) {
    lastIndex += 1;
  }
  if (lastIndex >= tokens.length) return { lastIndex: index, values: [first] };
  const combined = tokens.slice(index, lastIndex + 1).join(",");
  const closing = combined.indexOf("}", opening + 1);
  if (closing < 0) return { lastIndex: index, values: [first] };
  const prefix = combined.slice(0, opening);
  const suffix = combined.slice(closing + 1);
  const alternatives = combined.slice(opening + 1, closing).split(",");
  return {
    lastIndex,
    values: alternatives.map(
      (alternative) => `${prefix}${alternative}${suffix}`
    ),
  };
}

/**
 * Collects the search-command segments in a text, so their operands are read by
 * the dialect parser rather than by the generic path scan.
 */
export function searchCommandSegments(
  text: string,
  assumeShellCommand: boolean
): readonly (readonly string[])[] {
  const commands = assumeShellCommand
    ? [text]
    : [...text.matchAll(/`([^`\r\n]+)`/gu)].map((match) => match[1] ?? "");
  return commands.flatMap((command) =>
    readShellSegments(command)
      .map(unwrapShellCommand)
      .filter((tokens) => searchCommandDialect(tokens) !== undefined)
  );
}

/**
 * Removes search-command segments from a text. Their operands are pattern
 * arguments as often as paths, so the generic path scan must not read them.
 */
export function withoutSearchCommandSegments(
  text: string,
  assumeShellCommand: boolean
): string {
  const withoutSegments = (command: string): string =>
    readShellSegments(command)
      .filter(
        (segment) =>
          searchCommandDialect(unwrapShellCommand(segment)) === undefined
      )
      .map((segment) => segment.join(" "))
      .join(" ");
  if (assumeShellCommand) return withoutSegments(text);
  return text.replace(/`([^`\r\n]+)`/gu, (wrapped, command: string) => {
    const remaining = withoutSegments(command);
    return remaining === command ? wrapped : remaining;
  });
}
