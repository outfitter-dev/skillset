/**
 * Rule spellings retired by ADR-0037.
 *
 * Authored guidance under `.skillset/RULES.md` and `.skillset/rules/` was
 * called an "instruction" before ADR-0037 renamed it a "rule". Parsers read
 * these spellings only to reject retired input with its exact rewrite, and
 * change-history readers use the selector prefix to translate append-only
 * records. `bun run terminology:guard` allowlists this module as the one home
 * for the retired spellings, so every other surface uses the rule vocabulary.
 */

/** Source-unit selector prefix recorded in change history before ADR-0037. */
export const RETIRED_RULE_SELECTOR_PREFIX = "instruction:";

/**
 * Source-hash domain for rule units. It keeps the pre-ADR-0037 spelling on
 * purpose: the domain is hashed into every rule's source hash, so renaming it
 * would report every unchanged rule as edited against its recorded baseline.
 */
export const RULE_SOURCE_HASH_DOMAIN = "instruction";
