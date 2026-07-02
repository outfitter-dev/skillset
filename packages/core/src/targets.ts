import {
  DEFAULT_TARGET_NAMES as SCHEMA_DEFAULT_TARGET_NAMES,
  TARGET_NAMES as SCHEMA_TARGET_NAMES,
} from "@skillset/schema";

import type { TargetName } from "./types";

export const TARGET_NAMES = SCHEMA_TARGET_NAMES as readonly TargetName[];
export const DEFAULT_TARGET_NAMES = SCHEMA_DEFAULT_TARGET_NAMES as readonly TargetName[];
export const TARGET_NAME_SET = new Set<TargetName>(TARGET_NAMES);
export const DEFAULT_TARGET_NAME_SET = new Set<TargetName>(DEFAULT_TARGET_NAMES);
export const TARGET_LIST_TEXT = formatList(TARGET_NAMES);

export function targetNames(): readonly TargetName[] {
  return TARGET_NAMES;
}

export function defaultTargetNames(): readonly TargetName[] {
  return DEFAULT_TARGET_NAMES;
}

export function isTargetName(value: unknown): value is TargetName {
  return typeof value === "string" && TARGET_NAME_SET.has(value as TargetName);
}

export function targetRecord<T>(create: (target: TargetName) => T): Record<TargetName, T> {
  return Object.fromEntries(TARGET_NAMES.map((target) => [target, create(target)])) as Record<TargetName, T>;
}

function formatList(values: readonly string[]): string {
  if (values.length <= 1) return values.join("");
  return `${values.slice(0, -1).join(", ")}, or ${values.at(-1)}`;
}
