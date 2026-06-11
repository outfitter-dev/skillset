import { listLintRules } from "./registry";
import type { LintDiagnostic, LintRule, LintSubject } from "./types";

export const runLintRules = (
  subjects: readonly LintSubject[],
  rules: readonly LintRule[] = listLintRules()
): readonly LintDiagnostic[] => {
  const diagnostics: LintDiagnostic[] = [];
  for (const subject of subjects) {
    for (const rule of rules) {
      diagnostics.push(...rule.check(subject));
    }
  }
  return diagnostics;
};
