import type { LintDiagnostic, LintRule, LintSubject } from "../types";

/**
 * Markdown link/image destinations, mirroring the pattern the compiler's
 * resource machinery scans (apps/skillset/src/resources.ts). That machinery
 * only validates `shared:`/`plugin:` resource URLs and plugin-root script
 * links; bare `../` traversal and absolute filesystem paths pass through
 * untouched, so this rule covers them.
 */
const LINK_PATTERN = /!?\[[^\]\n]*\]\((?<destination>[^) \t\n]+)\)/gu;

/** Destinations with a URL scheme (`https://`, `mailto:`, `shared:`, ...). */
const SCHEME_PATTERN = /^[a-z][a-z0-9+.-]*:/iu;

const FENCE_PATTERN = /^\s*(?:```|~~~)/u;

const INLINE_CODE_PATTERN = /`[^`]*`/gu;

/**
 * Blank out fenced code blocks and inline code spans so example links in
 * documentation (e.g. an ADR template showing `[Tenets](../tenets.md)`)
 * are not treated as real file references.
 */
const maskCodeRegions = (body: string): string => {
  let inFence = false;
  const lines = body.split(/\r?\n/u).map((line) => {
    if (FENCE_PATTERN.test(line)) {
      inFence = !inFence;
      return "";
    }
    if (inFence) {
      return "";
    }
    return line.replace(INLINE_CODE_PATTERN, "");
  });
  return lines.join("\n");
};

const escapesSkillDirectory = (destination: string): boolean => {
  if (destination.startsWith("/")) {
    return true;
  }
  const segments = destination.split("/");
  return segments.includes("..");
};

/**
 * SKILL.md sits at the skill-directory root, so any `../` link target or
 * absolute filesystem path leaves the skill's own tree. Skills install at
 * unpredictable locations (versioned plugin caches, per-target output
 * roots) and are copied as isolated units, so escaping references break
 * after install or conversion.
 */
export const skillFileReferenceEscapeRule: LintRule = {
  check: (subject: LintSubject): readonly LintDiagnostic[] => {
    const masked = maskCodeRegions(subject.body);
    const flagged = new Set<string>();
    const diagnostics: LintDiagnostic[] = [];
    for (const match of masked.matchAll(LINK_PATTERN)) {
      const destination = match.groups?.destination;
      if (
        destination === undefined ||
        destination.startsWith("#") ||
        SCHEME_PATTERN.test(destination) ||
        !escapesSkillDirectory(destination) ||
        flagged.has(destination)
      ) {
        continue;
      }
      flagged.add(destination);
      diagnostics.push({
        guidance: {
          summary:
            "Skills must be self-contained: move the file into the skill directory (references/, scripts/, assets/) and link it with a skill-relative path, or declare it via resources (shared:/plugin:) so the build copies it skill-local.",
        },
        message: `links to ${destination}, which escapes the skill directory`,
        path: subject.path,
        rule: "skill-file-reference-escape",
        severity: "error",
      });
    }
    return diagnostics;
  },
  description:
    "Skill bodies must not link to files outside the skill's own directory tree.",
  name: "skill-file-reference-escape",
  severity: "error",
};
