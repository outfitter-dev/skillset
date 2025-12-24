/**
 * Config key path utilities
 */

export function escapeKeySegment(segment: string): string {
  return segment.replace(/\./g, "\\.");
}

export function unescapeKeySegment(segment: string): string {
  return segment.replace(/\\\./g, ".");
}

/**
 * Split key path respecting escaped dots
 */
export function splitKeyPath(path: string): string[] {
  const segments: string[] = [];
  let current = "";
  let escaped = false;

  for (const char of path) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }

    if (char === "\\") {
      escaped = true;
      continue;
    }

    if (char === ".") {
      segments.push(unescapeKeySegment(current));
      current = "";
      continue;
    }

    current += char;
  }

  segments.push(unescapeKeySegment(current));
  return segments.filter((segment) => segment.length > 0);
}

/**
 * Join key path with proper escaping
 */
export function joinKeyPath(segments: string[]): string {
  return segments.map(escapeKeySegment).join(".");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Get a value at path from object
 */
export function getValueAtPath(
  input: unknown,
  path: string | string[]
): unknown {
  const parts = Array.isArray(path) ? path : splitKeyPath(path);
  let current: unknown = input;

  for (const part of parts) {
    if (!(isRecord(current) || Array.isArray(current))) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }

  return current;
}

/**
 * Set a value at path, returning a new object
 */
export function setValueAtPath<T>(
  input: T,
  path: string | string[],
  value: unknown
): T {
  const parts = Array.isArray(path) ? path : splitKeyPath(path);
  if (parts.length === 0) return input;

  const result: unknown = Array.isArray(input)
    ? [...input]
    : { ...(input as Record<string, unknown>) };

  let cursor = result as Record<string, unknown>;
  let original: unknown = input;

  for (let i = 0; i < parts.length - 1; i += 1) {
    const part = parts[i];
    if (!part) continue;
    const originalValue = isRecord(original)
      ? (original as Record<string, unknown>)[part]
      : Array.isArray(original)
        ? (original as Record<string, unknown>)[part]
        : undefined;

    const next = Array.isArray(originalValue)
      ? [...originalValue]
      : isRecord(originalValue)
        ? { ...originalValue }
        : {};

    cursor[part] = next;
    cursor = next as Record<string, unknown>;
    original = originalValue;
  }

  const last = parts[parts.length - 1];
  if (last) {
    cursor[last] = value as never;
  }

  return result as T;
}

/**
 * Delete a value at path, returning a new object
 */
export function deleteValueAtPath<T>(input: T, path: string | string[]): T {
  const parts = Array.isArray(path) ? path : splitKeyPath(path);
  if (parts.length === 0) return input;

  const result: unknown = Array.isArray(input)
    ? [...input]
    : { ...(input as Record<string, unknown>) };

  let cursor = result as Record<string, unknown>;
  let original: unknown = input;

  for (let i = 0; i < parts.length - 1; i += 1) {
    const part = parts[i];
    if (!part) return input;
    const originalValue = isRecord(original)
      ? (original as Record<string, unknown>)[part]
      : Array.isArray(original)
        ? (original as Record<string, unknown>)[part]
        : undefined;

    if (!(isRecord(originalValue) || Array.isArray(originalValue))) {
      return input;
    }

    const next = Array.isArray(originalValue)
      ? [...originalValue]
      : { ...originalValue };

    cursor[part] = next as never;
    cursor = next as Record<string, unknown>;
    original = originalValue;
  }

  const last = parts[parts.length - 1];
  if (last) {
    delete cursor[last];
  }

  return result as T;
}
