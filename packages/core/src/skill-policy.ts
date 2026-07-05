import type { JsonRecord, JsonValue, TargetName } from "./types";
import { targetNames } from "./targets";
import { isJsonRecord } from "./yaml";

const TARGET_KEYS = targetNames();

export const PORTABLE_TOOL_ASPECTS = ["mcp", "read", "search", "shell", "write"] as const;

export type ToolsAspect = (typeof PORTABLE_TOOL_ASPECTS)[number];

const PORTABLE_TOOL_KEYS = new Set<string>(PORTABLE_TOOL_ASPECTS);
const PROVIDER_NATIVE_KEYS = new Set(["allow", "deny"]);
const READONLY_TOOLS: JsonRecord = {
  read: true,
  search: true,
  write: false,
};

export type ToolsPolicyLayer = "base" | "macro" | "provider-override";

export type AllowedToolsValue = false | readonly string[];

export interface ClaudeNativeToolRules {
  readonly allow: readonly string[];
  readonly deny: readonly string[];
}

export interface ToolsPolicyMetadata extends JsonRecord {
  readonly portable?: JsonRecord;
  readonly target_native?: JsonRecord;
}

export interface EffectiveToolsPolicy {
  readonly hasSource: boolean;
  readonly macro?: "readonly";
  readonly nativeAllow: readonly string[];
  readonly nativeDeny: readonly string[];
  readonly portable: JsonRecord;
  readonly portableLayers: Readonly<Record<string, ToolsPolicyLayer>>;
  readonly target: TargetName;
}

export function readImplicitInvocation(
  record: JsonRecord,
  target: TargetName,
  label: string
): boolean | undefined {
  const value = readTargetedValue(record, "implicit_invocation", target, label);
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") {
    throw new Error(
      `skillset: expected ${label}.implicit_invocation to be a boolean or target map of booleans`
    );
  }
  return value;
}

export function readAllowedTools(
  record: JsonRecord,
  target: TargetName,
  label: string
): AllowedToolsValue | undefined {
  const value = readTargetedValue(record, "allowed_tools", target, label);
  if (value === undefined) return undefined;
  if (value === false) return false;
  if (typeof value === "string") return [readNonEmptyString(value, `${label}.allowed_tools`)];
  if (Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === "string")) {
    return value.map((item) => readNonEmptyString(item, `${label}.allowed_tools`));
  }
  throw new Error(
    `skillset: expected ${label}.allowed_tools to be false, a string, a string array, or target map`
  );
}

export function readEffectiveToolsPolicy(
  record: JsonRecord,
  targetOptions: JsonRecord,
  target: TargetName,
  label: string
): EffectiveToolsPolicy {
  rejectTargetLocalToolPolicy(targetOptions, target, label);
  const source = readToolsSource(record, label);
  if (source === undefined) {
    return { hasSource: false, nativeAllow: [], nativeDeny: [], portable: {}, portableLayers: {}, target };
  }

  const base = readPortableTools(source.tools, `${label}.tools`);
  const provider = readProviderTools(source.tools[target], `${label}.tools.${target}`);
  const merged = mergePortableTools(base, provider.portable, source.macro);
  validateNativeAllowContradictions(provider.allow, merged.portable, `${label}.tools.${target}.allow`);

  return {
    hasSource: true,
    ...(source.macro === undefined ? {} : { macro: source.macro }),
    nativeAllow: provider.allow,
    nativeDeny: provider.deny,
    portable: merged.portable,
    portableLayers: merged.layers,
    target,
  };
}

export function readClaudeNativeToolRules(
  record: JsonRecord,
  targetOptions: JsonRecord,
  label: string
): ClaudeNativeToolRules {
  const policy = readEffectiveToolsPolicy(record, targetOptions, "claude", label);
  const renderedRules = lowerPortableToolsForClaude(policy.portable, label);
  return {
    allow: [...renderedRules.allow, ...policy.nativeAllow],
    deny: [...renderedRules.deny, ...policy.nativeDeny],
  };
}

export function readToolsPolicyMetadata(
  record: JsonRecord,
  targetOptions: JsonRecord,
  target: TargetName,
  label: string
): ToolsPolicyMetadata {
  const policy = readEffectiveToolsPolicy(record, targetOptions, target, label);
  const metadata: Record<string, JsonRecord> = {};
  if (Object.keys(policy.portable).length > 0) metadata.portable = policy.portable;
  const targetNative: Record<string, JsonValue> = {};
  if (policy.nativeAllow.length > 0) targetNative.allow = [...policy.nativeAllow];
  if (policy.nativeDeny.length > 0) targetNative.deny = [...policy.nativeDeny];
  if (Object.keys(targetNative).length > 0) metadata.target_native = targetNative;
  return metadata;
}

function hasTargetedValue(record: JsonRecord, key: string): boolean {
  const value = record[key];
  return isJsonRecord(value) && TARGET_KEYS.some((target) => value[target] !== undefined);
}

function readTargetedValue(
  record: JsonRecord,
  key: string,
  target: TargetName,
  label: string
): JsonValue | undefined {
  const value = record[key];
  if (value === undefined) return undefined;
  if (!hasTargetedValue(record, key)) return value;
  for (const mapKey of Object.keys(value as JsonRecord)) {
    if (!TARGET_KEYS.includes(mapKey as TargetName)) {
      throw new Error(
        `skillset: expected ${label}.${key} target map to contain only ${formatTargetKeys()} keys`
      );
    }
  }
  return (value as JsonRecord)[target];
}

function readToolsSource(
  record: JsonRecord,
  label: string
): { readonly macro?: "readonly"; readonly tools: JsonRecord } | undefined {
  if (record.tool_intent !== undefined) {
    throw new Error(`skillset: ${label} uses retired tool_intent; use tools`);
  }
  const value = record.tools;
  if (value === undefined) return undefined;
  if (value === "readonly") return { macro: "readonly", tools: READONLY_TOOLS };
  if (!isJsonRecord(value)) {
    throw new Error(`skillset: expected ${label}.tools to be readonly or an object`);
  }

  for (const key of Object.keys(value)) {
    if (PORTABLE_TOOL_KEYS.has(key) || TARGET_KEYS.includes(key as TargetName)) continue;
    if (PROVIDER_NATIVE_KEYS.has(key)) {
      throw new Error(`skillset: ${label}.tools.${key} is provider-native; move it under tools.<provider>.${key}`);
    }
    throw new Error(`skillset: unknown tools key ${key} in ${label}.tools`);
  }

  return { tools: value };
}

function rejectTargetLocalToolPolicy(targetOptions: JsonRecord, target: TargetName, label: string): void {
  if (targetOptions.tool_intent !== undefined) {
    throw new Error(`skillset: ${label}.${target}.tool_intent is retired; use top-level tools.${target}`);
  }
  if (targetOptions.tools !== undefined) {
    throw new Error(`skillset: ${label}.${target}.tools is unsupported; use top-level tools.${target}`);
  }
}

function readProviderTools(
  value: JsonValue | undefined,
  label: string
): { readonly allow: readonly string[]; readonly deny: readonly string[]; readonly portable: JsonRecord } {
  if (value === undefined) return { allow: [], deny: [], portable: {} };
  if (!isJsonRecord(value)) {
    throw new Error(`skillset: expected ${label} to be an object`);
  }
  for (const key of Object.keys(value)) {
    if (PORTABLE_TOOL_KEYS.has(key) || PROVIDER_NATIVE_KEYS.has(key)) continue;
    throw new Error(`skillset: unknown tools key ${key} in ${label}`);
  }
  return {
    allow: readNativeRuleList(value.allow, `${label}.allow`),
    deny: readNativeRuleList(value.deny, `${label}.deny`),
    portable: readPortableTools(value, label),
  };
}

function readPortableTools(record: JsonRecord, label: string): JsonRecord {
  const normalized: Record<string, JsonValue> = {};
  for (const [key, rawValue] of Object.entries(record)) {
    if (!isToolsAspect(key)) continue;
    if (rawValue === undefined) continue;
    normalized[key] = normalizePortableToolValue(key, rawValue, `${label}.${key}`);
  }
  return normalized;
}

function normalizePortableToolValue(key: ToolsAspect, value: JsonValue, label: string): JsonValue {
  switch (key) {
    case "read":
    case "search":
    case "write":
      return normalizeBoolean(value, label);
    case "shell":
      return normalizeShellToolValue(value, label);
    case "mcp":
      return normalizeMcpToolValue(value, label);
  }
}

function normalizeBoolean(value: JsonValue, label: string): boolean {
  if (typeof value === "boolean") return value;
  throw new Error(`skillset: expected ${label} to be true or false`);
}

function normalizeShellToolValue(value: JsonValue, label: string): JsonValue {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return [readNonEmptyString(value, label)];
  if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
    return value.map((item) => readNonEmptyString(item, label));
  }
  throw new Error(`skillset: expected ${label} to be true, false, a shell pattern, or shell pattern list`);
}

function normalizeMcpToolValue(value: JsonValue, label: string): JsonValue {
  if (value === false) return false;
  if (!isJsonRecord(value)) {
    throw new Error(`skillset: expected ${label} to be false or an object keyed by literal MCP server name`);
  }

  const servers: Record<string, JsonValue> = {};
  for (const [server, rawServerValue] of Object.entries(value)) {
    const serverName = readMcpServerName(server, `${label} server`);
    if (typeof rawServerValue === "boolean") {
      servers[serverName] = rawServerValue;
      continue;
    }
    if (typeof rawServerValue === "string" || Array.isArray(rawServerValue)) {
      servers[serverName] = normalizeStringList(rawServerValue, `${label}.${serverName}`);
      continue;
    }
    throw new Error(
      `skillset: expected ${label}.${serverName} to be true, false, a tool glob, or a tool glob list`
    );
  }

  return servers;
}

function readMcpServerName(value: string, label: string): string {
  const server = readNonEmptyString(value, label);
  if (server.includes("*")) {
    throw new Error(`skillset: ${label} must be a literal MCP server name; wildcard server grants are unsupported`);
  }
  return server;
}

function normalizeStringList(value: JsonValue | undefined, label: string): string[] {
  if (typeof value === "string") return [readNonEmptyString(value, label)];
  if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
    return value.map((item) => readNonEmptyString(item, label));
  }
  throw new Error(`skillset: expected ${label} to be a string or string array`);
}

function readNativeRuleList(value: JsonValue | undefined, label: string): readonly string[] {
  if (value === undefined || value === false) return [];
  if (typeof value === "string") return [readNonEmptyString(value, label)];
  if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
    return value.map((item) => readNonEmptyString(item, label));
  }
  throw new Error(`skillset: expected ${label} to be a native rule string or string array`);
}

function mergePortableTools(
  base: JsonRecord,
  override: JsonRecord,
  macro: "readonly" | undefined
): { readonly layers: Readonly<Record<string, ToolsPolicyLayer>>; readonly portable: JsonRecord } {
  const merged: Record<string, JsonValue> = {};
  const layers: Record<string, ToolsPolicyLayer> = {};
  const baseLayer: ToolsPolicyLayer = macro === undefined ? "base" : "macro";
  for (const [key, value] of Object.entries(base)) {
    if (value === undefined) continue;
    merged[key] = value;
    layers[key] = baseLayer;
  }
  for (const [key, value] of Object.entries(override)) {
    if (value === undefined) continue;
    if (key === "mcp" && isJsonRecord(merged.mcp) && isJsonRecord(value)) {
      merged.mcp = { ...merged.mcp, ...value };
      layers.mcp = "provider-override";
      continue;
    }
    merged[key] = value;
    layers[key] = "provider-override";
  }
  return { layers, portable: merged };
}

function lowerPortableToolsForClaude(
  tools: JsonRecord,
  label: string
): ClaudeNativeToolRules {
  const allow: string[] = [];
  const deny: string[] = [];

  for (const [key, value] of Object.entries(tools)) {
    if (value === undefined || !isToolsAspect(key)) continue;
    const aspectRules = lowerClaudeToolAspect(key, value, `${label}.tools.${key}`);
    allow.push(...aspectRules.allow);
    deny.push(...aspectRules.deny);
  }

  return { allow, deny };
}

export function isToolsAspect(value: string): value is ToolsAspect {
  return PORTABLE_TOOL_KEYS.has(value);
}

export function lowerClaudeToolAspect(
  aspect: ToolsAspect,
  value: JsonValue,
  label: string
): ClaudeNativeToolRules {
  const allow: string[] = [];
  const deny: string[] = [];
  switch (aspect) {
    case "read":
      pushBooleanRules(allow, deny, value, ["Read"], label);
      break;
    case "search":
      pushBooleanRules(allow, deny, value, ["Grep", "Glob"], label);
      break;
    case "write":
      pushBooleanRules(allow, deny, value, ["Write", "Edit"], label);
      break;
    case "shell":
      lowerShellRules(allow, deny, value, label);
      break;
    case "mcp":
      lowerMcpRules(allow, deny, value, label);
      break;
  }
  return { allow, deny };
}

function pushBooleanRules(
  allow: string[],
  deny: string[],
  value: JsonValue,
  rules: readonly string[],
  label: string
): void {
  if (value === true) {
    allow.push(...rules);
    return;
  }
  if (value === false) {
    deny.push(...rules);
    return;
  }
  throw new Error(`skillset: expected ${label} to be true or false`);
}

function lowerShellRules(allow: string[], deny: string[], value: JsonValue, label: string): void {
  if (value === true) {
    allow.push("Bash");
    return;
  }
  if (value === false) {
    deny.push("Bash");
    return;
  }
  if (!Array.isArray(value)) {
    throw new Error(`skillset: expected ${label} to be true, false, or normalized shell pattern list`);
  }
  for (const pattern of value) {
    if (typeof pattern !== "string") {
      throw new Error(`skillset: expected ${label} entries to be strings`);
    }
    allow.push(`Bash(${readNonEmptyString(pattern, label)})`);
  }
}

function lowerMcpRules(allow: string[], deny: string[], value: JsonValue, label: string): void {
  if (value === false) {
    deny.push("mcp__*");
    return;
  }
  if (!isJsonRecord(value)) {
    throw new Error(`skillset: expected ${label} to be false or normalized MCP server entries`);
  }
  for (const [server, rawServerValue] of Object.entries(value)) {
    if (rawServerValue === true) {
      allow.push(`mcp__${server}`);
      continue;
    }
    if (rawServerValue === false) {
      deny.push(`mcp__${server}`);
      continue;
    }
    const tools = normalizeStringList(rawServerValue, `${label}.${server}`);
    for (const tool of tools) {
      allow.push(`mcp__${server}__${readNonEmptyString(tool, `${label}.${server}`)}`);
    }
  }
}

function validateNativeAllowContradictions(
  nativeAllow: readonly string[],
  portable: JsonRecord,
  label: string
): void {
  for (const rule of nativeAllow) {
    const family = classifyNativeToolRule(rule);
    if (family === undefined) continue;
    if (portableDeniesFamily(portable, family, rule)) {
      throw new Error(
        `skillset: ${label} native allow ${rule} contradicts effective tools.${family}: false; use a provider portable override to change the constraint`
      );
    }
  }
}

/**
 * Attributes a provider-native rule string to a portable capability family for
 * contradiction detection. Unknown rules return undefined and stay valid as
 * unclassified, provenance-only native source.
 */
export function classifyNativeToolRule(rule: string): ToolsAspect | undefined {
  if (/^Bash(?:\(|$)/u.test(rule)) return "shell";
  if (rule.startsWith("mcp__")) return "mcp";
  if (/^(?:Write|Edit)(?:\(|$)/u.test(rule)) return "write";
  if (/^Read(?:\(|$)/u.test(rule)) return "read";
  if (/^(?:Grep|Glob)(?:\(|$)/u.test(rule)) return "search";
  return undefined;
}

function portableDeniesFamily(portable: JsonRecord, family: ToolsAspect, rule: string): boolean {
  const value = portable[family];
  if (value === false) return true;
  if (family !== "mcp" || !isJsonRecord(value)) return false;
  const server = mcpServerFromRule(rule);
  return server !== undefined && value[server] === false;
}

function mcpServerFromRule(rule: string): string | undefined {
  const match = /^mcp__([^_]+)(?:__|$)/u.exec(rule);
  return match?.[1];
}

function formatTargetKeys(): string {
  if (TARGET_KEYS.length <= 1) return TARGET_KEYS.join("");
  return `${TARGET_KEYS.slice(0, -1).join(", ")}, or ${TARGET_KEYS.at(-1)}`;
}

function readNonEmptyString(value: string, label: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new Error(`skillset: expected ${label} entries to be non-empty strings`);
  }
  return trimmed;
}
