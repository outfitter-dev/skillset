import { isSchemaRecord } from "./json";
import type { SchemaJsonRecord, SchemaJsonValue } from "./types";

export function readSourceAuthorName(
  value: SchemaJsonValue | undefined
): string | undefined {
  if (typeof value === "string") return value;
  if (!isSchemaRecord(value)) return undefined;
  return typeof value.name === "string" ? value.name : undefined;
}

/** Normalizes string shorthand without discarding richer canonical fields. */
export function readSourceAuthorRecord(
  value: SchemaJsonValue | undefined
): SchemaJsonRecord | undefined {
  if (typeof value === "string") return { name: value };
  return isSchemaRecord(value) ? value : undefined;
}
