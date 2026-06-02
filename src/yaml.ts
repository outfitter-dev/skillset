import YAML from "yaml";

import type { JsonRecord, JsonValue, MarkdownParts } from "./types";

export function isJsonRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseYamlRecord(content: string, label: string): JsonRecord {
  const parsed = YAML.parse(content) as unknown;
  if (parsed === null) return {};
  if (!isJsonRecord(parsed)) {
    throw new Error(`skillset: expected ${label} to contain a YAML object`);
  }
  return parsed;
}

export function parseMarkdown(content: string, label: string): MarkdownParts {
  const normalized = content.replaceAll(/\r\n?/g, "\n");
  const lines = normalized.split("\n");

  if (lines[0] !== "---") {
    return { body: normalized, frontmatter: {} };
  }

  const closingIndex = lines.findIndex((line, index) => index > 0 && line === "---");
  if (closingIndex === -1) {
    throw new Error(`skillset: frontmatter in ${label} starts with --- but never closes`);
  }

  const frontmatter = parseYamlRecord(lines.slice(1, closingIndex).join("\n"), label);
  const body = lines.slice(closingIndex + 1).join("\n");
  return { body, frontmatter };
}

export function stringifyMarkdown(frontmatter: JsonRecord, body: string): string {
  const yaml = stringifyYaml(sortRecord(frontmatter)).trimEnd();
  const normalizedBody = body.replaceAll(/\r\n?/g, "\n").replace(/^\n+/, "");
  return `---\n${yaml}\n---\n\n${normalizedBody.trimEnd()}\n`;
}

export function stringifyJson(value: JsonRecord): string {
  return `${JSON.stringify(stripUndefined(sortRecord(value)), null, 2)}\n`;
}

export function stringifyYaml(value: JsonRecord): string {
  return YAML.stringify(stripUndefined(sortRecord(value)), { lineWidth: 0 });
}

export function sortRecord(record: JsonRecord): JsonRecord {
  const sorted: Record<string, JsonValue> = {};
  for (const key of Object.keys(record).sort()) {
    const value = record[key];
    if (value === undefined) continue;
    sorted[key] = sortValue(value);
  }
  return sorted;
}

export function stripUndefined(record: JsonRecord): JsonRecord {
  const stripped: Record<string, JsonValue> = {};
  for (const [key, value] of Object.entries(record)) {
    if (value === undefined) continue;
    stripped[key] = stripUndefinedValue(value);
  }
  return stripped;
}

export function stripUndefinedValue(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(stripUndefinedValue);
  if (isJsonRecord(value)) return stripUndefined(value);
  return value;
}

function sortValue(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(sortValue);
  if (isJsonRecord(value)) return sortRecord(value);
  return value;
}
