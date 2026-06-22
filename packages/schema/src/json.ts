import type { SchemaJsonRecord, SchemaJsonValue } from "./types";

export function isSchemaRecord(value: unknown): value is SchemaJsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function sortSchemaRecord(record: SchemaJsonRecord): SchemaJsonRecord {
  const sorted: Record<string, SchemaJsonValue> = {};
  for (const key of Object.keys(record).sort()) {
    const value = record[key];
    if (value === undefined) continue;
    sorted[key] = sortSchemaValue(value);
  }
  return sorted;
}

function sortSchemaValue(value: SchemaJsonValue): SchemaJsonValue {
  if (Array.isArray(value)) return value.map(sortSchemaValue);
  if (isSchemaRecord(value)) return sortSchemaRecord(value);
  return value;
}
