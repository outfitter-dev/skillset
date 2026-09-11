import Parser from "tree-sitter";
import Bash from "tree-sitter-bash";

import { commandName } from "./shell-operands";
import { readShellSegments } from "./shell-tokens";
import { unwrapShellCommand } from "./shell-wrappers";

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

// Only commands known to execute stdin make the whole body shell-like guidance.
// Other unquoted bodies still expose substitutions expanded by the outer shell.
const HEREDOC_INTERPRETERS = new Set([
  "bash",
  "bun",
  "dash",
  "ksh",
  "node",
  "perl",
  "python",
  "python3",
  "ruby",
  "sh",
  "zsh",
]);

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

function isQuotedHeredocBody(node: Parser.SyntaxNode): boolean {
  const start = node.parent?.namedChildren.find(
    (child) => child.type === "heredoc_start"
  );
  return /['"\\]/u.test(start?.text ?? "");
}

function redirectedCommandTokens(node: Parser.SyntaxNode): readonly string[] {
  const body = node.childForFieldName("body");
  // A trailing redirect wraps its whole list or pipeline; the final segment is
  // the command whose stdin actually receives the heredoc.
  return unwrapShellCommand(
    readShellSegments(body?.text ?? node.text).at(-1) ?? []
  );
}

function redirectedCommandName(node: Parser.SyntaxNode): string {
  return commandName(redirectedCommandTokens(node)[0]);
}

function readsHeredocAsSourcedFile(tokens: readonly string[]): boolean {
  const [name, path] = tokens;
  return (
    [".", "source"].includes(commandName(name)) &&
    ["/dev/fd/0", "/dev/stdin", "/proc/self/fd/0"].includes(path ?? "")
  );
}

function executesHeredocInput(tokens: readonly string[]): boolean {
  return (
    HEREDOC_INTERPRETERS.has(commandName(tokens[0])) ||
    readsHeredocAsSourcedFile(tokens)
  );
}

function executesProcessInput(tokens: readonly string[]): boolean {
  const name = commandName(tokens[0]);
  return HEREDOC_INTERPRETERS.has(name) || [".", "source"].includes(name);
}

function processSubstitutionTokens(node: Parser.SyntaxNode): readonly string[] {
  const body = node.namedChildren[0];
  return unwrapShellCommand(
    readShellSegments(body?.text ?? node.text.slice(2, -1))[0] ?? []
  );
}

function commandTokens(node: Parser.SyntaxNode): readonly string[] {
  return unwrapShellCommand(readShellSegments(node.text)[0] ?? []);
}

function teesInputToInterpreter(node: Parser.SyntaxNode): boolean {
  const tokens = commandTokens(node);
  if (commandName(tokens[0]) !== "tee") return false;
  return node.namedChildren.some(
    (child) =>
      child.type === "process_substitution" &&
      child.text.startsWith(">(") &&
      HEREDOC_INTERPRETERS.has(commandName(processSubstitutionTokens(child)[0]))
  );
}

function pipelineInputConsumers(
  node: Parser.SyntaxNode
): readonly Parser.SyntaxNode[] {
  if (node.type === "command") return [node];
  if (node.type === "redirected_statement") {
    const body = node.childForFieldName("body");
    return body ? pipelineInputConsumers(body) : [];
  }
  if (node.type === "list") {
    const first = node.namedChildren[0];
    return first ? pipelineInputConsumers(first) : [];
  }
  if (node.type === "pipeline") {
    return node.namedChildren.flatMap(pipelineInputConsumers);
  }
  return [];
}

function redirectInputConsumer(
  node: Parser.SyntaxNode
): Parser.SyntaxNode | undefined {
  if (node.type === "command") return node;
  if (node.type === "redirected_statement") {
    const body = node.childForFieldName("body");
    return body ? redirectInputConsumer(body) : undefined;
  }
  if (node.type === "list" || node.type === "pipeline") {
    const last = node.namedChildren.at(-1);
    return last ? redirectInputConsumer(last) : undefined;
  }
  return undefined;
}

function isExecutedHeredocBody(node: Parser.SyntaxNode): boolean {
  let ancestor = node.parent;
  let insideCommandSubstitution = false;
  let insideProcessInput = false;
  while (ancestor) {
    if (ancestor.type === "heredoc_redirect") {
      const downstream = ancestor.namedChildren.find(
        (child) => child.type === "pipeline"
      );
      if (
        downstream &&
        pipelineInputConsumers(downstream).some(
          (consumer) =>
            executesHeredocInput(commandTokens(consumer)) ||
            teesInputToInterpreter(consumer)
        )
      )
        return true;
    }
    if (ancestor.type === "redirected_statement") {
      const body = ancestor.childForFieldName("body");
      const consumer = body ? redirectInputConsumer(body) : undefined;
      if (
        consumer &&
        (executesHeredocInput(commandTokens(consumer)) ||
          teesInputToInterpreter(consumer))
      )
        return true;
    }
    if (ancestor.type === "command_substitution")
      insideCommandSubstitution = true;
    if (
      ancestor.type === "process_substitution" &&
      ancestor.text.startsWith("<(")
    )
      insideProcessInput = true;
    if (ancestor.type === "command") {
      const tokens = redirectedCommandTokens(ancestor);
      if (
        (insideCommandSubstitution &&
          (commandName(tokens[0]) === "eval" ||
            HEREDOC_INTERPRETERS.has(commandName(tokens[0])))) ||
        (insideProcessInput && executesProcessInput(tokens))
      )
        return true;
    }
    ancestor = ancestor.parent;
  }
  return false;
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
  const patternBodies = root
    .descendantsOfType("regex")
    .filter((node) => /\$\(|[<>]\(|`/u.test(node.text));
  const entries = nodes.map((node) => {
    const { closeWidth, kind, openWidth } = substitutionKind(source, node);
    const start = node.startIndex + openWidth;
    const end = Math.max(start, node.endIndex - closeWidth);
    const descendants = [...nodes, ...heredocBodies, ...patternBodies].filter(
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
  const patternCommands: NestedShellCommand[] = [];
  for (const node of patternBodies) {
    const analysis = analyzeShellNesting(node.text, dialect);
    const remapPatternRange = (range: ShellSourceRange): ShellSourceRange =>
      sourceRange(
        source,
        node.startIndex + utf16IndexAtByteOffset(node.text, range.start.offset),
        node.startIndex + utf16IndexAtByteOffset(node.text, range.end.offset)
      );
    patternCommands.push(
      ...analysis.nestedCommands.map(({ command, kind, source: range }) => ({
        command,
        kind,
        source: remapPatternRange(range),
      }))
    );
    issues.push(
      ...analysis.syntaxIssues.map((issue) => ({
        ...issue,
        source: remapPatternRange(issue.source),
      }))
    );
  }
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
    ...patternCommands,
    ...heredocBodies.flatMap((node) => {
      const commands: NestedShellCommand[] = [];
      if (isExecutedHeredocBody(node))
        commands.push({
          command: node.text,
          kind: "command",
          source: sourceRange(source, node.startIndex, node.endIndex),
        });
      if (!isQuotedHeredocBody(node)) {
        const bodyAnalysis = analyzeShellNesting(node.text, dialect);
        const remapBodyRange = (range: ShellSourceRange): ShellSourceRange =>
          sourceRange(
            source,
            node.startIndex +
              utf16IndexAtByteOffset(node.text, range.start.offset),
            node.startIndex +
              utf16IndexAtByteOffset(node.text, range.end.offset)
          );
        commands.push(
          ...bodyAnalysis.nestedCommands
            .filter(({ kind }) => kind === "legacy-command")
            .map(({ command, kind, source: range }) => ({
              command,
              kind,
              source: remapBodyRange(range),
            }))
        );
        issues.push(
          ...bodyAnalysis.syntaxIssues.map((issue) => ({
            ...issue,
            source: remapBodyRange(issue.source),
          }))
        );
      }
      return commands;
    }),
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
      ...patternBodies,
    ]),
    nestedCommands,
    syntaxIssues: issues,
  };
}

/** Splits a fenced shell script at grammar-owned top-level statement bounds.
 * Standalone comments stay in the scan as content. Same-line trailing comments
 * stay attached to the preceding statement so Skillset stripping and comment
 * non-execution keep their existing command context. */
export function readShellStatements(source: string): readonly ShellStatement[] {
  const statements: ShellStatement[] = [];
  let previousEndRow = -1;
  let previousStartIndex = -1;
  for (const node of parseShell(source).rootNode.namedChildren) {
    const previous = statements.at(-1);
    if (
      previous !== undefined &&
      node.type === "comment" &&
      node.startPosition.row === previousEndRow
    ) {
      statements[statements.length - 1] = {
        command: source.slice(previousStartIndex, node.endIndex),
        source: sourceRange(source, previousStartIndex, node.endIndex),
      };
      previousEndRow = node.endPosition.row;
      continue;
    }
    statements.push({
      command: node.text,
      source: sourceRange(source, node.startIndex, node.endIndex),
    });
    previousStartIndex = node.startIndex;
    previousEndRow = node.endPosition.row;
  }
  return statements;
}
