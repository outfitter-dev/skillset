/** Shared rc child fields and strict-validator Be inventory in Claude 2.1.269. */
export const CLAUDE_EXPERIMENTAL_FIELD_TYPES = {
  themes: "string-or-string-array", monitors: "string-or-array", outputStyles: "string-or-string-array",
  evals: "string-or-string-array", syntaxHighlighting: "object",
} as const;

/** Wd/Gd input predicates; no remote resolution or integrity verification. */
export const CLAUDE_SYNTAX_LANGUAGE_STRING_RULES = {
  id: { maxLength: 64, pattern: /^[a-z][a-z0-9_-]*$/, description: "match ^[a-z][a-z0-9_-]*$" },
  remote: { maxLength: 256, pattern: /^(npm:[@a-z0-9/._-]+(@[a-z0-9._+-]+)?|github:[\w.-]+\/[\w.-]+@[\w./-]+#.+\.js)$/, description: "use npm:<pkg>[@ver] or github:<owner>/<repo>@<ref>#<path>.js syntax" },
  integrity: { maxLength: 512, pattern: /^sha(256|384|512)-[A-Za-z0-9+/=]+$/, description: "use sha256-, sha384-, or sha512- SRI syntax" },
} as const;
