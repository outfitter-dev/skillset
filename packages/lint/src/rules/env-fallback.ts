import type { LintDiagnostic, LintRule, LintSubject } from "../types";

/**
 * Plain platform env-var placeholder, e.g. `${CLAUDE_PLUGIN_ROOT}` or
 * `${CODEX_SESSION_ID}`. A placeholder carrying a bash default
 * (`${CLAUDE_SKILL_DIR:-.}`) does not match: the `}` must directly follow
 * the variable name.
 */
const PLAIN_PLACEHOLDER_PATTERN = /\$\{(?:CLAUDE|CODEX)_[A-Z0-9_]+\}/u;

const hasFallbackMarker = (line: string): boolean =>
  line.includes(":-") || line.includes("||");

/**
 * Warn (not error): knowingly target-locked skills legitimately rely on a
 * single platform's variables. Portable skills should prefer relative paths
 * or carry an explicit fallback so other harnesses degrade gracefully.
 */
export const skillEnvVarNoFallbackRule: LintRule = {
  check: (subject: LintSubject): readonly LintDiagnostic[] => {
    const diagnostics: LintDiagnostic[] = [];
    for (const line of subject.body.split(/\r?\n/u)) {
      const match = line.match(PLAIN_PLACEHOLDER_PATTERN);
      if (match === null || hasFallbackMarker(line)) {
        continue;
      }
      diagnostics.push({
        guidance: {
          summary: `Prefer paths relative to the skill directory; if ${match[0]} is unavoidable, provide an explicit fallback (a \`:-\` bash default or an \`||\` alternative) so targets that do not set it degrade gracefully.`,
        },
        message: `uses platform placeholder ${match[0]} without a fallback`,
        path: subject.path,
        rule: "skill-env-var-no-fallback",
        severity: "warn",
      });
    }
    return diagnostics;
  },
  description:
    "Platform env-var placeholders should carry a fallback so skills stay portable across targets.",
  name: "skill-env-var-no-fallback",
  severity: "warn",
};
