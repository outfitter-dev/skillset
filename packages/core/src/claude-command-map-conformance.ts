import { checkFieldTypes, issue, type ProviderFormatConformanceFile, type ProviderFormatConformanceIssue } from "./provider-format-conformance-validation";
import type { JsonRecord } from "./types";
import { isJsonRecord } from "./yaml";

// The pinned Claude parser shares this command schema across both manifest contexts.
// Its objects strip unknown keys, and source/content use a truthiness XOR.
export function checkClaudeCommandMap(
  file: ProviderFormatConformanceFile,
  commands: JsonRecord,
  prefix: string,
  providerRef: "claude-plugin-manifest-schema" | "claude-marketplace-schema"
): readonly ProviderFormatConformanceIssue[] {
  const issues: ProviderFormatConformanceIssue[] = [];
  for (const [name, command] of Object.entries(commands)) {
    const commandPrefix = `${prefix}.${name}`;
    if (!isJsonRecord(command)) {
      issues.push(issue(file, "claude", providerRef, "invalid-field-type", `destination field ${commandPrefix} must be an object`));
      continue;
    }
    issues.push(
      ...checkFieldTypes(file, command, "claude", providerRef, {
        allowedTools: "string-array",
        argumentHint: "string",
        content: "string",
        description: "string",
        model: "string",
        source: "string",
      }, commandPrefix)
    );
    if (
      typeof command.source === "string" &&
      !command.source.startsWith("./")
    ) {
      issues.push(
        issue(
          file,
          "claude",
          providerRef,
          "invalid-shape",
          `destination field ${commandPrefix}.source must start with ./`
        )
      );
    }
    if (
      (command.source === undefined || typeof command.source === "string") &&
      (command.content === undefined || typeof command.content === "string") &&
      Boolean(command.source) === Boolean(command.content)
    ) {
      issues.push(
        issue(
          file,
          "claude",
          providerRef,
          "invalid-shape",
          `destination field ${commandPrefix} must define exactly one nonempty source or content`
        )
      );
    }
  }
  return issues;
}
