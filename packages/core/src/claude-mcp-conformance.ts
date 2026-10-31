import {
  CLAUDE_MCP_VARIANTS, CLAUDE_MCP_PROXY_NULLABLE_FIELDS, CLAUDE_MCP_OAUTH_FIELD_TYPES,
  CLAUDE_MCP_TOOL_POLICIES, CLAUDE_MCP_TOOL_PERMISSIONS,
} from "@skillset/registry";
import {
  checkFieldTypes, checkRequiredFields, issue,
  type ProviderFormatConformanceFile, type ProviderFormatConformanceIssue,
} from "./provider-format-conformance-validation";
import type { JsonRecord } from "./types";
import { isJsonRecord } from "./yaml";

type ProviderRef = "claude-marketplace-schema" | "claude-plugin-manifest-schema";

export function checkClaudeMcpServers(
  file: ProviderFormatConformanceFile, value: unknown, prefix: string, providerRef: ProviderRef
): readonly ProviderFormatConformanceIssue[] {
  const issues: ProviderFormatConformanceIssue[] = [];
  const entries = Array.isArray(value) ? value.map((entry, index) => [entry, `${prefix}[${index}]`] as const) : [[value, prefix] as const];
  for (const [entry, label] of entries) {
    if (typeof entry === "string") {
      const relative = entry.startsWith("./");
      const bundle = entry.endsWith(".mcpb") || entry.endsWith(".dxt");
      if ((relative && entry.endsWith(".json")) || (bundle && (relative || isUrl(entry)))) continue;
      issues.push(issue(file, "claude", providerRef, "invalid-shape", `destination field ${label} must be a ./ JSON or MCP bundle path, or an absolute MCP bundle URL`));
    } else if (isJsonRecord(entry)) {
      for (const [name, config] of Object.entries(entry)) {
        const configPrefix = `${label}.${name}`;
        if (!isJsonRecord(config)) {
          issues.push(issue(file, "claude", providerRef, "invalid-field-type", `destination field ${configPrefix} must be an object`));
        } else {
          issues.push(...checkClaudeMcpConfig(file, config, configPrefix, providerRef));
        }
      }
    } else if (Array.isArray(value)) {
      issues.push(issue(file, "claude", providerRef, "invalid-field-type", `destination field ${label} must be a string or an object`));
    }
    // The caller's top-level field checker owns scalar/container diagnostics.
  }
  return issues;
}

function checkClaudeMcpConfig(
  file: ProviderFormatConformanceFile, config: JsonRecord, prefix: string, providerRef: ProviderRef
): readonly ProviderFormatConformanceIssue[] {
  const type = config.type === undefined ? "stdio" : config.type;
  if (typeof type !== "string" || !Object.hasOwn(CLAUDE_MCP_VARIANTS, type)) {
    return [issue(file, "claude", providerRef, "invalid-shape", `destination field ${prefix}.type must be a supported Claude MCP transport`)];
  }
  const variant = CLAUDE_MCP_VARIANTS[type as keyof typeof CLAUDE_MCP_VARIANTS];
  const issues = [
    ...checkRequiredFields(file, config, "claude", providerRef, variant.required, prefix),
    ...checkFieldTypes(file, config, "claude", providerRef, variant.fields, prefix),
  ];
  if (type === "stdio" && config.command === "") {
    issues.push(issue(file, "claude", providerRef, "invalid-shape", `destination field ${prefix}.command must not be empty`));
  }
  if (typeof config.timeout === "number" && (!Number.isInteger(config.timeout) || config.timeout <= 0)) {
    issues.push(issue(file, "claude", providerRef, "invalid-shape", `destination field ${prefix}.timeout must be a positive integer`));
  }
  for (const field of ["env", "headers"] as const) {
    if (!Object.hasOwn(variant.fields, field) || !isJsonRecord(config[field])) continue;
    for (const [key, entry] of Object.entries(config[field])) {
      if (typeof entry === "string") continue;
      issues.push(issue(file, "claude", providerRef, "invalid-field-type", `destination field ${prefix}.${field}.${key} must be a string`));
    }
  }
  if (Object.hasOwn(variant.fields, "oauth") && isJsonRecord(config.oauth)) {
    issues.push(...checkClaudeMcpOauth(file, config.oauth, `${prefix}.oauth`, providerRef));
  }
  if (Object.hasOwn(variant.fields, "tools") && Array.isArray(config.tools)) {
    for (const [index, tool] of config.tools.entries()) {
      const label = `${prefix}.tools[${index}]`;
      if (!isJsonRecord(tool)) {
        issues.push(issue(file, "claude", providerRef, "invalid-field-type", `destination field ${label} must be an object`));
        continue;
      }
      issues.push(...checkRequiredFields(file, tool, "claude", providerRef, ["name"], label));
      issues.push(...checkFieldTypes(file, tool, "claude", providerRef, { name: "string", permission_policy: "string" }, label));
      if (typeof tool.permission_policy === "string" && !CLAUDE_MCP_TOOL_POLICIES.some((policy) => policy === tool.permission_policy)) {
        issues.push(issue(file, "claude", providerRef, "invalid-shape", `destination field ${label}.permission_policy must be always_allow, always_ask, or always_deny`));
      }
    }
  }
  if (Object.hasOwn(variant.fields, "toolPermissions") && isJsonRecord(config.toolPermissions)) {
    for (const [name, permission] of Object.entries(config.toolPermissions)) {
      if (CLAUDE_MCP_TOOL_PERMISSIONS.some((value) => value === permission)) continue;
      issues.push(issue(file, "claude", providerRef, "invalid-shape", `destination field ${prefix}.toolPermissions.${name} must be allow, ask, or blocked`));
    }
  }
  if (type === "claudeai-proxy") {
    const nonNull = Object.fromEntries(Object.entries(config).filter(([, entry]) => entry !== null));
    issues.push(...checkFieldTypes(file, nonNull, "claude", providerRef, CLAUDE_MCP_PROXY_NULLABLE_FIELDS, prefix));
  }
  return issues;
}

function checkClaudeMcpOauth(
  file: ProviderFormatConformanceFile, oauth: JsonRecord, prefix: string, providerRef: ProviderRef
): readonly ProviderFormatConformanceIssue[] {
  const issues = [...checkFieldTypes(file, oauth, "claude", providerRef, CLAUDE_MCP_OAUTH_FIELD_TYPES, prefix)];
  if (typeof oauth.callbackPort === "number" && (!Number.isInteger(oauth.callbackPort) || oauth.callbackPort <= 0)) {
    issues.push(issue(file, "claude", providerRef, "invalid-shape", `destination field ${prefix}.callbackPort must be a positive integer`));
  }
  if (typeof oauth.authServerMetadataUrl === "string") {
    if (!isUrl(oauth.authServerMetadataUrl)) {
      issues.push(issue(file, "claude", providerRef, "invalid-shape", `destination field ${prefix}.authServerMetadataUrl must be a parsable absolute URL`));
    } else if (!oauth.authServerMetadataUrl.startsWith("https://")) {
      issues.push(issue(file, "claude", providerRef, "invalid-shape", `destination field ${prefix}.authServerMetadataUrl must start with https://`));
    }
  }
  if (oauth.scopes === "") {
    issues.push(issue(file, "claude", providerRef, "invalid-shape", `destination field ${prefix}.scopes must not be empty`));
  }
  return issues;
}

function isUrl(value: string): boolean {
  try { new URL(value); return true; } catch { return false; }
}
