import { issue, type ProviderFormatConformanceFile, type ProviderFormatConformanceIssue } from "./provider-format-conformance-validation";
import { isJsonRecord } from "./yaml";

/** Shared jd input references only; inline recovery and handler checks belong to their callers. */
export function checkClaudeHookReferences(file: ProviderFormatConformanceFile, value: unknown, prefix: string, providerRef: "claude-plugin-manifest-schema" | "claude-marketplace-schema"): readonly ProviderFormatConformanceIssue[] {
  const issues: ProviderFormatConformanceIssue[] = [];
  const entries = Array.isArray(value) ? value.map((entry, index) => [entry, `${prefix}[${index}]`] as const) : [[value, prefix] as const];
  for (const [entry, path] of entries) {
    if (typeof entry === "string") {
      if (!entry.startsWith("./") || !entry.endsWith(".json")) issues.push(issue(file, "claude", providerRef, "invalid-shape", `destination field ${path} must ${!entry.startsWith("./") ? "start with ./" : "end with .json"}`));
    } else if (Array.isArray(value) && !isJsonRecord(entry)) {
      issues.push(issue(file, "claude", providerRef, "invalid-field-type", `destination field ${path} must be a string or an object`));
    }
  }
  return issues;
}
