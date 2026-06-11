import type { LintRule } from "./types";

/**
 * Explicit rule registry. Rules are registered by name; no implicit
 * discovery. Built-in rules register on package import (see ./rules).
 */
export const lintRules = new Map<string, LintRule>();

export const registerLintRule = (rule: LintRule): void => {
  if (lintRules.has(rule.name)) {
    throw new Error(`lint rule already registered: ${rule.name}`);
  }
  lintRules.set(rule.name, rule);
};

export const listLintRules = (): readonly LintRule[] => [...lintRules.values()];
