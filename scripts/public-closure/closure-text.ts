import { posix } from "node:path";

import { collapseRepeatedPathSeparators } from "./owner-paths";
import { withoutSearchCommandSegments } from "./search-dialects";
import { readShellRedirectionTargets, readShellSegments } from "./shell-tokens";
import { unwrapShellCommand } from "./shell-wrappers";

/**
 * The single path-extraction seam. Every closure check reads its text through
 * {@link normalizeClosureText}, so a spelling a protected path can arrive in
 * has exactly one place to be recognized rather than one place per caller.
 */

const PUBLIC_REPOSITORY_OWNER = "outfitter-dev";
const PUBLIC_REPOSITORY_NAME = "skillset";
// Literal shell working-directory expansions. `$(pwd)` and the backtick
// equivalent are command substitutions that Bash resolves to the same directory
// as `$PWD`, and `$(PWD)` is the Make spelling of the same variable, so all of
// them normalize together. Other leading variables use the unresolved-prefix
// rule below; `` `PWD` `` remains a differently named command.
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
    normalizePathExpansions(
      decodeRelativeLinkDestinations(text),
      repoRoot
    ).replaceAll("\\", "/")
  );
  const visibleText = withoutSkillsetCommands(textWithUrls, assumeShellCommand);
  const pathText = withoutHttpUrls(visibleText);
  return {
    candidateText: collapseRepeatedPathSeparators(
      withoutSearchCommandSegments(pathText, assumeShellCommand)
    ),
    fileUrlPaths: fileUrlPaths(pathText),
    pathText,
    repositoryPaths: repositoryHttpPaths(visibleText),
    shellText: normalizePathExpansions(text, repoRoot),
  };
}

/** Skillset arguments describe a consumer's own source. The shell view still
 * retains wrapper prefixes so a cwd route before skillset is never hidden. */
function withoutSkillsetCommands(
  text: string,
  assumeShellCommand: boolean
): string {
  const strip = (command: string): string => {
    const segments = readShellSegments(command);
    const publicCommand = (segment: readonly string[]): boolean =>
      unwrapShellCommand(segment)[0]?.toLowerCase() === "skillset";
    if (!segments.some(publicCommand)) return command;
    const remaining = segments
      .filter((segment) => !publicCommand(segment))
      .map((segment) => segment.join(" "))
      .join(" ; ");
    return [remaining, ...readShellRedirectionTargets(command)]
      .filter(Boolean)
      .join(" ; ");
  };
  return assumeShellCommand
    ? strip(text)
    : text.replace(/`([^`\r\n]+)`/gu, (wrapped, command: string) => {
        const remaining = strip(command);
        if (remaining === command) return wrapped;
        return remaining.length === 0 ? "" : "`" + remaining + "`";
      });
}

/**
 * Resolves literal `$PWD`, `${PWD}`, `$(pwd)`, and `` `pwd` ``
 * working-directory expansions against the repository root so shell guidance
 * cannot conceal a protected route behind the expansion prefix. Without a known
 * root the expansion becomes `.`, which keeps the remainder
 * repository-relative. Unknown leading variable segments are conservatively
 * repository-relative too, except HOME, which explicitly names an external root.
 */
function normalizePathExpansions(
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
  return (
    text
      // Quoting only an expansion does not separate it from a following slash.
      // Join those prefix pieces before applying the same HOME/owner policy.
      .replace(
        /(["'])([^"'\s]+)\1(?=\/)/gu,
        (match: string, _quote: string, value: string) =>
          /^(?:\$(?:\{[A-Za-z_][A-Za-z0-9_]*\}|[A-Za-z_][A-Za-z0-9_]*)(?:\/|$))+$/u.test(value)
            ? value
            : match
      )
      .replace(WORKING_DIRECTORY_VARIABLE_PATTERN, () => replacement)
      // Unknown leading variables may name the checkout. Drop only expansion
      // prefixes, not literal parent directories. HOME is explicitly external;
      // plugin-local scripts still use the ordinary script-inventory policy.
      .replace(
        /(^|[\s`"'=<>()[\]{},;|&])((?:\$(?:\{[A-Za-z_][A-Za-z0-9_]*\}|[A-Za-z_][A-Za-z0-9_]*)\/)+)/gu,
        (match: string, prefix: string, expansions: string) =>
          /^\$(?:HOME\/|\{HOME\}\/)/u.test(expansions) ? match : `${prefix}./`
      )
  );
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

      if (host === "github.com") {
        // Route/ref spellings are not a closed vocabulary. Only the own-repo
        // identity is fixed; inspect every pathname suffix after it.
        appendSuffixes(segments, 2);
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
