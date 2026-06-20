import { createWorkbenchDiagnostic } from "./diagnostics";
import type { WorkbenchDiagnostic } from "./types";

interface FenceLine {
  readonly column: number;
  readonly info: string;
  readonly length: number;
  readonly line: number;
}

export function workbenchDiagnosticsFromMarkdownCodeFences(args: {
  readonly content: string;
  readonly path: string;
}): readonly WorkbenchDiagnostic[] {
  const normalized = args.content.replaceAll(/\r\n?/g, "\n");
  const lines = normalized.split("\n");
  const diagnostics: WorkbenchDiagnostic[] = [];
  let fence: FenceLine | undefined;

  for (const [index, line] of lines.entries()) {
    const lineNumber = index + 1;
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
      if (looksLikeUnlabeledNestedFence(lines, index, fence)) {
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

function looksLikeUnlabeledNestedFence(
  lines: readonly string[],
  candidateIndex: number,
  fence: FenceLine
): boolean {
  if (!isMarkdownInfo(fence.info)) return false;

  for (let index = candidateIndex + 1; index < lines.length; index += 1) {
    const laterFence = readBacktickFenceLine(lines[index]!, index + 1);
    if (laterFence === undefined || laterFence.length < fence.length) continue;
    if (laterFence.info.trim() !== "") return false;

    const outerCloseLine = lines[index + 1];
    if (outerCloseLine === undefined) return false;
    const outerClose = readBacktickFenceLine(outerCloseLine, index + 2);
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
