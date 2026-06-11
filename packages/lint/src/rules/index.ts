import { registerLintRule } from "../registry";
import type { LintRule } from "../types";
import {
  skillDescriptionHtmlTokenRule,
  skillDescriptionLengthRule,
  skillDescriptionStrictYamlRule,
} from "./description";
import { skillEnvVarNoFallbackRule } from "./env-fallback";
import { skillFileReferenceEscapeRule } from "./file-reference";
import { skillNameDirectoryMismatchRule } from "./name-directory";
import {
  skillPreresolveCaseStatementRule,
  skillPreresolveMixedAndOrRule,
  skillPreresolveParameterExpansionRule,
  skillPreresolveQuotedSubstitutionRule,
  skillPreresolveSemicolonRule,
} from "./preresolve";

/** Built-in rules, registered on package import. */
export const builtinLintRules: readonly LintRule[] = [
  skillDescriptionHtmlTokenRule,
  skillDescriptionLengthRule,
  skillDescriptionStrictYamlRule,
  skillEnvVarNoFallbackRule,
  skillFileReferenceEscapeRule,
  skillNameDirectoryMismatchRule,
  skillPreresolveCaseStatementRule,
  skillPreresolveMixedAndOrRule,
  skillPreresolveParameterExpansionRule,
  skillPreresolveQuotedSubstitutionRule,
  skillPreresolveSemicolonRule,
];

for (const rule of builtinLintRules) {
  registerLintRule(rule);
}

export {
  skillDescriptionHtmlTokenRule,
  skillDescriptionLengthRule,
  skillDescriptionStrictYamlRule,
  skillEnvVarNoFallbackRule,
  skillFileReferenceEscapeRule,
  skillNameDirectoryMismatchRule,
  skillPreresolveCaseStatementRule,
  skillPreresolveMixedAndOrRule,
  skillPreresolveParameterExpansionRule,
  skillPreresolveQuotedSubstitutionRule,
  skillPreresolveSemicolonRule,
};
