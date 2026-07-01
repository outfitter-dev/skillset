import { readFile, stat } from "node:fs/promises";

import { readString } from "./config";
import { compareStrings, resolveInside } from "./path";
import {
  selectorForPluginCompanion,
  selectorForPluginConfig,
  selectorForPluginFeature,
  selectorForPluginSkill,
  selectorForProjectAgent,
  selectorForRootConfig,
  selectorForStandaloneSkill,
  selectorForTargetNativeIsland,
  sourceUnitSelector,
} from "./source-unit-selector";
import type { JsonRecord, JsonValue } from "./types";
import { workspaceChangeFile } from "./workspace-state";
import { isJsonRecord } from "./yaml";

export type ChangeLedgerEventType =
  | "baseline.recorded"
  | "change.amended"
  | "change.covered"
  | "change.ignored"
  | "reason.created"
  | "reason.updated"
  | "release.amended"
  | "release.applied";

export type ChangeLedgerEvent =
  | BaselineRecordedLedgerEvent
  | ChangeAmendedLedgerEvent
  | ChangeCoveredLedgerEvent
  | ChangeIgnoredLedgerEvent
  | ReasonCreatedLedgerEvent
  | ReasonUpdatedLedgerEvent
  | ReleaseAmendedLedgerEvent
  | ReleaseAppliedLedgerEvent;

export type ChangeLedgerBump = "major" | "minor" | "none" | "patch";

export interface ChangeLedgerEventBase<Type extends ChangeLedgerEventType, Payload extends ChangeLedgerPayload> {
  readonly createdAt: string;
  readonly id: string;
  readonly line: number;
  readonly path: string;
  readonly payload: Payload;
  readonly schemaVersion: 1;
  readonly sourceUnits: readonly ChangeLedgerSourceUnit[];
  readonly type: Type;
}

export interface ChangeLedgerSourceUnit {
  readonly hashSchema?: string;
  readonly selector: string;
  readonly sourceHash?: string;
}

export type ChangeLedgerPayload =
  | BaselineRecordedLedgerPayload
  | ChangeAmendedLedgerPayload
  | ChangeCoveredLedgerPayload
  | ChangeIgnoredLedgerPayload
  | ReasonCreatedLedgerPayload
  | ReasonUpdatedLedgerPayload
  | ReleaseAmendedLedgerPayload
  | ReleaseAppliedLedgerPayload;

export interface ReasonCreatedLedgerPayload {
  readonly bump?: ChangeLedgerBump;
  readonly group?: string;
  readonly ignored?: boolean;
  readonly path?: string;
  readonly reason?: string;
  readonly reasonId: string;
  readonly refs: readonly string[];
  readonly sourceUnits: readonly ChangeLedgerSourceUnit[];
}

export interface ReasonUpdatedLedgerPayload {
  readonly append?: boolean;
  readonly reason?: string;
  readonly reasonId: string;
}

export interface ChangeCoveredLedgerPayload {
  readonly reasonId: string;
  readonly sourceUnits: readonly ChangeLedgerSourceUnit[];
}

export interface ChangeIgnoredLedgerPayload {
  readonly reasonId: string;
  readonly sourceUnits: readonly ChangeLedgerSourceUnit[];
}

export interface ReleaseAppliedLedgerPayload {
  readonly changeIds: readonly string[];
  readonly releaseId: string;
  readonly scopes: readonly ReleaseAppliedLedgerScope[];
  readonly sourceUnits: readonly ChangeLedgerSourceUnit[];
}

export interface ReleaseAppliedLedgerScope {
  readonly bump?: ChangeLedgerBump;
  readonly changeIds: readonly string[];
  readonly hashSchema?: string;
  readonly previousVersion?: string;
  readonly removed?: boolean;
  readonly selector: string;
  readonly sourceHash?: string;
  readonly version: string;
}

export interface ChangeAmendedLedgerPayload {
  readonly changeId: string;
  readonly reason?: string;
}

export interface ReleaseAmendedLedgerPayload {
  readonly reason?: string;
  readonly releaseId: string;
}

export interface BaselineRecordedLedgerPayload {
  readonly reason?: string;
  readonly sourceUnits: readonly ChangeLedgerSourceUnit[];
}

export type ReasonCreatedLedgerEvent = ChangeLedgerEventBase<"reason.created", ReasonCreatedLedgerPayload>;
export type ReasonUpdatedLedgerEvent = ChangeLedgerEventBase<"reason.updated", ReasonUpdatedLedgerPayload>;
export type ChangeCoveredLedgerEvent = ChangeLedgerEventBase<"change.covered", ChangeCoveredLedgerPayload>;
export type ChangeIgnoredLedgerEvent = ChangeLedgerEventBase<"change.ignored", ChangeIgnoredLedgerPayload>;
export type ReleaseAppliedLedgerEvent = ChangeLedgerEventBase<"release.applied", ReleaseAppliedLedgerPayload>;
export type ChangeAmendedLedgerEvent = ChangeLedgerEventBase<"change.amended", ChangeAmendedLedgerPayload>;
export type ReleaseAmendedLedgerEvent = ChangeLedgerEventBase<"release.amended", ReleaseAmendedLedgerPayload>;
export type BaselineRecordedLedgerEvent = ChangeLedgerEventBase<"baseline.recorded", BaselineRecordedLedgerPayload>;

export interface ChangeLedgerReadOptions {
  readonly sourceDir?: string;
}

const LEDGER_FILE = "ledger.jsonl";
const SCHEMA_VERSION = 1;
const EVENT_TYPES = new Set<ChangeLedgerEventType>([
  "baseline.recorded",
  "change.amended",
  "change.covered",
  "change.ignored",
  "reason.created",
  "reason.updated",
  "release.amended",
  "release.applied",
]);

export async function readChangeLedger(
  rootPath: string,
  options: ChangeLedgerReadOptions = {}
): Promise<readonly ChangeLedgerEvent[]> {
  const path = workspaceChangeFile(options.sourceDir, LEDGER_FILE);
  const absolutePath = resolveInside(rootPath, path);
  if (!(await exists(absolutePath))) return [];

  const events: ChangeLedgerEvent[] = [];
  const ids = new Set<string>();
  const lines = (await readFile(absolutePath, "utf8")).split("\n");
  for (const [index, line] of lines.entries()) {
    const lineNumber = index + 1;
    if (line.trim().length === 0) continue;
    const event = parseLedgerLine(line, path, lineNumber);
    if (ids.has(event.id)) {
      throw new Error(`skillset: duplicate change ledger event id ${event.id} in ${path}:${lineNumber}`);
    }
    ids.add(event.id);
    events.push(event);
  }
  return events;
}

function parseLedgerLine(line: string, path: string, lineNumber: number): ChangeLedgerEvent {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line) as unknown;
  } catch {
    throw new Error(`skillset: invalid JSON in ${path}:${lineNumber}`);
  }
  if (!isJsonRecord(parsed)) {
    throw new Error(`skillset: expected ${path}:${lineNumber} to contain a JSON object`);
  }

  const schemaVersion = parsed.schemaVersion;
  if (schemaVersion !== SCHEMA_VERSION) {
    throw new Error(`skillset: ${path}:${lineNumber} schemaVersion must be ${SCHEMA_VERSION}`);
  }

  const id = readRequiredString(parsed, "id", path, lineNumber);
  const createdAt = readRequiredString(parsed, "createdAt", path, lineNumber);
  const type = readLedgerEventType(parsed.type, path, lineNumber);
  const payload = parsed.payload;
  if (!isJsonRecord(payload)) {
    throw new Error(`skillset: ${path}:${lineNumber} payload must be a JSON object`);
  }
  const typedPayload = readEventPayload(type, payload, path, lineNumber);

  return {
    createdAt,
    id,
    line: lineNumber,
    path,
    payload: typedPayload,
    schemaVersion: SCHEMA_VERSION,
    sourceUnits: "sourceUnits" in typedPayload ? typedPayload.sourceUnits : [],
    type,
  } as ChangeLedgerEvent;
}

function readEventPayload(
  type: ChangeLedgerEventType,
  payload: JsonRecord,
  path: string,
  lineNumber: number
): ChangeLedgerPayload {
  switch (type) {
    case "reason.created":
      return readReasonCreatedPayload(payload, path, lineNumber);
    case "reason.updated":
      return readReasonUpdatedPayload(payload, path, lineNumber);
    case "change.covered":
      return readChangeCoveredPayload(payload, path, lineNumber);
    case "change.ignored":
      return readChangeIgnoredPayload(payload, path, lineNumber);
    case "release.applied":
      return readReleaseAppliedPayload(payload, path, lineNumber);
    case "change.amended":
      return readChangeAmendedPayload(payload, path, lineNumber);
    case "release.amended":
      return readReleaseAmendedPayload(payload, path, lineNumber);
    case "baseline.recorded":
      return readBaselineRecordedPayload(payload, path, lineNumber);
  }
}

function readReasonCreatedPayload(payload: JsonRecord, path: string, lineNumber: number): ReasonCreatedLedgerPayload {
  return {
    ...readOptionalReasonFields(payload),
    reasonId: readRequiredString(payload, "reasonId", path, lineNumber),
    refs: readStringArray(payload.refs),
    sourceUnits: readLedgerSourceUnits(payload),
  };
}

function readReasonUpdatedPayload(payload: JsonRecord, path: string, lineNumber: number): ReasonUpdatedLedgerPayload {
  return {
    ...(payload.append === undefined ? {} : { append: payload.append === true }),
    ...readOptionalReasonFields(payload),
    reasonId: readRequiredString(payload, "reasonId", path, lineNumber),
  };
}

function readChangeCoveredPayload(payload: JsonRecord, path: string, lineNumber: number): ChangeCoveredLedgerPayload {
  return {
    reasonId: readRequiredString(payload, "reasonId", path, lineNumber),
    sourceUnits: readRequiredSourceUnits(payload, path, lineNumber),
  };
}

function readChangeIgnoredPayload(payload: JsonRecord, path: string, lineNumber: number): ChangeIgnoredLedgerPayload {
  return {
    reasonId: readRequiredString(payload, "reasonId", path, lineNumber),
    sourceUnits: readRequiredSourceUnits(payload, path, lineNumber),
  };
}

function readReleaseAppliedPayload(payload: JsonRecord, path: string, lineNumber: number): ReleaseAppliedLedgerPayload {
  return {
    changeIds: readStringArray(payload.changeIds ?? payload.reasonIds),
    releaseId: readRequiredString(payload, "releaseId", path, lineNumber),
    scopes: readReleaseAppliedScopes(payload),
    sourceUnits: readRequiredSourceUnits(payload, path, lineNumber),
  };
}

function readChangeAmendedPayload(payload: JsonRecord, path: string, lineNumber: number): ChangeAmendedLedgerPayload {
  return {
    changeId: readRequiredString(payload, "changeId", path, lineNumber),
    ...readOptionalReasonFields(payload),
  };
}

function readReleaseAmendedPayload(payload: JsonRecord, path: string, lineNumber: number): ReleaseAmendedLedgerPayload {
  return {
    ...readOptionalReasonFields(payload),
    releaseId: readRequiredString(payload, "releaseId", path, lineNumber),
  };
}

function readBaselineRecordedPayload(payload: JsonRecord, path: string, lineNumber: number): BaselineRecordedLedgerPayload {
  return {
    ...readOptionalReasonFields(payload),
    sourceUnits: readRequiredSourceUnits(payload, path, lineNumber),
  };
}

function readRequiredSourceUnits(payload: JsonRecord, path: string, lineNumber: number): readonly ChangeLedgerSourceUnit[] {
  const sourceUnits = readLedgerSourceUnits(payload);
  if (sourceUnits.length > 0) return sourceUnits;
  throw new Error(`skillset: ${path}:${lineNumber} payload requires at least one source unit selector`);
}

function readOptionalReasonFields(payload: JsonRecord): {
  readonly bump?: ChangeLedgerBump;
  readonly group?: string;
  readonly ignored?: boolean;
  readonly path?: string;
  readonly reason?: string;
} {
  const bump = readLedgerBump(payload.bump);
  const group = readString(payload, "group");
  const path = readString(payload, "path");
  const reason = readString(payload, "reason");
  return {
    ...(bump === undefined ? {} : { bump }),
    ...(group === undefined ? {} : { group }),
    ...(payload.ignored === true ? { ignored: true } : {}),
    ...(path === undefined ? {} : { path }),
    ...(reason === undefined ? {} : { reason }),
  };
}

function readLedgerBump(value: JsonValue | undefined): ChangeLedgerBump | undefined {
  return value === "major" || value === "minor" || value === "none" || value === "patch" ? value : undefined;
}

function readReleaseAppliedScopes(payload: JsonRecord): readonly ReleaseAppliedLedgerScope[] {
  const rawScopes = payload.scopes;
  if (!Array.isArray(rawScopes)) return [];

  const scopes: ReleaseAppliedLedgerScope[] = [];
  for (const item of rawScopes) {
    if (!isJsonRecord(item)) continue;
    const selector = readString(item, "selector") ?? readString(item, "scope");
    const version = readString(item, "version") ?? readString(item, "nextVersion");
    if (selector === undefined || version === undefined) continue;
    const bump = readLedgerBump(item.bump);
    const hashSchema = readString(item, "hashSchema") ?? readString(item, "hashSchemaId");
    const previousVersion = readString(item, "previousVersion");
    const sourceHash = readString(item, "sourceHash") ?? readString(item, "hash") ?? readString(item, "currentHash");
    scopes.push({
      ...(bump === undefined ? {} : { bump }),
      changeIds: readStringArray(item.changeIds ?? item.entries),
      ...(hashSchema === undefined ? {} : { hashSchema }),
      ...(previousVersion === undefined ? {} : { previousVersion }),
      ...(item.removed === true ? { removed: true } : {}),
      selector: normalizeLedgerSourceUnitSelector(selector),
      ...(sourceHash === undefined ? {} : { sourceHash }),
      version,
    });
  }
  return scopes.sort((left, right) => compareStrings(left.selector, right.selector));
}

function readStringArray(value: JsonValue | undefined): readonly string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => typeof item === "string" ? [item] : []);
}

function readLedgerSourceUnits(payload: JsonRecord): readonly ChangeLedgerSourceUnit[] {
  const units: ChangeLedgerSourceUnit[] = [];
  const add = (record: JsonRecord): void => {
    const selector = readString(record, "selector") ?? readString(record, "scope");
    if (selector === undefined) return;
    const sourceHash = readString(record, "sourceHash") ?? readString(record, "hash") ?? readString(record, "currentHash");
    const hashSchema = readString(record, "hashSchema") ?? readString(record, "hashSchemaId");
    units.push({
      ...(hashSchema === undefined ? {} : { hashSchema }),
      selector: normalizeLedgerSourceUnitSelector(selector),
      ...(sourceHash === undefined ? {} : { sourceHash }),
    });
  };

  const singleSelector = readString(payload, "selector") ?? readString(payload, "scope");
  if (singleSelector !== undefined) add(payload);
  for (const key of ["sourceUnit", "coverage"]) {
    const value = payload[key];
    if (isJsonRecord(value)) add(value);
  }
  for (const key of ["sourceUnits", "scopes", "evidence", "coverage"]) {
    const value = payload[key];
    if (!Array.isArray(value)) continue;
    for (const item of value) {
      if (typeof item === "string") {
        units.push({ selector: normalizeLedgerSourceUnitSelector(item) });
      } else if (isJsonRecord(item)) {
        add(item);
      }
    }
  }

  return dedupeSourceUnits(units);
}

function dedupeSourceUnits(units: readonly ChangeLedgerSourceUnit[]): readonly ChangeLedgerSourceUnit[] {
  const byKey = new Map<string, ChangeLedgerSourceUnit>();
  for (const unit of units) {
    const key = `${unit.selector}\0${unit.sourceHash ?? ""}\0${unit.hashSchema ?? ""}`;
    byKey.set(key, unit);
  }
  return [...byKey.values()].sort((left, right) => compareStrings(sourceUnitSortKey(left), sourceUnitSortKey(right)));
}

function sourceUnitSortKey(unit: ChangeLedgerSourceUnit): string {
  return `${unit.selector}\0${unit.sourceHash ?? ""}\0${unit.hashSchema ?? ""}`;
}

function readLedgerEventType(value: JsonValue | undefined, path: string, lineNumber: number): ChangeLedgerEventType {
  if (typeof value === "string" && EVENT_TYPES.has(value as ChangeLedgerEventType)) {
    return value as ChangeLedgerEventType;
  }
  throw new Error(`skillset: ${path}:${lineNumber} type must be a supported change ledger event`);
}

function readRequiredString(record: JsonRecord, key: string, path: string, lineNumber: number): string {
  const value = readString(record, key);
  if (value !== undefined && value.trim().length > 0) return value;
  throw new Error(`skillset: ${path}:${lineNumber} ${key} must be a non-empty string`);
}

function normalizeLedgerSourceUnitSelector(raw: string): string {
  if (raw === "root-config") return selectorForRootConfig();
  if (raw.startsWith("standalone-skill:")) return selectorForStandaloneSkill(raw.slice("standalone-skill:".length));
  if (raw.startsWith("project-agent:")) return selectorForProjectAgent(raw.slice("project-agent:".length));
  if (raw.startsWith("instruction:")) return raw;
  if (raw.startsWith("plugin-config:")) return selectorForPluginConfig(raw.slice("plugin-config:".length));
  if (raw.startsWith("plugin-skill:")) {
    const [pluginId, skillId] = raw.slice("plugin-skill:".length).split("/");
    if (pluginId !== undefined && skillId !== undefined) return selectorForPluginSkill(pluginId, skillId);
  }
  if (raw.startsWith("plugin-feature:")) {
    const [pluginId, featureKey] = raw.slice("plugin-feature:".length).split("/");
    if (pluginId !== undefined && featureKey !== undefined) return selectorForPluginFeature(pluginId, featureKey);
  }
  if (raw.startsWith("plugin-companion:")) {
    const [pluginId, ...pathParts] = raw.slice("plugin-companion:".length).split("/");
    const companionPath = pathParts.join("/");
    if (pluginId !== undefined && companionPath.length > 0) return selectorForPluginCompanion(pluginId, companionPath);
  }
  if (raw.startsWith("target-native-island:")) {
    const [target, ownerKind, ownerIdOrPath, ...pathParts] = raw.slice("target-native-island:".length).split(":");
    if (target === undefined || ownerKind === undefined || ownerIdOrPath === undefined) return raw;
    if (ownerKind === "project") return selectorForTargetNativeIsland(target, "project", [ownerIdOrPath, ...pathParts].join(":"));
    if (ownerKind === "plugin") {
      const relativePath = pathParts.join(":");
      if (relativePath.length > 0) return selectorForTargetNativeIsland(target, `plugin:${ownerIdOrPath}`, relativePath);
    }
  }
  return sourceUnitSelector(raw);
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}
