import { CLAUDE_LSP_FIELD_TYPES } from "@skillset/registry";
import { checkFieldTypes, checkRequiredFields, checkUnknownFields, issue, type ProviderFormatConformanceFile, type ProviderFormatConformanceIssue } from "./provider-format-conformance-validation";
import type { JsonRecord } from "./types";
import { isJsonRecord } from "./yaml";

type ClaudeLspProviderRef = "claude-plugin-manifest-schema" | "claude-marketplace-schema";

export function checkClaudeLspServers(file: ProviderFormatConformanceFile, value: unknown, prefix: string, providerRef: ClaudeLspProviderRef): readonly ProviderFormatConformanceIssue[] {
  const issues: ProviderFormatConformanceIssue[] = [];
  const entries = Array.isArray(value) ? value.map((entry, index) => [entry, `${prefix}[${index}]`] as const) : [[value, prefix] as const];
  for (const [entry, path] of entries) {
    if (typeof entry === "string") {
      if (!entry.startsWith("./") || !entry.endsWith(".json")) issues.push(issue(file, "claude", providerRef, "invalid-shape", `destination field ${path} must ${!entry.startsWith("./") ? "start with ./" : "end with .json"}`));
    } else if (isJsonRecord(entry)) {
      for (const [name, config] of Object.entries(entry)) issues.push(...checkClaudeLspConfig(file, config, `${path}.${name}`, providerRef));
    } else if (Array.isArray(value)) {
      // The outer manifest type check accepts any array; validate its members here.
      issues.push(issue(file, "claude", providerRef, "invalid-field-type", `destination field ${path} must be a string or an object`));
    }
  }
  return issues;
}

function checkClaudeLspConfig(file: ProviderFormatConformanceFile, config: unknown, configPrefix: string, providerRef: ClaudeLspProviderRef): readonly ProviderFormatConformanceIssue[] {
  if (!isJsonRecord(config)) return [issue(file, "claude", providerRef, "invalid-field-type", `destination field ${configPrefix} must be an object`)];
  const issues: ProviderFormatConformanceIssue[] = [];
  issues.push(
    ...checkRequiredFields(file, config, "claude", providerRef, ["command", "extensionToLanguage"], configPrefix),
    ...checkFieldTypes(file, config, "claude", providerRef, CLAUDE_LSP_FIELD_TYPES, configPrefix),
    ...checkUnknownFields(file, config, "claude", providerRef, [...Object.keys(CLAUDE_LSP_FIELD_TYPES), "initializationOptions", "settings"], configPrefix)
  );
  if (typeof config.transport === "string" && config.transport !== "socket" && config.transport !== "stdio") {
    issues.push(issue(file, "claude", providerRef, "invalid-shape", `destination field ${configPrefix}.transport must be socket or stdio`));
  }
  if (isJsonRecord(config.env)) {
    issues.push(...checkStringRecordValues(file, config.env, `${configPrefix}.env`, providerRef));
  }
  if (typeof config.command === "string" && (config.command.length === 0 || (config.command.includes(" ") && !config.command.startsWith("/")))) {
    issues.push(issue(file, "claude", providerRef, "invalid-shape", `destination field ${configPrefix}.command must not be empty or contain spaces unless it starts with /`));
  }
  if (isJsonRecord(config.extensionToLanguage)) {
    if (Object.keys(config.extensionToLanguage).length === 0) issues.push(issue(file, "claude", providerRef, "invalid-shape", `destination field ${configPrefix}.extensionToLanguage must have at least one mapping`));
    issues.push(...checkStringRecordValues(file, config.extensionToLanguage, `${configPrefix}.extensionToLanguage`, providerRef));
    for (const [extension, language] of Object.entries(config.extensionToLanguage)) {
      if (extension.length < 2) {
        issues.push(issue(file, "claude", providerRef, "invalid-shape", `destination field ${configPrefix}.extensionToLanguage.${extension} must use an extension of at least two characters`));
      }
      if (extension.length >= 2 && !extension.startsWith(".")) issues.push(issue(file, "claude", providerRef, "invalid-shape", `destination field ${configPrefix}.extensionToLanguage.${extension} must start with .`));
      if (language === "") {
        issues.push(issue(file, "claude", providerRef, "invalid-shape", `destination field ${configPrefix}.extensionToLanguage.${extension} must not be empty`));
      }
    }
  }
  if (Array.isArray(config.args)) {
    for (const [index, argument] of config.args.entries()) {
      if (argument !== "") continue;
      issues.push(issue(file, "claude", providerRef, "invalid-shape", `destination field ${configPrefix}.args[${index}] must not be empty`));
    }
  }
  for (const field of ["shutdownTimeout", "startupTimeout"] as const) {
    const timeout = config[field];
    if (typeof timeout === "number" && (!Number.isInteger(timeout) || timeout <= 0)) {
      issues.push(issue(file, "claude", providerRef, "invalid-shape", `destination field ${configPrefix}.${field} must be a positive integer`));
    }
  }
  if (typeof config.maxRestarts === "number" && (!Number.isInteger(config.maxRestarts) || config.maxRestarts < 0)) {
    issues.push(issue(file, "claude", providerRef, "invalid-shape", `destination field ${configPrefix}.maxRestarts must be a nonnegative integer`));
  }

  return issues;
}

function checkStringRecordValues(
  file: ProviderFormatConformanceFile,
  value: JsonRecord,
  prefix: string,
  providerRef: ClaudeLspProviderRef
): readonly ProviderFormatConformanceIssue[] {
  return Object.entries(value)
    .filter(([, entry]) => typeof entry !== "string")
    .map(([key]) => issue(
      file,
      "claude",
      providerRef,
      "invalid-field-type",
      `destination field ${prefix}.${key} must be a string`
    ));
}
