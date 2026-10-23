import { posix } from "node:path";

/**
 * Where an authored rule's relative links are anchored, and where one
 * rendering of it lands. Both are workspace-relative POSIX directories; `""`
 * and `"."` both mean the repository root.
 */
export interface RuleLinkBase {
  readonly scopeDir: string;
  readonly outputDir: string;
}

const INLINE_LINK = /(!?\[[^\]\n]*\]\()([^)\s]+)(\))/g;
const FENCE = /^\s*(```|~~~)/;
const INLINE_CODE = /(`+)[^`]*?\1/g;

/**
 * Rebase relative Markdown link targets in a rule body for one destination.
 *
 * Authors write a rule's relative links as seen from the directory the rule
 * applies to: the repository root for `RULES.md`, `apps/` for
 * `rules/apps/*.md`. That is where its `AGENTS.md` lands, so that projection is
 * unchanged. Every other destination (`.claude/CLAUDE.md`, `.claude/rules/`,
 * `.cursor/rules/`) sits at a different depth and gets the same targets
 * re-expressed relative to itself. URLs, anchors, absolute paths, template
 * references, angle-bracket targets, and anything inside code are left alone.
 */
export function rebaseRuleLinks(body: string, base: RuleLinkBase): string {
  const scopeDir = normalizeDir(base.scopeDir);
  const outputDir = normalizeDir(base.outputDir);
  if (scopeDir === outputDir) return body;

  let inFence = false;
  return body
    .split("\n")
    .map((line) => {
      if (FENCE.test(line)) {
        inFence = !inFence;
        return line;
      }
      if (inFence) return line;
      return rebaseLine(line, scopeDir, outputDir);
    })
    .join("\n");
}

function rebaseLine(line: string, scopeDir: string, outputDir: string): string {
  const codeSpans = [...line.matchAll(INLINE_CODE)].map((match) => {
    const start = match.index;
    return { end: start + match[0].length, start };
  });
  return line.replaceAll(INLINE_LINK, (match, open: string, target: string, close: string, offset: number) => {
    if (codeSpans.some((span) => offset >= span.start && offset < span.end)) return match;
    const rebased = rebaseTarget(target, scopeDir, outputDir);
    return rebased === undefined ? match : `${open}${rebased}${close}`;
  });
}

function rebaseTarget(target: string, scopeDir: string, outputDir: string): string | undefined {
  if (!isRelativeTarget(target)) return undefined;
  const hashIndex = target.indexOf("#");
  const path = hashIndex === -1 ? target : target.slice(0, hashIndex);
  const fragment = hashIndex === -1 ? "" : target.slice(hashIndex);
  const resolved = posix.join(scopeDir, path);
  const rebased = posix.relative(outputDir, resolved);
  return `${rebased.length === 0 ? "." : rebased}${fragment}`;
}

function isRelativeTarget(target: string): boolean {
  if (target.startsWith("#") || target.startsWith("/") || target.startsWith("<")) return false;
  if (target.includes("{{")) return false;
  return !/^[a-z][a-z0-9+.-]*:/i.test(target);
}

function normalizeDir(directory: string): string {
  const normalized = posix.normalize(directory.replaceAll("\\", "/"));
  return normalized === "." ? "" : normalized.replace(/\/$/u, "");
}
