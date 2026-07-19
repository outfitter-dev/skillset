import { readRecord, readStringArray } from "./config";
import type { JsonRecord, JsonValue, SourceAdaptiveHook, TargetName } from "./types";
import { isJsonRecord } from "./yaml";

export type EffectiveAdaptiveHookJsonValue =
  | boolean
  | null
  | number
  | string
  | readonly EffectiveAdaptiveHookJsonValue[]
  | EffectiveAdaptiveHookJsonRecord;

export interface EffectiveAdaptiveHookJsonRecord {
  readonly [key: string]: EffectiveAdaptiveHookJsonValue | undefined;
}

export interface EffectiveAdaptiveHookDefinition {
  readonly context?: EffectiveAdaptiveHookJsonRecord;
  readonly events: readonly string[];
  readonly match?: EffectiveAdaptiveHookJsonValue;
  readonly run: EffectiveAdaptiveHookJsonRecord;
  readonly target: TargetName;
}

/**
 * Resolves the one immutable adaptive-hook definition that applies to a target.
 * Provider blocks replace complete semantic units; they never deep-merge with
 * the portable source. `null` is a deliberate clear sentinel for match/context.
 */
export function resolveEffectiveAdaptiveHookDefinition(
  definition: SourceAdaptiveHook,
  target: TargetName
): EffectiveAdaptiveHookDefinition {
  const base = definition.frontmatter;
  const override = readRecord(base, target);
  const events = readStringArray(override ?? {}, "events") ?? definition.events;
  const run = readRecord(override ?? {}, "run") ?? readRecord(base, "run") ?? {};
  const context = effectiveContext(base, override);
  const match = effectiveMatch(base, override);

  return Object.freeze({
    ...(context === undefined ? {} : { context: cloneRecord(context) }),
    events: Object.freeze([...events]),
    ...(match === undefined ? {} : { match: cloneAndFreeze(match) }),
    run: cloneRecord(run),
    target,
  });
}

function effectiveMatch(base: JsonRecord, override: JsonRecord | undefined): JsonValue | undefined {
  if (override !== undefined && hasOwn(override, "match")) return override.match === null ? undefined : override.match;
  return base.match;
}

function effectiveContext(base: JsonRecord, override: JsonRecord | undefined): JsonRecord | undefined {
  if (override !== undefined && hasOwn(override, "context")) {
    return override.context === null ? undefined : readRecord(override, "context");
  }
  return readRecord(base, "context");
}

function hasOwn(record: JsonRecord, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function cloneRecord(value: JsonRecord): EffectiveAdaptiveHookJsonRecord {
  return cloneAndFreeze(value) as EffectiveAdaptiveHookJsonRecord;
}

function cloneAndFreeze(value: JsonValue): EffectiveAdaptiveHookJsonValue {
  if (Array.isArray(value)) return Object.freeze(value.map(cloneAndFreeze));
  if (isJsonRecord(value)) {
    return Object.freeze(Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, item === undefined ? undefined : cloneAndFreeze(item)])
    ));
  }
  return value;
}
