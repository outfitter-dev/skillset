import { CLAUDE_EXPERIMENTAL_FIELD_TYPES, CLAUDE_SYNTAX_LANGUAGE_STRING_RULES } from "@skillset/registry";
import { checkClaudeComponentReferences } from "./claude-component-reference-conformance";
import { checkClaudeMonitors } from "./claude-monitor-conformance";
import { checkFieldTypes, checkRequiredFields, checkUnknownFields, issue, type ProviderFormatConformanceFile, type ProviderFormatConformanceIssue } from "./provider-format-conformance-validation";
import type { JsonRecord } from "./types";
import { isJsonRecord } from "./yaml";

type ClaudeExperimentalProviderRef = "claude-plugin-manifest-schema" | "claude-marketplace-schema";

export function checkClaudeExperimental(file: ProviderFormatConformanceFile, value: JsonRecord, prefix: string, providerRef: ClaudeExperimentalProviderRef): readonly ProviderFormatConformanceIssue[] {
  // The base parser passes unknown keys through; the provider validator warns.
  // Preserve Core's existing blocking unknown-field policy using the actual warning inventory.
  return [
    ...checkFieldTypes(file, value, "claude", providerRef, CLAUDE_EXPERIMENTAL_FIELD_TYPES, prefix),
    ...checkUnknownFields(file, value, "claude", providerRef, Object.keys(CLAUDE_EXPERIMENTAL_FIELD_TYPES), prefix),
    ...checkClaudeComponentReferences(file, { themes: value.themes, outputStyles: value.outputStyles }, prefix, providerRef),
    ...checkClaudeMonitors(file, value.monitors, `${prefix}.monitors`, providerRef),
    ...(isJsonRecord(value.syntaxHighlighting) ? checkClaudeSyntaxHighlighting(file, value.syntaxHighlighting, `${prefix}.syntaxHighlighting`, providerRef) : []),
  ];
}

function checkClaudeSyntaxHighlighting(file: ProviderFormatConformanceFile, value: JsonRecord, prefix: string, providerRef: ClaudeExperimentalProviderRef): readonly ProviderFormatConformanceIssue[] {
  const issues = [
    ...checkRequiredFields(file, value, "claude", providerRef, ["hljsLanguages"], prefix),
    ...checkFieldTypes(file, value, "claude", providerRef, { hljsLanguages: "array" }, prefix),
    ...checkUnknownFields(file, value, "claude", providerRef, ["hljsLanguages"], prefix),
  ];
  if (!Array.isArray(value.hljsLanguages)) return issues;
  if (value.hljsLanguages.length > 16) issues.push(issue(file, "claude", providerRef, "invalid-shape", `destination field ${prefix}.hljsLanguages must have at most 16 entries`));
  for (const [index, language] of value.hljsLanguages.entries()) {
    const path = `${prefix}.hljsLanguages[${index}]`;
    if (!isJsonRecord(language)) {
      issues.push(issue(file, "claude", providerRef, "invalid-field-type", `destination field ${path} must be an object`));
      continue;
    }
    issues.push(
      ...checkRequiredFields(file, language, "claude", providerRef, ["id"], path),
      ...checkFieldTypes(file, language, "claude", providerRef, { id:"string", remote:"string", integrity:"string" }, path),
      ...checkUnknownFields(file, language, "claude", providerRef, Object.keys(CLAUDE_SYNTAX_LANGUAGE_STRING_RULES), path)
    );
    for (const [field, rule] of Object.entries(CLAUDE_SYNTAX_LANGUAGE_STRING_RULES)) {
      const entry = language[field];
      if (typeof entry === "string" && (entry.length > rule.maxLength || !rule.pattern.test(entry))) issues.push(issue(file, "claude", providerRef, "invalid-shape", `destination field ${path}.${field} must ${rule.description} and be at most ${rule.maxLength} characters`));
    }
  }
  return issues;
}
