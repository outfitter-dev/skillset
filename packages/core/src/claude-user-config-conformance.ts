import { checkFieldTypes, checkRequiredFields, checkUnknownFields, issue, type ProviderFormatConformanceFile, type ProviderFormatConformanceIssue } from "./provider-format-conformance-validation";
import type { JsonRecord } from "./types";
import { isJsonRecord } from "./yaml";

type ClaudeConfigProviderRef = "claude-marketplace-schema" | "claude-plugin-manifest-schema";

// Both manifest paths share Ls; only root Zd applies identifier keys.
export function checkClaudeUserConfig(
  file: ProviderFormatConformanceFile,
  config: JsonRecord,
  prefix: string,
  providerRef: ClaudeConfigProviderRef,
  keyPolicy: "identifier" | "any-string"
): readonly ProviderFormatConformanceIssue[] {
  const issues: ProviderFormatConformanceIssue[] = [];
  for (const [name, entry] of Object.entries(config)) {
    const entryPrefix = `${prefix}.${name}`;
    if (keyPolicy === "identifier" && !/^[A-Za-z_]\w*$/u.test(name)) {
      issues.push(issue(file, "claude", providerRef, "invalid-shape", `destination field ${entryPrefix} must use an identifier key`));
    }
    if (!isJsonRecord(entry)) {
      issues.push(issue(file, "claude", providerRef, "invalid-field-type", `destination field ${entryPrefix} must be an object`));
      continue;
    }
    issues.push(
      ...checkRequiredFields(file, entry, "claude", providerRef, ["description", "title", "type"], entryPrefix),
      ...checkFieldTypes(file, entry, "claude", providerRef, {
        description: "string", max: "number", min: "number", multiple: "boolean",
        required: "boolean", sensitive: "boolean", title: "string", type: "string",
      }, entryPrefix),
      ...checkUnknownFields(file, entry, "claude", providerRef, [
        "default", "description", "max", "min", "multiple", "required", "sensitive", "title", "type",
      ], entryPrefix)
    );
    if (typeof entry.type === "string" && !["boolean", "directory", "file", "number", "string"].includes(entry.type)) {
      issues.push(issue(file, "claude", providerRef, "invalid-shape", `destination field ${entryPrefix}.type must be boolean, directory, file, number, or string`));
    }
    if (
      entry.default !== undefined &&
      typeof entry.default !== "string" &&
      typeof entry.default !== "number" &&
      typeof entry.default !== "boolean" &&
      !(Array.isArray(entry.default) && entry.default.every((value) => typeof value === "string"))
    ) {
      issues.push(issue(file, "claude", providerRef, "invalid-field-type", `destination field ${entryPrefix}.default must be a string, number, boolean, or array of strings`));
    }
  }
  return issues;
}

export function checkClaudeChannels(
  file: ProviderFormatConformanceFile,
  channels: readonly unknown[],
  prefix: string,
  providerRef: ClaudeConfigProviderRef
): readonly ProviderFormatConformanceIssue[] {
  const issues: ProviderFormatConformanceIssue[] = [];
  const report = (code: "invalid-field-type" | "invalid-shape" | "missing-required-field", message: string) => {
    issues.push(issue(file, "claude", providerRef, code, message));
  };
  for (const [index, channel] of channels.entries()) {
    const channelPrefix = `${prefix}[${index}]`;
    if (!isJsonRecord(channel)) {
      report("invalid-field-type", `destination field ${channelPrefix} must be an object`);
      continue;
    }
    if (channel.server === undefined) {
      report("missing-required-field", `missing required destination field ${channelPrefix}.server`);
    } else if (typeof channel.server !== "string") {
      report("invalid-field-type", `destination field ${channelPrefix}.server must be a string`);
    } else if (channel.server === "") {
      report("invalid-shape", `destination field ${channelPrefix}.server must not be empty`);
    }
    issues.push(
      ...checkFieldTypes(
        file,
        channel,
        "claude",
        providerRef,
        { displayName: "string", userConfig: "object" },
        channelPrefix
      ),
      ...checkUnknownFields(
        file,
        channel,
        "claude",
        providerRef,
        ["displayName", "server", "userConfig"],
        channelPrefix
      )
    );
    if (isJsonRecord(channel.userConfig)) {
      issues.push(
        ...checkClaudeUserConfig(file, channel.userConfig, `${channelPrefix}.userConfig`, providerRef, "any-string")
      );
    }
  }
  return issues;
}
