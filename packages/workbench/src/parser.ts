import { createWorkbenchDiagnostic } from "./diagnostics";
import type {
  WorkbenchDiagnostic,
  WorkbenchMarkdownHeading,
  WorkbenchParseKind,
  WorkbenchParseResult,
} from "./types";

interface ParserErrorLocation {
  readonly column?: number;
  readonly line: number;
}

interface MarkdownFence {
  readonly length: number;
  readonly marker: "`" | "~";
}

export function inferWorkbenchParseKind(path: string): WorkbenchParseKind {
  if (path.endsWith(".json") || path.endsWith(".skillset.lock")) return "json";
  if (path.endsWith(".md") || path.endsWith(".markdown")) return "markdown";
  if (path.endsWith(".toml")) return "toml";
  if (path.endsWith(".yaml") || path.endsWith(".yml")) return "yaml";
  return "unknown";
}

export function parseWorkbenchDocument(args: {
  readonly content: string;
  readonly kind?: WorkbenchParseKind;
  readonly path: string;
}): WorkbenchParseResult {
  const kind = args.kind ?? inferWorkbenchParseKind(args.path);
  if (kind === "json") return parseJson(args.path, args.content);
  if (kind === "markdown") return parseMarkdown(args.path, args.content);
  if (kind === "toml") return parseToml(args.path, args.content);
  if (kind === "yaml") return parseYaml(args.path, args.content);
  return { diagnostics: [], kind, path: args.path };
}

export function checkWorkbenchSyntax(args: {
  readonly content: string;
  readonly kind?: WorkbenchParseKind;
  readonly path: string;
}): readonly WorkbenchDiagnostic[] {
  return parseWorkbenchDocument(args).diagnostics;
}

function parseJson(path: string, content: string): WorkbenchParseResult {
  try {
    return { data: JSON.parse(content) as unknown, diagnostics: [], kind: "json", path };
  } catch (error) {
    return {
      diagnostics: [
        syntaxDiagnostic(path, "syntax/json", errorMessage(error), parserErrorLocation(error, content)),
      ],
      kind: "json",
      path,
    };
  }
}

function parseToml(path: string, content: string): WorkbenchParseResult {
  try {
    return { data: Bun.TOML.parse(content) as unknown, diagnostics: [], kind: "toml", path };
  } catch (error) {
    return {
      diagnostics: [
        syntaxDiagnostic(path, "syntax/toml", errorMessage(error), parserErrorLocation(error, content)),
      ],
      kind: "toml",
      path,
    };
  }
}

function parseYaml(path: string, content: string): WorkbenchParseResult {
  try {
    return { data: Bun.YAML.parse(content) as unknown, diagnostics: [], kind: "yaml", path };
  } catch (error) {
    return {
      diagnostics: [
        syntaxDiagnostic(path, "syntax/yaml", errorMessage(error), parserErrorLocation(error, content)),
      ],
      kind: "yaml",
      path,
    };
  }
}

function parseMarkdown(path: string, content: string): WorkbenchParseResult {
  const normalized = content.replaceAll(/\r\n?/g, "\n");
  const lines = normalized.split("\n");
  if (!isFrontmatterDelimiter(lines[0] ?? "")) {
    return {
      body: normalized,
      bodyStartLine: 1,
      diagnostics: [],
      headings: markdownHeadings(lines, 1),
      kind: "markdown",
      path,
    };
  }

  const closingIndex = lines.findIndex(
    (line, index) => index > 0 && isFrontmatterDelimiter(line)
  );
  if (closingIndex === -1) {
    return {
      diagnostics: [
        syntaxDiagnostic(
          path,
          "syntax/markdown-frontmatter",
          "frontmatter starts with --- but never closes",
          { line: 1 }
        ),
      ],
      headings: [],
      kind: "markdown",
      path,
    };
  }

  const frontmatterText = lines.slice(1, closingIndex).join("\n");
  const bodyLines = lines.slice(closingIndex + 1);
  const bodyStartLine = closingIndex + 2;
  const body = bodyLines.join("\n");

  let parsed: unknown;
  try {
    parsed = frontmatterText.trim() === "" ? {} : Bun.YAML.parse(frontmatterText);
  } catch (error) {
    const location = parserErrorLocation(error, frontmatterText);
    return {
      body,
      bodyStartLine,
      diagnostics: [
        syntaxDiagnostic(path, "syntax/markdown-frontmatter", errorMessage(error), {
          ...location,
          line: location.line + 1,
        }),
      ],
      headings: markdownHeadings(bodyLines, bodyStartLine),
      kind: "markdown",
      path,
    };
  }

  if (!isRecord(parsed)) {
    return {
      body,
      bodyStartLine,
      diagnostics: [
        syntaxDiagnostic(path, "syntax/markdown-frontmatter", "frontmatter must be a YAML object", {
          line: 2,
        }),
      ],
      headings: markdownHeadings(bodyLines, bodyStartLine),
      kind: "markdown",
      path,
    };
  }

  return {
    body,
    bodyStartLine,
    diagnostics: [],
    frontmatter: parsed ?? {},
    headings: markdownHeadings(bodyLines, bodyStartLine),
    kind: "markdown",
    path,
  };
}

function markdownHeadings(
  lines: readonly string[],
  startLine: number
): readonly WorkbenchMarkdownHeading[] {
  const headings: WorkbenchMarkdownHeading[] = [];
  let fence: MarkdownFence | undefined;
  for (const [index, line] of lines.entries()) {
    if (fence !== undefined) {
      if (closesFence(line, fence)) fence = undefined;
      continue;
    }

    const openedFence = readFence(line);
    if (openedFence !== undefined) {
      fence = openedFence;
      continue;
    }

    const heading = parseMarkdownHeading(line);
    if (heading === undefined) continue;
    headings.push({
      depth: heading.depth,
      line: startLine + index,
      text: heading.text,
    });
  }
  return headings;
}

function parseMarkdownHeading(line: string): Pick<WorkbenchMarkdownHeading, "depth" | "text"> | undefined {
  const match = /^(#{1,6})(?:[ \t]+|$)(.*)$/u.exec(line);
  if (match === null) return undefined;

  let text = match[2]!.trimEnd();
  const closingSequence = /[ \t]+#{1,}[ \t]*$/u.exec(text);
  if (closingSequence !== null) {
    text = text.slice(0, closingSequence.index).trimEnd();
  }

  return { depth: match[1]!.length, text };
}

function readFence(line: string): MarkdownFence | undefined {
  const match = /^( {0,3})(`{3,}|~{3,})(.*)$/u.exec(line);
  if (match === null) return undefined;
  const sequence = match[2]!;
  const marker = sequence[0] as "`" | "~";
  const info = match[3]!;
  if (marker === "`" && info.includes("`")) return undefined;
  return { length: sequence.length, marker };
}

function closesFence(line: string, fence: MarkdownFence): boolean {
  const candidate = readClosingFence(line);
  return candidate?.marker === fence.marker && candidate.length >= fence.length;
}

function readClosingFence(line: string): MarkdownFence | undefined {
  const match = /^( {0,3})(`{3,}|~{3,})[ \t]*$/u.exec(line);
  if (match === null) return undefined;
  const sequence = match[2]!;
  return { length: sequence.length, marker: sequence[0] as "`" | "~" };
}

function isFrontmatterDelimiter(line: string): boolean {
  return /^---[ \t]*$/u.test(line);
}

function syntaxDiagnostic(
  path: string,
  ruleId: string,
  message: string,
  location: ParserErrorLocation
): WorkbenchDiagnostic {
  return createWorkbenchDiagnostic({
    location: { ...location, path },
    message,
    ruleId,
    scope: "source",
    severity: "error",
    subject: { kind: "file", path },
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function parserErrorLocation(error: unknown, content: string): ParserErrorLocation {
  const lines = content.replaceAll(/\r\n?/g, "\n").split("\n");
  const fallback = fallbackSyntaxLocation(lines);
  if (typeof error !== "object" || error === null) return fallback;
  const aggregateLocation = aggregateErrorLocation(error, lines);
  if (aggregateLocation !== undefined) return aggregateLocation;

  const record = error as { column?: unknown; line?: unknown; sourceURL?: unknown };
  if (typeof record.sourceURL === "string") return fallback;
  const line = typeof record.line === "number" && Number.isFinite(record.line) ? record.line + 1 : 1;
  const column =
    typeof record.column === "number" && Number.isFinite(record.column)
      ? record.column + 1
      : undefined;
  const lineText = lines[line - 1];
  if (lineText === undefined) return fallback;
  const hasDocumentColumn = column === undefined || column <= lineText.length + 1;
  if (!hasDocumentColumn) return fallback;
  return column === undefined ? { line } : { column, line };
}

function aggregateErrorLocation(error: object, lines: readonly string[]): ParserErrorLocation | undefined {
  const aggregate = error as { errors?: unknown };
  if (!Array.isArray(aggregate.errors)) return undefined;
  for (const child of aggregate.errors) {
    const location = childErrorLocation(child, lines);
    if (location !== undefined) return location;
  }
  return undefined;
}

function childErrorLocation(error: unknown, lines: readonly string[]): ParserErrorLocation | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const record = error as { column?: unknown; line?: unknown; position?: unknown };
  const position = readPositionLocation(record.position, lines);
  if (position !== undefined) return position;

  const line = typeof record.line === "number" && Number.isFinite(record.line) ? record.line + 1 : 1;
  const column =
    typeof record.column === "number" && Number.isFinite(record.column)
      ? record.column + 1
      : undefined;
  return documentLocation(line, column, lines);
}

function readPositionLocation(position: unknown, lines: readonly string[]): ParserErrorLocation | undefined {
  if (typeof position !== "object" || position === null) return undefined;
  const record = position as { column?: unknown; line?: unknown };
  const line = typeof record.line === "number" && Number.isFinite(record.line) ? record.line : 1;
  const column =
    typeof record.column === "number" && Number.isFinite(record.column)
      ? record.column
      : undefined;
  return documentLocation(line, column, lines);
}

function documentLocation(
  line: number,
  column: number | undefined,
  lines: readonly string[]
): ParserErrorLocation | undefined {
  const lineText = lines[line - 1];
  if (lineText === undefined) return undefined;
  if (column !== undefined && column > lineText.length + 1) return undefined;
  return column === undefined ? { line } : { column, line };
}

function fallbackSyntaxLocation(lines: readonly string[]): ParserErrorLocation {
  const danglingAssignment = lines.findIndex((line) =>
    /(?:^|\s)(?:"[^"]+"|[A-Za-z0-9_-]+)\s*[:=]\s*$/u.test(line)
  );
  if (danglingAssignment !== -1) return { line: danglingAssignment + 1 };

  const danglingCollection = lines.findIndex((line) =>
    /(?:^|\s)(?:"[^"]+"|[A-Za-z0-9_-]+)\s*[:=]\s*[[{]\s*$/u.test(line)
  );
  if (danglingCollection !== -1) return { line: danglingCollection + 1 };

  const firstNonEmptyLine = lines.findIndex((line) => line.trim() !== "");
  if (firstNonEmptyLine !== -1) return { line: firstNonEmptyLine + 1 };

  return { line: 1 };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
