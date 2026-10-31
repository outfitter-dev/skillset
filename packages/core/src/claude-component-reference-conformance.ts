import { CLAUDE_COMPONENT_REFERENCE_POLICY } from "@skillset/registry";
import { issue, type ProviderFormatConformanceFile, type ProviderFormatConformanceIssue } from "./provider-format-conformance-validation";
import type { JsonRecord } from "./types";

export function checkClaudeComponentReferences(
  file: ProviderFormatConformanceFile,
  plugin: JsonRecord,
  prefix: string,
  providerRef: "claude-plugin-manifest-schema" | "claude-marketplace-schema"
): readonly ProviderFormatConformanceIssue[] {
  const issues: ProviderFormatConformanceIssue[] = [];
  for (const [field, policy] of Object.entries(CLAUDE_COMPONENT_REFERENCE_POLICY)) {
    const value = plugin[field];
    const path = prefix ? `${prefix}.${field}` : field;
    const entries = Array.isArray(value) ? value.map((item, index) => [item, `${path}[${index}]`] as const) : [[value, path] as const];
    for (const [entry, entryPath] of entries) {
      if (typeof entry !== "string") {
        // Other string-array fields already get one outer type diagnostic.
        // Commands also permit maps, so their array members need a local check.
        if (field === "commands" && Array.isArray(value)) {
          issues.push(issue(file, "claude", providerRef, "invalid-field-type", `destination field ${entryPath} must be a string`));
        }
        continue;
      }
      if (policy.allowDot && entry === ".") continue;
      if (!entry.startsWith("./") || (policy.suffix && !entry.endsWith(policy.suffix))) {
        issues.push(issue(file, "claude", providerRef, "invalid-shape", `destination field ${entryPath} must ${!entry.startsWith("./") ? "start with ./" : `end with ${policy.suffix}`}`));
      }
    }
  }
  return issues;
}
