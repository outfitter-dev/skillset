import { checkFieldTypes, checkRequiredFields, checkUnknownFields, issue, type ProviderFormatConformanceFile, type ProviderFormatConformanceIssue } from "./provider-format-conformance-validation";
import type { JsonRecord } from "./types";
import { isJsonRecord } from "./yaml";

type ClaudeMonitorProviderRef = "claude-plugin-manifest-schema" | "claude-marketplace-schema";

export function checkClaudeMonitors(file: ProviderFormatConformanceFile, value: unknown, prefix: string, providerRef: ClaudeMonitorProviderRef): readonly ProviderFormatConformanceIssue[] {
  if (typeof value === "string") {
    return value.startsWith("./") && value.endsWith(".json") ? [] : [issue(file, "claude", providerRef, "invalid-shape", `destination field ${prefix} must ${!value.startsWith("./") ? "start with ./" : "end with .json"}`)];
  }
  // Container types are checked by each caller; only array entries need checking here.
  if (!Array.isArray(value)) return [];
  const issues: ProviderFormatConformanceIssue[] = [];
  const names = new Set<string>();
  for (const [index, monitor] of value.entries()) {
    const path = `${prefix}[${index}]`;
    if (!isJsonRecord(monitor)) {
      issues.push(issue(file, "claude", providerRef, "invalid-field-type", `destination field ${path} must be an object`));
      continue;
    }
    issues.push(...checkClaudeMonitorRecord(file, monitor, path, providerRef));
    if (typeof monitor.name === "string") {
      if (names.has(monitor.name)) issues.push(issue(file, "claude", providerRef, "invalid-shape", `destination field ${path}.name must be unique within ${prefix}`));
      names.add(monitor.name);
    }
  }
  return issues;
}

function checkClaudeMonitorRecord(
  file: ProviderFormatConformanceFile,
  monitor: JsonRecord,
  prefix: string,
  providerRef: ClaudeMonitorProviderRef
): readonly ProviderFormatConformanceIssue[] {
  const issues = [
    ...checkRequiredFields(
      file,
      monitor,
      "claude",
      providerRef,
      ["command", "description", "name"],
      prefix
    ),
    ...checkFieldTypes(
      file,
      monitor,
      "claude",
      providerRef,
      { command: "string", description: "string", name: "string", when: "string" },
      prefix
    ),
    ...checkUnknownFields(
      file,
      monitor,
      "claude",
      providerRef,
      ["command", "description", "name", "when"],
      prefix
    ),
  ];
  for (const field of ["command", "description", "name"] as const) {
    if (monitor[field] !== "") continue;
    issues.push(
      issue(
        file,
        "claude",
        providerRef,
        "invalid-shape",
        `destination field ${prefix}.${field} must not be empty`
      )
    );
  }
  if (
    typeof monitor.when === "string" &&
    monitor.when !== "always" &&
    (!monitor.when.startsWith("on-skill-invoke:") || monitor.when.length <= 16)
  ) {
    issues.push(
      issue(
        file,
        "claude",
        providerRef,
        "invalid-shape",
        `destination field ${prefix}.when must be always or start with on-skill-invoke: followed by a nonempty suffix`
      )
    );
  }
  return issues;
}
