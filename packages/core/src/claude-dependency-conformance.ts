import { CLAUDE_DEPENDENCY_PATTERN, CLAUDE_DEPENDENCY_NAME_PATTERN } from "@skillset/registry";
import { checkFieldTypes, checkRequiredFields, issue, type ProviderFormatConformanceFile, type ProviderFormatConformanceIssue } from "./provider-format-conformance-validation";
import { isJsonRecord } from "./yaml";

export function checkClaudeDependencies(
  file: ProviderFormatConformanceFile,
  dependencies: readonly unknown[],
  prefix: string,
  providerRef: "claude-marketplace-schema" | "claude-plugin-manifest-schema"
): readonly ProviderFormatConformanceIssue[] {
  const issues: ProviderFormatConformanceIssue[] = [];
  for (const [index, dependency] of dependencies.entries()) {
    const label = `${prefix}[${index}]`;
    if (typeof dependency === "string") {
      if (!CLAUDE_DEPENDENCY_PATTERN.test(dependency)) {
        issues.push(issue(file, "claude", providerRef, "invalid-shape", `destination field ${label} must be a valid plugin dependency identifier`));
      }
      continue;
    }
    if (!isJsonRecord(dependency)) {
      issues.push(issue(file, "claude", providerRef, "invalid-field-type", `destination field ${label} must be a string or an object`));
      continue;
    }
    issues.push(...checkRequiredFields(file, dependency, "claude", providerRef, ["name"], label));
    issues.push(...checkFieldTypes(file, dependency, "claude", providerRef, { name: "string", marketplace: "string" }, label));
    for (const field of ["name", "marketplace"] as const) {
      const value = dependency[field];
      if (typeof value !== "string") continue;
      if (value === "") {
        issues.push(issue(file, "claude", providerRef, "invalid-shape", `destination field ${label}.${field} must not be empty`));
      } else if (!CLAUDE_DEPENDENCY_NAME_PATTERN.test(value)) {
        issues.push(issue(file, "claude", providerRef, "invalid-shape", `destination field ${label}.${field} must be a valid ${field === "name" ? "plugin" : "marketplace"} name`));
      }
    }
    // Ec accepts extra input fields, then transforms the object to an identifier.
    // Conformance checks inputs only; it neither applies that transform nor promises preservation.
  }
  return issues;
}
