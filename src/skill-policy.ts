import type { JsonRecord, JsonValue, TargetName } from "./types";
import { isJsonRecord } from "./yaml";

const TARGET_KEYS: readonly TargetName[] = ["claude", "codex"];

export type AllowedToolsValue = false | readonly string[];

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

function readNonEmptyString(value: string, label: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new Error(`skillset: expected ${label} entries to be non-empty strings`);
  }
  return trimmed;
}
