import type { TransformEntry, TransformEvidence } from "../types";

/**
 * Shared target truth for Claude dynamic-context constructs: Codex skills
 * have no templating, so these pass through as inert literal text, and
 * OpenAI's own Claude importer rejects skills that use them
 * (`has_unsupported_command_template_features`).
 *
 * Pattern parity: these recognizers are aligned with skillset's lint
 * CLAUDE_DYNAMIC_PATTERNS (codes claude-arguments,
 * claude-positional-argument, claude-env-substitution,
 * claude-shell-placeholder in apps/skillset/src/lint.ts). Lint keeps owning
 * the codex-enabled gate; this registry only adds recognition for adopt
 * reporting.
 */
const DYNAMIC_EVIDENCE: readonly TransformEvidence[] = [
  {
    note: "Codex skills are static instruction files; no templating or substitution is documented.",
    source: "https://developers.openai.com/codex/skills",
    verified: "2026-06-11",
  },
  {
    note: "OpenAI's Claude importer flags these constructs as has_unsupported_command_template_features and rejects the import.",
    source: "https://github.com/openai/codex codex-rs/external-agent-migration/src/lib.rs (~L1181)",
    verified: "2026-06-11",
  },
] as const;

const NO_TEMPLATING_REASON =
  "Codex skills have no templating: the construct passes through as inert literal text, " +
  "and OpenAI's Claude importer rejects it (has_unsupported_command_template_features).";

/** `$ARGUMENTS`, including indexed (`$ARGUMENTS[0]`) and dotted access. */
export const dynamicArgumentsEntry: TransformEntry = {
  description: "Claude $ARGUMENTS substitution.",
  evidence: DYNAMIC_EVIDENCE,
  forms: {
    claude: {
      pattern: /\$ARGUMENTS(?:\b|\[[^\]]+\]|\.[A-Za-z_][A-Za-z0-9_-]*)/gu,
    },
  },
  intent: "dynamic.arguments",
  lowering: "none",
  reason: NO_TEMPLATING_REASON,
};

/**
 * Positional arguments (`$0`, `$1`, ...). Matches lint's recognized language
 * (`(^|[^\w$])\$[0-9]+\b`) expressed as a lookbehind so the reported text is
 * the construct alone.
 */
export const dynamicPositionalEntry: TransformEntry = {
  description: "Claude positional-argument substitution ($0/$1/...).",
  evidence: DYNAMIC_EVIDENCE,
  forms: {
    claude: {
      pattern: /(?<![\w$])\$[0-9]+\b/gu,
    },
  },
  intent: "dynamic.positional",
  lowering: "none",
  reason: NO_TEMPLATING_REASON,
};

/** `${CLAUDE_*}` environment substitution. */
export const dynamicEnvSubstitutionEntry: TransformEntry = {
  description: "Claude ${CLAUDE_*} environment substitution.",
  evidence: DYNAMIC_EVIDENCE,
  forms: {
    claude: {
      pattern: /\$\{CLAUDE_[A-Z0-9_]+\}/gu,
    },
  },
  intent: "dynamic.env-substitution",
  lowering: "none",
  reason: NO_TEMPLATING_REASON,
};

/**
 * Pre-resolved shell placeholder: a line whose content (after leading
 * whitespace) starts with !`cmd`. Beyond inertness, the semantics shift on
 * Codex: the model may read a literal !`cmd` line as an instruction to run
 * the command rather than as an already-resolved value.
 */
export const dynamicPreResolutionEntry: TransformEntry = {
  description: "Claude pre-resolved shell-command placeholder (!`cmd`).",
  evidence: DYNAMIC_EVIDENCE,
  forms: {
    claude: {
      pattern: /(?<=^[ \t]*)!`[^`\n]+`/gmu,
    },
  },
  intent: "dynamic.pre-resolution",
  lowering: "none",
  reason:
    `${NO_TEMPLATING_REASON} Semantics also shift: the model may interpret a literal ` +
    "!`cmd` line as an instruction to run the command.",
};
