import type { LintDiagnostic, LintRule, LintSubject } from "../types";

/**
 * Harnesses (claude.ai, Claude Code plugin validation) reject skill
 * descriptions longer than 1024 characters.
 */
const MAX_DESCRIPTION_LENGTH = 1024;

/** Bare angle-bracket token, e.g. `<task>`, that HTML-ish validators parse as a tag. */
const HTML_TOKEN_PATTERN = /<[A-Za-z][\w-]*>/u;

/** Inline code spans are exempt from the HTML-token check. */
const BACKTICK_SPAN_PATTERN = /`[^`]*`/gu;

const readDescription = (subject: LintSubject): string | undefined => {
  const { description } = subject.frontmatter;
  return typeof description === "string" ? description : undefined;
};

export const skillDescriptionLengthRule: LintRule = {
  check: (subject): readonly LintDiagnostic[] => {
    const description = readDescription(subject);
    if (description === undefined) {
      return [];
    }
    const { length } = [...description];
    if (length <= MAX_DESCRIPTION_LENGTH) {
      return [];
    }
    return [
      {
        guidance: {
          summary: `Shorten the description; harnesses reject descriptions longer than ${MAX_DESCRIPTION_LENGTH} characters.`,
        },
        message: `description is ${length} characters; the maximum is ${MAX_DESCRIPTION_LENGTH}`,
        path: subject.path,
        rule: "skill-description-length",
        severity: "error",
      },
    ];
  },
  description:
    "Skill descriptions must stay within the 1024-character harness limit.",
  name: "skill-description-length",
  severity: "error",
};

export const skillDescriptionHtmlTokenRule: LintRule = {
  check: (subject): readonly LintDiagnostic[] => {
    const description = readDescription(subject);
    if (description === undefined) {
      return [];
    }
    const stripped = description.replace(BACKTICK_SPAN_PATTERN, "");
    const match = stripped.match(HTML_TOKEN_PATTERN);
    if (match === null) {
      return [];
    }
    return [
      {
        guidance: {
          summary: `Backtick-wrap ${match[0]} or rephrase it; downstream plugin validators parse bare angle-bracket tokens as HTML.`,
        },
        message: `description contains a bare angle-bracket token ${match[0]}`,
        path: subject.path,
        rule: "skill-description-html-token",
        severity: "error",
      },
    ];
  },
  description:
    "Skill descriptions must not contain bare angle-bracket tokens outside inline code spans.",
  name: "skill-description-html-token",
  severity: "error",
};

/** Single-line `description:` value inside the leading frontmatter block. */
const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---/u;

export const skillDescriptionStrictYamlRule: LintRule = {
  check: (subject): readonly LintDiagnostic[] => {
    const frontmatter = subject.raw.match(FRONTMATTER_PATTERN)?.[1];
    if (frontmatter === undefined) {
      return [];
    }
    const line = frontmatter
      .split(/\r?\n/u)
      .find((candidate) => candidate.startsWith("description:"));
    if (line === undefined) {
      return [];
    }
    const value = line.slice("description:".length).trim();
    // Absent or multi-line values have nothing on the key line to misparse.
    if (value === "") {
      return [];
    }
    const first = value[0];
    // Quoted and block-scalar values are safe under strict YAML parsers.
    if (first === '"' || first === "'" || first === "|" || first === ">") {
      return [];
    }
    if (!value.includes(": ")) {
      return [];
    }
    return [
      {
        guidance: {
          summary:
            'Quote the description value (or use a block scalar); strict YAML parsers such as js-yaml reject unquoted plain scalars containing ": ".',
        },
        message:
          'unquoted description value contains ": ", which strict YAML parsers reject',
        path: subject.path,
        rule: "skill-description-strict-yaml",
        severity: "error",
      },
    ];
  },
  description:
    'Unquoted single-line description values must not contain ": " so strict YAML parsers can read them.',
  name: "skill-description-strict-yaml",
  severity: "error",
};
