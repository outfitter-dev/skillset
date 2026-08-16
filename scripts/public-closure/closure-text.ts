import { posix } from "node:path";

import { collapseRepeatedPathSeparators } from "./owner-paths";
import { withoutSearchCommandSegments } from "./search-dialects";

/**
 * The single path-extraction seam. Every closure check reads its text through
 * {@link normalizeClosureText}, so a spelling a protected path can arrive in
 * has exactly one place to be recognized rather than one place per caller.
 */

const PUBLIC_REPOSITORY_OWNER = "outfitter-dev";
const PUBLIC_REPOSITORY_NAME = "skillset";
// Canonical `github.com/<owner>/<repo>/<route>/<ref>/<path>` file views.
const GITHUB_FILE_VIEW_ROUTES: ReadonlySet<string> = new Set([
  "blame",
  "blob",
  "edit",
  "raw",
  "tree",
]);
// Literal shell working-directory expansions. `$(pwd)` and the backtick
// equivalent are command substitutions that Bash resolves to the same directory
// as `$PWD`, and `$(PWD)` is the Make spelling of the same variable, so all of
// them normalize together. Bare `$pwd` stays untouched: it is a different
// variable, and `` `PWD` `` would be a differently named command.
const WORKING_DIRECTORY_VARIABLE_PATTERN =
  /\$\{PWD\}|\$\(\s*(?:pwd|PWD)\s*\)|`\s*pwd\s*`|\$PWD(?![A-Za-z0-9_])/gu;
// Markdown inline destinations, Markdown reference definitions, and HTML
// `href`/`src` attributes. The destination stops at shell/Markdown delimiters.
const LINK_DESTINATION_PATTERN =
  /(\][(:]\s*<?|\b(?:href|src)\s*=\s*["']?)([^\s()<>"'`\r\n]+)/giu;
const ABSOLUTE_LINK_SCHEME_PATTERN = /^[a-z][a-z0-9+.-]*:\/\//iu;

/**
 * The views of one logical line that the closure rules read, produced together
 * by {@link normalizeClosureText}.
 */
export interface NormalizedClosureText {
  /** {@link pathText} with search-command segments removed and separators collapsed. */
  readonly candidateText: string;
  /** Absolute repository paths recovered from `file://` URLs. */
  readonly fileUrlPaths: readonly string[];
  /** Prose and path text: expansions resolved, separators normalized, HTTP URLs removed. */
  readonly pathText: string;
  /** Repository-relative paths recovered from public repository HTTP URLs. */
  readonly repositoryPaths: readonly string[];
  /** The original text with working-directory expansions resolved, for shell tokenizers. */
  readonly shellText: string;
}

/**
 * Reduces one logical line to the views the closure rules consume. The steps
 * run in a fixed order: percent-decode link destinations, resolve
 * working-directory expansions, normalize separators and literal shell quotes,
 * strip HTTP URLs into their own path list, then remove the search-command
 * segments whose operands are patterns rather than paths.
 */
export function normalizeClosureText(
  text: string,
  repoRoot: string | undefined,
  assumeShellCommand: boolean
): NormalizedClosureText {
  const textWithUrls = normalizeLiteralShellPathQuotes(
    expandWorkingDirectoryVariables(
      decodeRelativeLinkDestinations(text),
      repoRoot
    ).replaceAll("\\", "/")
  );
  const pathText = withoutHttpUrls(textWithUrls);
  return {
    candidateText: collapseRepeatedPathSeparators(
      withoutSearchCommandSegments(pathText, assumeShellCommand)
    ),
    fileUrlPaths: fileUrlPaths(pathText),
    pathText,
    repositoryPaths: repositoryHttpPaths(textWithUrls),
    shellText: expandWorkingDirectoryVariables(text, repoRoot),
  };
}

/**
 * Resolves literal `$PWD`, `${PWD}`, `$(pwd)`, and `` `pwd` ``
 * working-directory expansions against the repository root so shell guidance
 * cannot conceal a protected route behind the expansion prefix. Without a known
 * root the expansion becomes `.`, which keeps the remainder
 * repository-relative.
 */
function expandWorkingDirectoryVariables(
  text: string,
  repoRoot: string | undefined
): string {
  if (!(text.includes("$") || text.includes("`"))) return text;
  const normalizedRoot = repoRoot
    ?.replaceAll("\\", "/")
    .replace(/\/+$/u, "")
    .trim();
  const replacement =
    normalizedRoot === undefined || normalizedRoot.length === 0
      ? "."
      : normalizedRoot;
  return text.replace(WORKING_DIRECTORY_VARIABLE_PATTERN, () => replacement);
}

/**
 * Percent-decodes relative Markdown and HTML link destinations before the
 * closure rules run. Absolute URLs keep their own decoding path, and malformed
 * escapes degrade to per-escape decoding so a single invalid sequence neither
 * throws nor hides the valid escapes around it.
 */
function decodeRelativeLinkDestinations(text: string): string {
  if (!text.includes("%")) return text;
  return text.replace(
    LINK_DESTINATION_PATTERN,
    (match: string, prefix: string, destination: string) =>
      isRelativeLinkDestination(destination)
        ? `${prefix}${decodePercentEncodedPath(destination)}`
        : match
  );
}

function isRelativeLinkDestination(destination: string): boolean {
  if (destination.length === 0 || destination.startsWith("#")) return false;
  if (destination.startsWith("//")) return false;
  return !ABSOLUTE_LINK_SCHEME_PATTERN.test(destination);
}

function decodePercentEncodedPath(value: string): string {
  if (!value.includes("%")) return value;
  try {
    return decodeURIComponent(value);
  } catch {
    return value.replace(/%[0-9a-f]{2}/giu, (escape) => {
      try {
        return decodeURIComponent(escape);
      } catch {
        return escape;
      }
    });
  }
}

function normalizeLiteralShellPathQuotes(text: string): string {
  let normalized = text;
  while (true) {
    const next = normalized.replace(/(["'])([a-z0-9._@:+\/-]*)\1/giu, "$2");
    if (next === normalized) return normalized;
    normalized = next;
  }
}

function withoutHttpUrls(text: string): string {
  return text.replace(/\bhttps?:\/\/[^\s`"'<>]+/giu, " ");
}

function fileUrlPaths(text: string): readonly string[] {
  const paths: string[] = [];
  for (const match of text.matchAll(/\bfile:\/\/\/[^\s`"'<>]+/giu)) {
    const value = match[0].replace(/[!,.?:;]+$/u, "");
    try {
      let path = decodeURIComponent(new URL(value).pathname).replaceAll(
        "\\",
        "/"
      );
      if (/^\/[a-z]:\//iu.test(path)) path = path.slice(1);
      paths.push(posix.normalize(path).toLowerCase());
    } catch {
      // Malformed file URLs are not treated as repository paths.
    }
  }
  return paths;
}

function repositoryHttpPaths(text: string): readonly string[] {
  const paths: string[] = [];
  const appendSuffixes = (
    segments: readonly string[],
    firstPathIndex: number
  ): void => {
    for (let index = firstPathIndex; index < segments.length; index += 1) {
      paths.push(
        posix.normalize(segments.slice(index).join("/")).toLowerCase()
      );
    }
  };
  for (const match of text.matchAll(/\bhttps?:\/\/[^\s`"'<>]+/giu)) {
    const value = trimUrlClosingDelimiters(match[0].replace(/[!,.?:;]+$/u, ""));
    try {
      const url = new URL(value);
      const segments = decodeURIComponent(url.pathname)
        .split("/")
        .filter(Boolean);
      const host = url.hostname.toLowerCase();
      const isRepository =
        segments[0]?.toLowerCase() === PUBLIC_REPOSITORY_OWNER &&
        segments[1]?.toLowerCase() === PUBLIC_REPOSITORY_NAME;
      if (!isRepository) continue;

      if (
        host === "github.com" &&
        GITHUB_FILE_VIEW_ROUTES.has(segments[2]?.toLowerCase() ?? "") &&
        segments.length > 4
      ) {
        appendSuffixes(segments, 4);
      } else if (host === "raw.githubusercontent.com" && segments.length > 3) {
        appendSuffixes(segments, 3);
      }
    } catch {
      // Malformed or undecodable URLs are not treated as repository paths.
    }
  }
  return paths;
}

function trimUrlClosingDelimiters(value: string): string {
  let trimmed = value;
  for (const [opening, closing] of [
    ["(", ")"],
    ["[", "]"],
    ["{", "}"],
  ] as const) {
    while (
      trimmed.endsWith(closing) &&
      [...trimmed].filter((character) => character === closing).length >
        [...trimmed].filter((character) => character === opening).length
    ) {
      trimmed = trimmed.slice(0, -1);
    }
  }
  return trimmed;
}
