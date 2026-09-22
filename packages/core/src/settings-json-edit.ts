import { isDeepStrictEqual } from "node:util";
import { parseTree, type Node as JsonNode } from "jsonc-parser";

import type { JsonRecord, JsonValue } from "./types";
import { isJsonRecord } from "./yaml";

export function hasCommand(value: JsonValue, command: string): boolean {
  if (!isJsonRecord(value) || !Array.isArray(value.hooks)) return false;
  return value.hooks.some((entry) => isJsonRecord(entry) && entry.command === command);
}

/** Patch only the owned JSON span; foreign value bytes are never reserialized. */
export function composeSessionStartText(
  source: string,
  session: readonly JsonValue[],
  expected: JsonRecord,
  command: string,
  removeOnly: boolean
): string {
  const initialRoot = jsonRoot(source);
  assertUniqueObjectKeys(initialRoot);
  const ownedIndexes = session.flatMap((entry, index) =>
    hasCommand(entry, command) ? [index] : []
  );
  if (removeOnly && ownedIndexes.length === 0) return source;
  if (!removeOnly && ownedIndexes.length === 1 && isDeepStrictEqual(session[ownedIndexes[0]!], expected)) {
    return source;
  }
  let next = source;
  if (removeOnly && ownedIndexes.length === session.length) {
    const root = jsonRoot(next);
    const hooks = propertyValue(root, "hooks");
    if (hooks === undefined || hooks.type !== "object") throw new Error("skillset: invalid hooks object");
    next = removeObjectProperty(next, hooks, "SessionStart");
    const updatedRoot = jsonRoot(next);
    const updatedHooks = propertyValue(updatedRoot, "hooks");
    if (updatedHooks?.children?.length === 0) next = removeObjectProperty(next, updatedRoot, "hooks");
  } else {
    const indexesToRemove = removeOnly ? ownedIndexes : ownedIndexes.slice(1);
    for (const index of indexesToRemove.toReversed()) {
      const root = jsonRoot(next);
      const array = propertyValue(propertyValue(root, "hooks")!, "SessionStart");
      if (array === undefined || array.type !== "array") throw new Error("skillset: invalid SessionStart array");
      next = removeArrayElement(next, array, index);
    }
    if (!removeOnly && ownedIndexes.length === 0) {
      const root = jsonRoot(next);
      const hooks = propertyValue(root, "hooks");
      if (hooks === undefined) {
        next = insertObjectProperty(next, root, "hooks", JSON.stringify({ SessionStart: [expected] }));
      } else {
        const array = propertyValue(hooks, "SessionStart");
        if (array === undefined) {
          next = insertObjectProperty(next, hooks, "SessionStart", JSON.stringify([expected]));
        } else {
          next = insertArrayElement(next, array, JSON.stringify(expected));
        }
      }
    }
  }
  JSON.parse(next);
  return next;
}

function jsonRoot(source: string): JsonNode {
  const root = parseTree(source);
  if (root?.type !== "object") throw new Error("skillset: settings root must be an object");
  return root;
}

function assertUniqueObjectKeys(node: JsonNode): void {
  if (node.type === "object") {
    const keys = new Set<string>();
    for (const property of node.children ?? []) {
      const key = property.children?.[0]?.value;
      if (typeof key !== "string") throw new Error("skillset: invalid settings object key");
      if (keys.has(key)) throw new Error(`skillset: duplicate settings object key ${JSON.stringify(key)}`);
      keys.add(key);
      for (const child of property.children?.slice(1) ?? []) assertUniqueObjectKeys(child);
    }
    return;
  }
  for (const child of node.children ?? []) assertUniqueObjectKeys(child);
}

function propertyValue(object: JsonNode, key: string): JsonNode | undefined {
  return object.children?.find((property) => property.children?.[0]?.value === key)?.children?.[1];
}

function removeObjectProperty(source: string, object: JsonNode, key: string): string {
  const properties = object.children ?? [];
  const index = properties.findIndex((property) => property.children?.[0]?.value === key);
  const property = properties[index];
  if (property === undefined) return source;
  if (properties.length === 1) return spliceText(source, property.offset, property.offset + property.length, "");
  const next = properties[index + 1];
  if (next !== undefined) return spliceText(source, property.offset, next.offset, "");
  const previous = properties[index - 1]!;
  return spliceText(source, previous.offset + previous.length, property.offset + property.length, "");
}

function insertObjectProperty(source: string, object: JsonNode, key: string, value: string): string {
  const properties = object.children ?? [];
  const insertAt = properties.length === 0
    ? object.offset + 1
    : properties[properties.length - 1]!.offset + properties[properties.length - 1]!.length;
  return spliceText(source, insertAt, insertAt, `${properties.length === 0 ? "" : ","}${JSON.stringify(key)}:${value}`);
}

function removeArrayElement(source: string, array: JsonNode, index: number): string {
  const entries = array.children ?? [];
  const entry = entries[index];
  if (entry === undefined) return source;
  const next = entries[index + 1];
  if (next !== undefined) return spliceText(source, entry.offset, next.offset, "");
  const previous = entries[index - 1];
  if (previous !== undefined) return spliceText(source, previous.offset + previous.length, entry.offset + entry.length, "");
  return spliceText(source, entry.offset, entry.offset + entry.length, "");
}

function insertArrayElement(source: string, array: JsonNode, value: string): string {
  const entries = array.children ?? [];
  const insertAt = entries.length === 0
    ? array.offset + 1
    : entries[entries.length - 1]!.offset + entries[entries.length - 1]!.length;
  return spliceText(source, insertAt, insertAt, `${entries.length === 0 ? "" : ","}${value}`);
}

function spliceText(source: string, start: number, end: number, replacement: string): string {
  return source.slice(0, start) + replacement + source.slice(end);
}
