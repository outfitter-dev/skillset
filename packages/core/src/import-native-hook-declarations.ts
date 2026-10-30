import { lstat } from "node:fs/promises";
import { targetNames } from "./config";
import { assertRealPathInside, compareStrings, logicalDiagnosticPath, resolveInside } from "./path";
import type { JsonValue } from "./types";
import { isJsonRecord } from "./yaml";

export interface ImportedNativeHookSource {
  readonly path: string;
  readonly originalPath: string;
  readonly pointers?: readonly string[];
}

/** Inventory physical files once without changing declaration order or values. */
export async function inventoryClaudeHookDeclaration(
  stagingPath: string,
  declaration: JsonValue | undefined,
  files: readonly string[]
): Promise<readonly ImportedNativeHookSource[]> {
  const paths = new Set<string>();
  const pointers: string[] = [];
  if (files.includes("hooks/hooks.json")) paths.add("hooks/hooks.json");
  async function inspect(value: JsonValue, pointer: string): Promise<void> {
    if (isJsonRecord(value)) {
      pointers.push(pointer);
      return;
    }
    if (typeof value !== "string" || !value.startsWith("./") || !value.endsWith(".json") || value.includes("\\") || value.split("/").some((part) => part === "..")) {
      throw new Error(`skillset: Claude hook declaration ${pointer} must be an inline event map or a contained ./ JSON file path`);
    }
    const absolute = resolveInside(stagingPath, value.slice(2));
    const path = logicalDiagnosticPath(stagingPath, absolute);
    if (path === "plugin.json" || targetNames().some((target) => path.startsWith(`.${target}-plugin/`) || path.startsWith(`_${target}/`))) {
      throw new Error(`skillset: Claude hook path ${value} conflicts with a managed plugin surface`);
    }
    await assertRealPathInside(stagingPath, absolute);
    if (!(await lstat(absolute)).isFile() || !files.includes(path)) {
      throw new Error(`skillset: Claude hook path ${value} is not a copied regular file`);
    }
    paths.add(path);
  }
  if (Array.isArray(declaration)) {
    for (const [index, value] of declaration.entries()) await inspect(value, `/hooks/${index}`);
  } else if (declaration !== undefined) {
    await inspect(declaration, "/hooks");
  }
  return [
    ...(pointers.length === 0 ? [] : [{ path: ".claude-plugin/plugin.json", originalPath: ".claude-plugin/plugin.json", pointers }]),
    ...[...paths].sort(compareStrings).map((path) => ({ path, originalPath: path })),
  ];
}
