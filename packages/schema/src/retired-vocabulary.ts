/**
 * Rule spellings retired by ADR-0039.
 *
 * Authored guidance under `.skillset/RULES.md` and `.skillset/rules/` was
 * called an "instruction" before ADR-0039 renamed it a "rule". Parsers read
 * these spellings only to reject retired input with its exact rewrite.
 * `bun run terminology:guard` allowlists this module as the one home for the
 * retired spellings, so every other surface uses the rule vocabulary.
 */

/** Target-defaults surface key retired for `rules`. */
export const RETIRED_RULE_DEFAULTS_SURFACE = "instructions";

/** `skillset new` kind and `skillset lookup` subject retired for `rule`. */
export const RETIRED_RULE_KIND = "instruction";

/**
 * Adoption import kind retired for `rules`. Report schema v1 still accepts it as
 * a candidate-ID prefix so receipts recorded before ADR-0039 stay readable.
 */
export const RETIRED_RULE_IMPORT_KIND = "instructions";
