import type { JsonRecord, JsonValue } from "./types";
import { isJsonRecord } from "./yaml";

export function readAuthorName(
  value: JsonValue | undefined
): string | undefined {
  if (typeof value === "string") return value;
  if (!isJsonRecord(value)) return undefined;
  return typeof value.name === "string" ? value.name : undefined;
}

export function readAuthorRecord(
  value: JsonValue | undefined
): JsonRecord | undefined {
  if (typeof value === "string") return { name: value };
  return isJsonRecord(value) ? value : undefined;
}
