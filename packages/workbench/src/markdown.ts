import { markdownCodeRanges } from "@skillset/core/internal/preprocess";
import { createWorkbenchDiagnostic } from "./diagnostics";
import type { WorkbenchDiagnostic } from "./types";

interface FenceLine {
  readonly column: number;
  readonly info: string;
  readonly length: number;
  readonly line: number;
}

interface PlaceholderIssue {
  readonly column: number;
  readonly endColumn: number;
  readonly expectedCloser?: "}" | "]";
  readonly kind: "empty" | "unclosed";
  readonly line: number;
}

export function workbenchDiagnosticsFromMarkdownCodeFences(args: {
  readonly content: string;
  readonly path: string;
  readonly startLine?: number;
}): readonly WorkbenchDiagnostic[] {
  const normalized = args.content.replaceAll(/\r\n?/g, "\n");
  const lines = normalized.split("\n");
  const diagnostics: WorkbenchDiagnostic[] = [];
  let fence: FenceLine | undefined;
  const startLine = args.startLine ?? 1;

  for (const [index, line] of lines.entries()) {
    const lineNumber = index + startLine;
    if (fence === undefined) {
      const openedFence = readBacktickFenceLine(line, lineNumber);
      if (openedFence !== undefined) fence = openedFence;
      continue;
    }

    const candidate = readBacktickFenceLine(line, lineNumber);
    if (candidate === undefined) continue;
    if (candidate.length < fence.length) continue;
    if (!isMarkdownInfo(fence.info)) {
      if (candidate.info.trim() === "") fence = undefined;
      continue;
    }

    const isClosingFence = candidate.info.trim() === "";
    if (isClosingFence) {
      if (looksLikeUnlabeledNestedFence(lines, index, fence, startLine)) {
        diagnostics.push(codeFenceNestingDiagnostic(args.path, fence, candidate));
        fence = undefined;
        continue;
      }
      fence = undefined;
      continue;
    }

    diagnostics.push(codeFenceNestingDiagnostic(args.path, fence, candidate));
    fence = undefined;
  }

  return diagnostics;
}

export function workbenchDiagnosticsFromMarkdownTemplatePlaceholders(args: {
  readonly content: string;
  readonly path: string;
  readonly startLine?: number;
}): readonly WorkbenchDiagnostic[] {
  const normalized = args.content.replaceAll(/\r\n?/g, "\n");
  const parts: string[] = [];
  let cursor = 0;
  for (const [start, end] of markdownCodeRanges(normalized)) {
    // Preserve UTF-16 columns and line offsets while excluding only code content.
    parts.push(normalized.slice(cursor, start), normalized.slice(start, end).replace(/[^\n]/g, " "));
    cursor = end;
  }
  parts.push(normalized.slice(cursor));
  const lines = parts.join("").split("\n");
  const diagnostics: WorkbenchDiagnostic[] = [];
  const startLine = args.startLine ?? 1;

  for (const [index, line] of lines.entries()) {
    for (const issue of templatePlaceholderIssuesForLine(line, index + startLine)) {
      diagnostics.push(templatePlaceholderDiagnostic(args.path, issue));
    }
  }

  return diagnostics;
}

function codeFenceNestingDiagnostic(
  path: string,
  fence: FenceLine,
  candidate: FenceLine
): WorkbenchDiagnostic {
  return createWorkbenchDiagnostic({
    fix: {
      kind: "manual",
      message: `Use at least ${candidate.length + 1} backticks for the outer fence.`,
    },
    help: [
      "Nested Markdown examples need the outer code fence to be longer than any inner backtick fence.",
      `The outer fence on line ${fence.line} uses ${fence.length} backticks; line ${candidate.line} starts an inner ${candidate.length}-backtick fence.`,
    ],
    location: {
      column: fence.column,
      endColumn: candidate.column + candidate.length - 1,
      endLine: candidate.line,
      line: fence.line,
      path,
    },
    message: `outer ${fence.length}-backtick fence is not long enough for inner ${candidate.length}-backtick fence on line ${candidate.line}`,
    ruleId: "markdown/code-fence-nesting",
    ruleLevel: "standard",
    scope: "source",
    severity: "warning",
    subject: { kind: "markdown", path },
  });
}

function templatePlaceholderDiagnostic(
  path: string,
  issue: PlaceholderIssue
): WorkbenchDiagnostic {
  return createWorkbenchDiagnostic({
    fix: {
      kind: "manual",
      message: "Fill in placeholder text, close the placeholder, or remove it.",
    },
    help: [
      "Template guidance placeholders are authoring examples; Skillset does not expand them.",
      "Prefer `{ Placeholder text }` for new skill guidance. `[Placeholder text]` is also accepted for external template conventions.",
      "Use `{{...}}` only for Skillset preprocessing variables and partials.",
    ],
    location: {
      column: issue.column,
      endColumn: issue.endColumn,
      endLine: issue.line,
      line: issue.line,
      path,
    },
    message:
      issue.kind === "empty"
        ? "template guidance placeholder is empty"
        : `template guidance placeholder is missing ${issue.expectedCloser ?? "a closer"}`,
    ruleId: "markdown/template-placeholder",
    ruleLevel: "standard",
    scope: "source",
    severity: "warning",
    subject: { kind: "markdown", path },
  });
}

function templatePlaceholderIssuesForLine(
  line: string,
  lineNumber: number
): readonly PlaceholderIssue[] {
  const issues: PlaceholderIssue[] = [];

  for (const match of line.matchAll(/(?<!\{)\{([^{}\n]*)\}(?!\})/gu)) {
    if (match[1]?.trim() !== "") continue;
    issues.push({
      column: (match.index ?? 0) + 1,
      endColumn: (match.index ?? 0) + match[0].length,
      kind: "empty",
      line: lineNumber,
    });
  }

  for (const match of line.matchAll(/(?<!!)\[([^\][\n]*)\](?!\(|\[|:)/gu)) {
    if (match[1]?.trim() !== "") continue;
    if (isMarkdownTaskListMarker(line, match.index ?? 0)) continue;
    issues.push({
      column: (match.index ?? 0) + 1,
      endColumn: (match.index ?? 0) + match[0].length,
      kind: "empty",
      line: lineNumber,
    });
  }

  for (const issue of unclosedSingleBraceTemplateIssues(line, lineNumber)) {
    issues.push(issue);
  }

  return issues;
}

function isMarkdownTaskListMarker(line: string, index: number): boolean {
  const prefix = line.slice(0, index);
  const suffix = line.slice(index + 3);
  return /^[ \t]*(?:[-+*]|\d+[.)])[ \t]+$/u.test(prefix) && /^[ \t]+/u.test(suffix);
}

function unclosedSingleBraceTemplateIssues(
  line: string,
  lineNumber: number
): readonly PlaceholderIssue[] {
  const issues: PlaceholderIssue[] = [];
  for (const match of line.matchAll(/(?<!\{)\{\s+[^{}\n]*$/gu)) {
    const index = match.index ?? 0;
    const rest = line.slice(index + 1);
    if (rest.includes("}")) continue;
    issues.push({
      column: index + 1,
      endColumn: line.length,
      expectedCloser: "}",
      kind: "unclosed",
      line: lineNumber,
    });
  }
  return issues;
}

function looksLikeUnlabeledNestedFence(
  lines: readonly string[],
  candidateIndex: number,
  fence: FenceLine,
  startLine: number
): boolean {
  if (!isMarkdownInfo(fence.info)) return false;

  for (let index = candidateIndex + 1; index < lines.length; index += 1) {
    const laterFence = readBacktickFenceLine(lines[index]!, index + startLine);
    if (laterFence === undefined || laterFence.length < fence.length) continue;
    if (laterFence.info.trim() !== "") return false;

    const outerCloseLine = lines[index + 1];
    if (outerCloseLine === undefined) return false;
    const outerClose = readBacktickFenceLine(outerCloseLine, index + 1 + startLine);
    return outerClose !== undefined && outerClose.length >= fence.length && outerClose.info.trim() === "";
  }

  return false;
}

function isMarkdownInfo(info: string): boolean {
  const language = info.trim().split(/\s+/u)[0]?.toLowerCase();
  return language === "markdown" || language === "md" || language === "mdx" || language === "gfm";
}

function readBacktickFenceLine(line: string, lineNumber: number): FenceLine | undefined {
  const match = /^( {0,3})(`{3,})(.*)$/u.exec(line);
  if (match === null) return undefined;
  const sequence = match[2]!;
  const info = match[3]!;
  if (info.includes("`")) return undefined;
  return {
    column: match[1]!.length + 1,
    info,
    length: sequence.length,
    line: lineNumber,
  };
}
