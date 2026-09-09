import Parser from "tree-sitter";
import Bash from "tree-sitter-bash";

export type ShellDialect = "bash" | "sh" | "shell" | "zsh";
export type ShellDialectSupport =
  | "bash"
  | "generic-bash"
  | "posix-subset"
  | "unsupported-zsh";
export type NestedShellCommandKind =
  | "command"
  | "legacy-command"
  | "process-input"
  | "process-output";
export type ShellSyntaxIssueKind =
  | "missing-syntax"
  | "parse-error"
  | "unsupported-dialect";

export interface ShellSourcePosition {
  /** Zero-based UTF-8 byte column, matching Tree-sitter's native contract. */
  readonly column: number;
  /** Zero-based UTF-8 byte offset. */
  readonly offset: number;
  /** Zero-based line, matching Tree-sitter. */
  readonly row: number;
}

export interface ShellSourceRange {
  readonly end: ShellSourcePosition;
  readonly start: ShellSourcePosition;
}

export interface NestedShellCommand {
  /** This body's descendant substitutions are masked and scanned separately. */
  readonly command: string;
  readonly kind: NestedShellCommandKind;
  readonly source: ShellSourceRange;
}

export interface ShellSyntaxIssue {
  readonly kind: ShellSyntaxIssueKind;
  readonly message: string;
  readonly source: ShellSourceRange;
}

export interface ShellStatement {
  readonly command: string;
  readonly source: ShellSourceRange;
}

export interface ShellNestingAnalysis {
  /** Top-level source with every executed substitution replaced by a neutral token. */
  readonly directCommand: string;
  readonly dialectSupport: ShellDialectSupport;
  readonly nestedCommands: readonly NestedShellCommand[];
  readonly syntaxIssues: readonly ShellSyntaxIssue[];
}

let bashParser: Parser | undefined;

function parser(): Parser {
  if (bashParser) return bashParser;
  try {
    bashParser = new Parser();
    bashParser.setLanguage(Bash);
    return bashParser;
  } catch (error) {
    throw new Error(
      "skillset: public closure could not initialize the native Tree-sitter Bash parser; reinstall development dependencies for this platform",
      { cause: error }
    );
  }
}

function parseShell(command: string): Parser.Tree {
  try {
    return parser().parse(command);
  } catch (error) {
    throw new Error(
      "skillset: public closure native shell parsing failed; verify Tree-sitter development dependencies",
      { cause: error }
    );
  }
}

function dialectSupport(dialect: ShellDialect): ShellDialectSupport {
  if (dialect === "bash") return "bash";
  if (dialect === "sh") return "posix-subset";
  if (dialect === "zsh") return "unsupported-zsh";
  return "generic-bash";
}

function sourcePosition(source: string, index: number): ShellSourcePosition {
  const prefix = source.slice(0, index);
  const lineStart = prefix.lastIndexOf("\n") + 1;
  return {
    column: Buffer.byteLength(prefix.slice(lineStart), "utf8"),
    offset: Buffer.byteLength(prefix, "utf8"),
    row: prefix.split("\n").length - 1,
  };
}

function sourceRange(
  source: string,
  start: number,
  end: number
): ShellSourceRange {
  return {
    end: sourcePosition(source, end),
    start: sourcePosition(source, start),
  };
}

function utf16IndexAtByteOffset(source: string, byteOffset: number): number {
  let bytes = 0;
  let index = 0;
  while (index < source.length && bytes < byteOffset) {
    const codePoint = source.codePointAt(index);
    if (codePoint === undefined) break;
    const character = String.fromCodePoint(codePoint);
    bytes += Buffer.byteLength(character, "utf8");
    index += character.length;
  }
  return index;
}

function unescapeLegacyBackticks(source: string): {
  readonly boundaryMap: readonly number[];
  readonly text: string;
} {
  const boundaryMap = [0];
  let text = "";
  let index = 0;
  while (index < source.length) {
    if (source[index] === "\\" && source[index + 1] === "`") {
      text += "`";
      index += 2;
    } else {
      text += source[index] ?? "";
      index += 1;
    }
    boundaryMap.push(index);
  }
  return { boundaryMap, text };
}

function remapRange(
  range: ShellSourceRange,
  transformed: string,
  boundaryMap: readonly number[],
  originalStart: number,
  originalSource: string
): ShellSourceRange {
  const start =
    originalStart +
    (boundaryMap[utf16IndexAtByteOffset(transformed, range.start.offset)] ?? 0);
  const end =
    originalStart +
    (boundaryMap[utf16IndexAtByteOffset(transformed, range.end.offset)] ?? 0);
  return sourceRange(originalSource, start, end);
}

function substitutionKind(
  source: string,
  node: Parser.SyntaxNode
): {
  readonly closeWidth: number;
  readonly kind: NestedShellCommandKind;
  readonly openWidth: number;
} {
  const opening = source.slice(
    node.startIndex,
    Math.min(node.startIndex + 2, node.endIndex)
  );
  if (opening.startsWith("$("))
    return { closeWidth: 1, kind: "command", openWidth: 2 };
  if (opening.startsWith("<("))
    return { closeWidth: 1, kind: "process-input", openWidth: 2 };
  if (opening.startsWith(">("))
    return { closeWidth: 1, kind: "process-output", openWidth: 2 };
  return { closeWidth: 1, kind: "legacy-command", openWidth: 1 };
}

function maskRanges(
  source: string,
  start: number,
  end: number,
  ranges: readonly { readonly endIndex: number; readonly startIndex: number }[]
): string {
  let direct = source.slice(start, end);
  for (const range of ranges.toSorted(
    (left, right) => right.startIndex - left.startIndex
  )) {
    const rangeStart = Math.max(start, range.startIndex) - start;
    const rangeEnd = Math.min(end, range.endIndex) - start;
    if (rangeStart < rangeEnd)
      direct =
        direct.slice(0, rangeStart) +
        "x" +
        " ".repeat(rangeEnd - rangeStart - 1) +
        direct.slice(rangeEnd);
  }
  return direct;
}

function hasSubstitutionAncestor(node: Parser.SyntaxNode): boolean {
  let parent = node.parent;
  while (parent) {
    if (
      parent.type === "command_substitution" ||
      parent.type === "process_substitution"
    )
      return true;
    parent = parent.parent;
  }
  return false;
}

function relevantSyntaxNode(node: Parser.SyntaxNode): boolean {
  return hasSubstitutionAncestor(node) || /\$\(|[<>]\(|`/u.test(node.text);
}

function syntaxIssues(
  root: Parser.SyntaxNode,
  source: string
): readonly ShellSyntaxIssue[] {
  const issues: ShellSyntaxIssue[] = [];
  const visit = (node: Parser.SyntaxNode): void => {
    if (node.isMissing && relevantSyntaxNode(node)) {
      issues.push({
        kind: "missing-syntax",
        message: `Tree-sitter inserted missing ${JSON.stringify(node.type)} inside nested shell syntax`,
        source: sourceRange(source, node.startIndex, node.endIndex),
      });
    } else if (node.type === "ERROR" && relevantSyntaxNode(node)) {
      issues.push({
        kind: "parse-error",
        message: "Tree-sitter recovered from unrecognized nested shell syntax",
        source: sourceRange(source, node.startIndex, node.endIndex),
      });
    }
    for (const child of node.children) visit(child);
  };
  visit(root);
  return issues;
}

export function analyzeShellNesting(
  command: string,
  dialect: ShellDialect = "bash"
): ShellNestingAnalysis {
  const source = command;
  const root = parseShell(command).rootNode;
  const nodes = root.descendantsOfType([
    "command_substitution",
    "process_substitution",
  ]);
  const heredocBodies = root.descendantsOfType("heredoc_body");
  const entries = nodes.map((node) => {
    const { closeWidth, kind, openWidth } = substitutionKind(source, node);
    const start = node.startIndex + openWidth;
    const end = Math.max(start, node.endIndex - closeWidth);
    const descendants = [...nodes, ...heredocBodies].filter(
      (candidate) =>
        candidate !== node &&
        candidate.startIndex >= start &&
        candidate.endIndex <= end
    );
    return {
      bodyStart: start,
      nested: {
        command: maskRanges(source, start, end, descendants),
        kind,
        source: sourceRange(source, start, end),
      } satisfies NestedShellCommand,
    };
  });
  const issues = [...syntaxIssues(root, source)];
  const escapedLegacyCommands: NestedShellCommand[] = [];
  for (const { bodyStart, nested } of entries) {
    if (nested.kind !== "legacy-command" || !nested.command.includes("\\`"))
      continue;
    const { boundaryMap, text } = unescapeLegacyBackticks(nested.command);
    const legacyAnalysis = analyzeShellNesting(text, dialect);
    escapedLegacyCommands.push(
      ...legacyAnalysis.nestedCommands.map((child) => ({
        ...child,
        source: remapRange(child.source, text, boundaryMap, bodyStart, source),
      }))
    );
    issues.push(
      ...legacyAnalysis.syntaxIssues.map((issue) => ({
        ...issue,
        source: remapRange(issue.source, text, boundaryMap, bodyStart, source),
      }))
    );
  }
  if (dialect === "zsh" && nodes.length > 0) {
    const first = nodes[0];
    if (first)
      issues.push({
        kind: "unsupported-dialect",
        message:
          "nested Zsh syntax was detected with a Bash grammar; a clean Bash parse does not establish Zsh completeness",
        source: sourceRange(source, first.startIndex, first.endIndex),
      });
  }
  if (dialect === "sh") {
    const process = nodes.find((node) => node.type === "process_substitution");
    if (process)
      issues.push({
        kind: "unsupported-dialect",
        message:
          "process substitution is outside the POSIX sh subset and was analyzed as Bash syntax",
        source: sourceRange(source, process.startIndex, process.endIndex),
      });
  }
  const nestedCommands = [
    ...entries.map(({ nested }) => nested),
    ...escapedLegacyCommands,
  ].toSorted(
    (left, right) =>
      left.source.start.offset - right.source.start.offset ||
      right.source.end.offset - left.source.end.offset
  );
  return {
    dialectSupport: dialectSupport(dialect),
    directCommand: maskRanges(source, 0, source.length, [
      ...nodes,
      ...heredocBodies,
    ]),
    nestedCommands,
    syntaxIssues: issues,
  };
}

/** Splits a fenced shell script at grammar-owned top-level statement bounds. */
export function readShellStatements(source: string): readonly ShellStatement[] {
  return parseShell(source)
    .rootNode.namedChildren.filter((node) => node.type !== "comment")
    .map((node) => ({
      command: node.text,
      source: sourceRange(source, node.startIndex, node.endIndex),
    }));
}
