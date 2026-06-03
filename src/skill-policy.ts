import type { JsonRecord, JsonValue, TargetName } from "./types";
import { isJsonRecord } from "./yaml";

const TARGET_KEYS: readonly TargetName[] = ["claude", "codex"];
const PORTABLE_TOOL_KEYS = new Set([
  "edit",
  "mcp",
  "read",
  "search",
  "shell",
  "web_fetch",
  "web_search",
  "write",
]);

export type AllowedToolsValue = false | readonly string[];

export interface ClaudeNativeToolRules {
  readonly allow: readonly string[];
  readonly deny: readonly string[];
}

export interface CodexNativeToolEscapes extends JsonRecord {
  readonly allow?: JsonValue;
  readonly deny?: JsonValue;
}

export interface CodexToolMetadata extends JsonRecord {
  readonly allow?: JsonRecord;
  readonly deny?: JsonRecord;
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
  if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
    return value.map((item) => readNonEmptyString(item, `${label}.allowed_tools`));
  }
  throw new Error(
    `skillset: expected ${label}.allowed_tools to be false, a string, a string array, or target map`
  );
}

export function readClaudeNativeToolRules(
  record: JsonRecord,
  targetOptions: JsonRecord,
  label: string
): ClaudeNativeToolRules {
  const targetAllow = readTargetNativeToolEscape(targetOptions, "_allow", label);
  const targetDeny = readTargetNativeToolEscape(targetOptions, "_deny", label);
  const portable = readPortableToolsPolicy(record, label);
  const nativeAllow =
    targetAllow === false
      ? []
      : [
          ...readClaudeToolRuleList(readPortableToolEscape(record, "_allow", "claude", label), label),
          ...readClaudeToolRuleList(targetAllow, label),
        ];
  const nativeDeny =
    targetDeny === false
      ? []
      : [
          ...readClaudeToolRuleList(readPortableToolEscape(record, "_deny", "claude", label), label),
          ...readClaudeToolRuleList(targetDeny, label),
        ];

  return {
    allow: [...lowerPortableToolsForClaude(portable.allow, label), ...nativeAllow],
    deny: [...lowerPortableToolsForClaude(portable.deny, label), ...nativeDeny],
  };
}

export function readCodexNativeToolEscapes(
  record: JsonRecord,
  targetOptions: JsonRecord,
  label: string
): CodexNativeToolEscapes {
  const escapes: Record<string, JsonValue> = {};
  const allow = mergeCodexEscapeValues(
    readPortableToolEscape(record, "_allow", "codex", label),
    readTargetNativeToolEscape(targetOptions, "_allow", label)
  );
  const deny = mergeCodexEscapeValues(
    readPortableToolEscape(record, "_deny", "codex", label),
    readTargetNativeToolEscape(targetOptions, "_deny", label)
  );

  if (allow !== undefined) escapes.allow = allow;
  if (deny !== undefined) escapes.deny = deny;
  return escapes;
}

export function readCodexToolMetadata(
  record: JsonRecord,
  targetOptions: JsonRecord,
  label: string
): CodexToolMetadata {
  const portable = readPortableToolsPolicy(record, label);
  const native = readCodexNativeToolEscapes(record, targetOptions, label);
  const metadata: Record<string, JsonRecord> = {};
  const allow = codexToolActionMetadata(portable.allow, native.allow);
  const deny = codexToolActionMetadata(portable.deny, native.deny);

  if (allow !== undefined) metadata.allow = allow;
  if (deny !== undefined) metadata.deny = deny;
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
        `skillset: expected ${label}.${key} target map to contain only claude and codex keys`
      );
    }
  }
  return (value as JsonRecord)[target];
}

function readPortableToolEscape(
  record: JsonRecord,
  key: "_allow" | "_deny",
  target: TargetName,
  label: string
): JsonValue | undefined {
  const tools = readToolsRecord(record, `${label}.tool_intent`, true);
  if (tools === undefined) return undefined;
  const value = tools[key];
  if (value === undefined) return undefined;
  if (!hasTargetMap(value)) return value;
  for (const mapKey of Object.keys(value as JsonRecord)) {
    if (!TARGET_KEYS.includes(mapKey as TargetName)) {
      throw new Error(
        `skillset: expected ${label}.tool_intent.${key} target map to contain only claude and codex keys`
      );
    }
  }
  return (value as JsonRecord)[target];
}

function readTargetNativeToolEscape(
  targetOptions: JsonRecord,
  key: "_allow" | "_deny",
  label: string
): JsonValue | undefined {
  const tools = readToolsRecord(targetOptions, `${label} target tool_intent`, false);
  return tools?.[key];
}

/**
 * Read the portable tool-intent block. `tool_intent` is the canonical source key;
 * `tools` is a compatibility alias. Setting both is a conflict, since they mean
 * the same thing. The name signals authoring intent, not a target-enforced
 * permission sandbox.
 */
function readToolsRecord(
  record: JsonRecord,
  label: string,
  allowPortablePolicy: boolean
): JsonRecord | undefined {
  const canonical = record.tool_intent;
  const alias = record.tools;
  if (canonical !== undefined && alias !== undefined) {
    throw new Error(
      `skillset: ${label} sets both tool_intent and the tools compatibility alias; keep tool_intent only`
    );
  }
  const value = canonical ?? alias;
  if (value === undefined) return undefined;
  if (!isJsonRecord(value)) {
    throw new Error(`skillset: expected ${label} to be an object`);
  }
  for (const key of Object.keys(value)) {
    if (key === "_allow" || key === "_deny") continue;
    if (allowPortablePolicy && (key === "allow" || key === "deny")) continue;
    const allowedKeys = allowPortablePolicy
      ? "allow, deny, _allow, and _deny"
      : "_allow and _deny";
    throw new Error(`skillset: expected ${label} to contain only ${allowedKeys} keys`);
  }
  return value;
}

function hasTargetMap(value: JsonValue): boolean {
  return isJsonRecord(value) && TARGET_KEYS.some((target) => value[target] !== undefined);
}

function readClaudeToolRuleList(value: JsonValue | undefined, label: string): readonly string[] {
  if (value === undefined || value === false) return [];
  if (typeof value === "string") return [readNonEmptyString(value, `${label}.tool_intent`)];
  if (Array.isArray(value)) {
    return value.map((item) => readClaudeToolRule(item, label));
  }
  if (isJsonRecord(value)) return [readClaudeToolRule(value, label)];
  throw new Error(
    `skillset: expected ${label}.tool_intent _allow/_deny entries for Claude to be strings or objects with rule`
  );
}

function readClaudeToolRule(value: JsonValue, label: string): string {
  if (typeof value === "string") return readNonEmptyString(value, `${label}.tool_intent`);
  if (isJsonRecord(value)) {
    const rule = value.rule;
    if (typeof rule === "string") return readNonEmptyString(rule, `${label}.tool_intent.rule`);
  }
  throw new Error(
    `skillset: expected ${label}.tool_intent _allow/_deny entries for Claude to be strings or objects with rule`
  );
}

function readPortableToolsPolicy(
  record: JsonRecord,
  label: string
): { readonly allow?: JsonRecord; readonly deny?: JsonRecord } {
  const tools = readToolsRecord(record, `${label}.tool_intent`, true);
  if (tools === undefined) return {};
  const policy: { allow?: JsonRecord; deny?: JsonRecord } = {};
  const allow = readPortableToolsAction(tools.allow, `${label}.tool_intent.allow`);
  const deny = readPortableToolsAction(tools.deny, `${label}.tool_intent.deny`);
  if (allow !== undefined) policy.allow = allow;
  if (deny !== undefined) policy.deny = deny;
  return policy;
}

function readPortableToolsAction(value: JsonValue | undefined, label: string): JsonRecord | undefined {
  if (value === undefined || value === false) return undefined;
  if (!isJsonRecord(value)) {
    throw new Error(`skillset: expected ${label} to be an object of known portable tool keys`);
  }

  const normalized: Record<string, JsonValue> = {};
  for (const [key, rawValue] of Object.entries(value)) {
    if (!PORTABLE_TOOL_KEYS.has(key)) {
      throw new Error(
        `skillset: unknown portable tool key ${key} in ${label}; use a known key or _allow/_deny`
      );
    }
    if (rawValue === undefined || rawValue === false) continue;
    normalized[key] = normalizePortableToolValue(key, rawValue, `${label}.${key}`);
  }

  return Object.keys(normalized).length === 0 ? undefined : normalized;
}

function normalizePortableToolValue(key: string, value: JsonValue, label: string): JsonValue {
  switch (key) {
    case "edit":
    case "read":
    case "search":
    case "write":
      return normalizeBooleanStringList(value, label);
    case "shell":
      return normalizeShellToolValue(value, label);
    case "web_fetch":
      return normalizeWebFetchToolValue(value, label);
    case "web_search":
      if (value !== true) {
        throw new Error(`skillset: expected ${label} to be true`);
      }
      return true;
    case "mcp":
      return normalizeMcpToolValue(value, label);
    default:
      throw new Error(`skillset: unknown portable tool key ${key} in ${label}`);
  }
}

function normalizeBooleanStringList(value: JsonValue, label: string): JsonValue {
  if (value === true) return true;
  if (typeof value === "string") return [readNonEmptyString(value, label)];
  if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
    return value.map((item) => readNonEmptyString(item, label));
  }
  throw new Error(`skillset: expected ${label} to be true, a string, or a string array`);
}

function normalizeShellToolValue(value: JsonValue, label: string): JsonValue {
  if (value === true) return true;
  const items = Array.isArray(value) ? value : [value];
  return items.map((item) => {
    if (typeof item === "string") {
      return { pattern: readNonEmptyString(item, label) };
    }
    if (isJsonRecord(item)) {
      const pattern = item.pattern;
      const command = item.command;
      const prefix = item.prefix;
      if (typeof pattern === "string") {
        return { pattern: readNonEmptyString(pattern, `${label}.pattern`) };
      }
      if (typeof command === "string") {
        return { pattern: readNonEmptyString(command, `${label}.command`) };
      }
      if (Array.isArray(prefix) && prefix.every((part) => typeof part === "string")) {
        const parts = prefix.map((part) => readNonEmptyString(part, `${label}.prefix`));
        return { pattern: `${parts.join(" ")} *` };
      }
    }
    throw new Error(
      `skillset: expected ${label} shell entries to be strings or objects with pattern, command, or prefix`
    );
  });
}

function normalizeWebFetchToolValue(value: JsonValue, label: string): JsonValue {
  if (value === true) return true;
  if (typeof value === "string" || Array.isArray(value)) {
    return { domains: normalizeStringList(value, label) };
  }
  if (isJsonRecord(value)) {
    const domains = value.domains;
    return { domains: normalizeStringList(domains, `${label}.domains`) };
  }
  throw new Error(`skillset: expected ${label} to be true, a domain string/list, or domains object`);
}

function normalizeMcpToolValue(value: JsonValue, label: string): JsonValue {
  if (!isJsonRecord(value)) {
    throw new Error(`skillset: expected ${label} to be an object keyed by MCP server name`);
  }

  const servers: Record<string, JsonValue> = {};
  for (const [server, rawServerValue] of Object.entries(value)) {
    const serverName = readNonEmptyString(server, `${label} server`);
    if (rawServerValue === undefined || rawServerValue === false) continue;
    if (rawServerValue === true) {
      servers[serverName] = { tools: ["*"] };
      continue;
    }
    if (typeof rawServerValue === "string" || Array.isArray(rawServerValue)) {
      servers[serverName] = { tools: normalizeStringList(rawServerValue, `${label}.${serverName}`) };
      continue;
    }
    if (isJsonRecord(rawServerValue)) {
      servers[serverName] = {
        tools: normalizeStringList(rawServerValue.tools, `${label}.${serverName}.tools`),
      };
      continue;
    }
    throw new Error(
      `skillset: expected ${label}.${serverName} to be true, a tool string/list, or an object with tools`
    );
  }

  return servers;
}

function normalizeStringList(value: JsonValue | undefined, label: string): string[] {
  if (typeof value === "string") return [readNonEmptyString(value, label)];
  if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
    return value.map((item) => readNonEmptyString(item, label));
  }
  throw new Error(`skillset: expected ${label} to be a string or string array`);
}

function lowerPortableToolsForClaude(
  tools: JsonRecord | undefined,
  label: string
): readonly string[] {
  if (tools === undefined) return [];
  const rules: string[] = [];

  for (const [key, value] of Object.entries(tools)) {
    if (value === undefined) continue;
    switch (key) {
      case "edit":
        rules.push(...lowerPathRules("Edit", value, `${label}.tool_intent.${key}`));
        break;
      case "read":
        rules.push(...lowerPathRules("Read", value, `${label}.tool_intent.${key}`));
        break;
      case "search":
        rules.push(...lowerSearchRules(value, `${label}.tool_intent.${key}`));
        break;
      case "write":
        rules.push(...lowerWriteRules(value, `${label}.tool_intent.${key}`));
        break;
      case "shell":
        rules.push(...lowerShellRules(value, `${label}.tool_intent.${key}`));
        break;
      case "web_fetch":
        rules.push(...lowerWebFetchRules(value, `${label}.tool_intent.${key}`));
        break;
      case "web_search":
        rules.push("WebSearch");
        break;
      case "mcp":
        rules.push(...lowerMcpRules(value, `${label}.tool_intent.${key}`));
        break;
    }
  }

  return rules;
}

function lowerPathRules(tool: "Edit" | "Read", value: JsonValue, label: string): readonly string[] {
  if (value === true) return [tool];
  const paths = normalizeStringList(value, label);
  return paths.map((path) => `${tool}(${path})`);
}

function lowerSearchRules(value: JsonValue, label: string): readonly string[] {
  if (value === true) return ["Grep", "Glob"];
  const paths = normalizeStringList(value, label);
  return paths.map((path) => `Read(${path})`);
}

function lowerWriteRules(value: JsonValue, label: string): readonly string[] {
  if (value === true) return ["Write"];
  return lowerPathRules("Edit", value, label);
}

function lowerShellRules(value: JsonValue, label: string): readonly string[] {
  if (value === true) return ["Bash"];
  if (!Array.isArray(value)) {
    throw new Error(`skillset: expected ${label} to be true or normalized shell entries`);
  }
  return value.map((entry) => {
    if (!isJsonRecord(entry) || typeof entry.pattern !== "string") {
      throw new Error(`skillset: expected ${label} shell entries to contain pattern`);
    }
    return `Bash(${readNonEmptyString(entry.pattern, `${label}.pattern`)})`;
  });
}

function lowerWebFetchRules(value: JsonValue, label: string): readonly string[] {
  if (value === true) return ["WebFetch"];
  if (!isJsonRecord(value)) {
    throw new Error(`skillset: expected ${label} to be true or normalized web_fetch domains`);
  }
  const domains = normalizeStringList(value.domains, `${label}.domains`);
  return domains.map((domain) => `WebFetch(domain:${domain})`);
}

function lowerMcpRules(value: JsonValue, label: string): readonly string[] {
  if (!isJsonRecord(value)) {
    throw new Error(`skillset: expected ${label} to be normalized MCP server entries`);
  }
  const rules: string[] = [];
  for (const [server, rawServerValue] of Object.entries(value)) {
    if (!isJsonRecord(rawServerValue)) {
      throw new Error(`skillset: expected ${label}.${server} to be an object with tools`);
    }
    const tools = normalizeStringList(rawServerValue.tools, `${label}.${server}.tools`);
    for (const tool of tools) {
      rules.push(mcpToolRule(server, tool));
    }
  }
  return rules;
}

function mcpToolRule(server: string, tool: string): string {
  const serverPattern = server === "*" ? ".*" : server;
  const toolPattern = tool === "*" ? ".*" : tool;
  return `mcp__${serverPattern}__${toolPattern}`;
}

function codexToolActionMetadata(
  portable: JsonRecord | undefined,
  native: JsonValue | undefined
): JsonRecord | undefined {
  const action: Record<string, JsonValue> = {};
  if (portable !== undefined) action.portable = portable;
  if (native !== undefined) action.target_native = native;
  return Object.keys(action).length === 0 ? undefined : action;
}

function mergeCodexEscapeValues(
  shared: JsonValue | undefined,
  targetSpecific: JsonValue | undefined
): JsonValue | undefined {
  const normalizedShared = shared === false ? undefined : shared;
  if (targetSpecific === false) return undefined;
  if (targetSpecific === undefined) return normalizedShared;
  if (normalizedShared === undefined) return targetSpecific;
  if (Array.isArray(normalizedShared) && Array.isArray(targetSpecific)) {
    return [...normalizedShared, ...targetSpecific];
  }
  if (isJsonRecord(normalizedShared) && isJsonRecord(targetSpecific)) {
    return mergeJsonRecords(normalizedShared, targetSpecific);
  }
  return targetSpecific;
}

function mergeJsonRecords(base: JsonRecord, override: JsonRecord): JsonRecord {
  const merged: Record<string, JsonValue> = {};

  for (const [key, value] of Object.entries(base)) {
    if (value !== undefined) merged[key] = value;
  }

  for (const [key, value] of Object.entries(override)) {
    if (value === undefined) continue;
    const current = merged[key];
    if (isJsonRecord(current) && isJsonRecord(value)) {
      merged[key] = mergeJsonRecords(current, value);
    } else if (Array.isArray(current) && Array.isArray(value)) {
      merged[key] = [...current, ...value];
    } else {
      merged[key] = value;
    }
  }

  return merged;
}

function readNonEmptyString(value: string, label: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new Error(`skillset: expected ${label} entries to be non-empty strings`);
  }
  return trimmed;
}
