import {
  parseMarkdown,
  parseYamlRecord,
  stringifyJson,
  stringifyMarkdown,
  stringifyYaml,
} from './yaml';
import type { JsonRecord } from './types';

export function renderValidatedJson(value: JsonRecord, label: string): string {
  const content = stringifyJson(value);
  validateJson(content, label);
  return content;
}

export function renderValidatedMarkdown(
  frontmatter: JsonRecord,
  body: string,
  label: string
): string {
  const content = stringifyMarkdown(frontmatter, body);
  validateMarkdown(content, label);
  return content;
}

export function renderValidatedYaml(value: JsonRecord, label: string): string {
  const content = stringifyYaml(value);
  validateYaml(content, label);
  return content;
}

export function renderValidatedToml(value: JsonRecord, label: string): string {
  const content = stringifyToml(value);
  validateToml(content, label);
  return content;
}

export function validateGeneratedStructuredOutput(args: {
  readonly content: string;
  readonly sourcePath?: string;
  readonly targetPath: string;
}): void {
  const label = structuredOutputLabel(args);
  try {
    if (
      args.targetPath.endsWith('.json') ||
      args.targetPath.endsWith('.skillset.lock')
    ) {
      validateJson(args.content, label);
    } else if (
      args.targetPath.endsWith('.yaml') ||
      args.targetPath.endsWith('.yml')
    ) {
      validateYaml(args.content, label);
    } else if (args.targetPath.endsWith('.toml')) {
      validateToml(args.content, label);
    } else if (args.targetPath.endsWith('.md')) {
      validateMarkdown(args.content, label);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`skillset: invalid generated output ${label}: ${message}`, {
      cause: error,
    });
  }
}

function validateJson(content: string, label: string): void {
  try {
    JSON.parse(content);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${label} JSON parse error: ${message}`, { cause: error });
  }
}

function validateMarkdown(content: string, label: string): void {
  try {
    parseMarkdown(content, label);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${label} Markdown parse error: ${message}`, {
      cause: error,
    });
  }
}

function validateToml(content: string, label: string): void {
  try {
    Bun.TOML.parse(content);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${label} TOML parse error: ${message}`, { cause: error });
  }
}

function validateYaml(content: string, label: string): void {
  try {
    parseYamlRecord(content, label);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${label} YAML parse error: ${message}`, { cause: error });
  }
}

function stringifyToml(value: JsonRecord): string {
  const lines: string[] = [];
  writeTomlRecord(lines, [], value);
  return `${lines.join('\n').trimEnd()}\n`;
}

function writeTomlRecord(
  lines: string[],
  path: readonly string[],
  value: JsonRecord
): void {
  const scalars: string[] = [];
  const tables: (readonly [string, JsonRecord])[] = [];

  for (const key of Object.keys(value).toSorted()) {
    const entry = value[key];
    if (entry === undefined) {
      continue;
    }
    if (isTomlTable(entry)) {
      tables.push([key, entry]);
    } else {
      scalars.push(`${quoteTomlKey(key)} = ${stringifyTomlValue(entry)}`);
    }
  }

  if (path.length > 0) {
    lines.push(`[${path.map(quoteTomlKey).join('.')}]`);
  }
  lines.push(...scalars);

  for (const [key, table] of tables) {
    if (lines.length > 0 && lines.at(-1) !== '') {
      lines.push('');
    }
    writeTomlRecord(lines, [...path, key], table);
  }
}

function stringifyTomlValue(value: unknown): string {
  if (typeof value === 'string') {
    return quoteTomlString(value);
  }
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stringifyTomlValue).join(', ')}]`;
  }
  if (value === null) {
    throw new Error('TOML does not support null values');
  }
  throw new Error(
    'TOML values must be strings, booleans, numbers, arrays, or tables'
  );
}

function isTomlTable(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function quoteTomlKey(value: string): string {
  return /^[A-Za-z0-9_-]+$/.test(value) ? value : quoteTomlString(value);
}

function quoteTomlString(value: string): string {
  return JSON.stringify(value);
}

function structuredOutputLabel(args: {
  readonly sourcePath?: string;
  readonly targetPath: string;
}): string {
  return args.sourcePath === undefined
    ? args.targetPath
    : `${args.sourcePath} -> ${args.targetPath}`;
}
