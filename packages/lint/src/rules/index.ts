import { registerLintRule } from "../registry";
import type { LintRule } from "../types";
import {
  skillDescriptionHtmlTokenRule,
  skillDescriptionLengthRule,
  skillDescriptionStrictYamlRule,
} from "./description";
import { skillNameDirectoryMismatchRule } from "./name-directory";

/** Built-in frontmatter rules, registered on package import. */
export const builtinLintRules: readonly LintRule[] = [
  skillDescriptionHtmlTokenRule,
  skillDescriptionLengthRule,
  skillDescriptionStrictYamlRule,
  skillNameDirectoryMismatchRule,
];

for (const rule of builtinLintRules) {
  registerLintRule(rule);
}

export {
  skillDescriptionHtmlTokenRule,
  skillDescriptionLengthRule,
  skillDescriptionStrictYamlRule,
  skillNameDirectoryMismatchRule,
};
