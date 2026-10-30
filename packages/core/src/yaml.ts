import YAML from "yaml";
import { InputValidationError } from "./input-validation-error";

import type { JsonRecord, JsonValue, MarkdownParts } from "./types";

export function isJsonRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseYamlRecord(content: string, label: string): JsonRecord {
  const document = YAML.parseDocument(content);
  for (const warning of document.warnings) process.emitWarning(warning);
  const parseError = document.errors[0];
  if (parseError !== undefined) {
    if (!(parseError instanceof YAML.YAMLParseError)) throw parseError;
    throw invalidYaml(parseError, label);
  }
  // Alias conversion also throws ReferenceError for internal invariants. Prove
  // this source error from the parsed document instead of trusting that class.
  YAML.visit(document, {
    Alias(_key, alias) {
      if (alias.resolve(document) === undefined) {
        throw invalidYaml(new ReferenceError(
          `Unresolved alias (the anchor must be set before the alias): ${alias.source}`
        ), label);
      }
    },
  });
  const parsed: unknown = document.toJS();
  if (parsed === null) return {};
  if (!isJsonRecord(parsed)) {
    throw new InputValidationError(`skillset: expected ${label} to contain a YAML object`);
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
    throw new InputValidationError(`skillset: frontmatter in ${label} starts with --- but never closes`);
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
    Object.defineProperty(sorted, key, { value: sortValue(value), enumerable: true, writable: true, configurable: true });
  }
  return sorted;
}

export function stripUndefined(record: JsonRecord): JsonRecord {
  const stripped: Record<string, JsonValue> = {};
  for (const [key, value] of Object.entries(record)) {
    if (value === undefined) continue;
    Object.defineProperty(stripped, key, { value: stripUndefinedValue(value), enumerable: true, writable: true, configurable: true });
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

function invalidYaml(cause: Error, label: string): InputValidationError {
  return new InputValidationError(`skillset: ${label} is not valid YAML: ${cause.message}`, { cause });
}
