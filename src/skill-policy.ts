import type { JsonRecord, JsonValue, TargetName } from "./types";
import { isJsonRecord } from "./yaml";

const TARGET_KEYS: readonly TargetName[] = ["claude", "codex"];

export type AllowedToolsValue = false | readonly string[];

export interface ClaudeNativeToolRules {
  readonly allow: readonly string[];
  readonly deny: readonly string[];
}

export interface CodexNativeToolEscapes extends JsonRecord {
  readonly allow?: JsonValue;
  readonly deny?: JsonValue;
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
  return {
    allow:
      targetAllow === false
        ? []
        : [
            ...readClaudeToolRuleList(readPortableToolEscape(record, "_allow", "claude", label), label),
            ...readClaudeToolRuleList(targetAllow, label),
          ],
    deny:
      targetDeny === false
        ? []
        : [
            ...readClaudeToolRuleList(readPortableToolEscape(record, "_deny", "claude", label), label),
            ...readClaudeToolRuleList(targetDeny, label),
          ],
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
  const tools = readToolsRecord(record, `${label}.tools`);
  if (tools === undefined) return undefined;
  const value = tools[key];
  if (value === undefined) return undefined;
  if (!hasTargetMap(value)) return value;
  for (const mapKey of Object.keys(value as JsonRecord)) {
    if (!TARGET_KEYS.includes(mapKey as TargetName)) {
      throw new Error(
        `skillset: expected ${label}.tools.${key} target map to contain only claude and codex keys`
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
  const tools = readToolsRecord(targetOptions, `${label} target tools`);
  return tools?.[key];
}

function readToolsRecord(record: JsonRecord, label: string): JsonRecord | undefined {
  const value = record.tools;
  if (value === undefined) return undefined;
  if (!isJsonRecord(value)) {
    throw new Error(`skillset: expected ${label} to be an object`);
  }
  for (const key of Object.keys(value)) {
    if (key !== "_allow" && key !== "_deny") {
      throw new Error(
        `skillset: expected ${label} to contain only _allow and _deny escape keys`
      );
    }
  }
  return value;
}

function hasTargetMap(value: JsonValue): boolean {
  return isJsonRecord(value) && TARGET_KEYS.some((target) => value[target] !== undefined);
}

function readClaudeToolRuleList(value: JsonValue | undefined, label: string): readonly string[] {
  if (value === undefined || value === false) return [];
  if (typeof value === "string") return [readNonEmptyString(value, `${label}.tools`)];
  if (Array.isArray(value)) {
    return value.map((item) => readClaudeToolRule(item, label));
  }
  if (isJsonRecord(value)) return [readClaudeToolRule(value, label)];
  throw new Error(
    `skillset: expected ${label}.tools _allow/_deny entries for Claude to be strings or objects with rule`
  );
}

function readClaudeToolRule(value: JsonValue, label: string): string {
  if (typeof value === "string") return readNonEmptyString(value, `${label}.tools`);
  if (isJsonRecord(value)) {
    const rule = value.rule;
    if (typeof rule === "string") return readNonEmptyString(rule, `${label}.tools.rule`);
  }
  throw new Error(
    `skillset: expected ${label}.tools _allow/_deny entries for Claude to be strings or objects with rule`
  );
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
