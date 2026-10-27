import { readFile } from "node:fs/promises";

import { readString } from "./config";
import { compareStrings, resolveInside } from "./path";
import { listPendingLedgerEventFiles } from "./pending-ledger-events";
import { workspaceChangeFile } from "./workspace-state";
import {
  historicalRuleSelector,
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
import { isJsonRecord } from "./yaml";

export type ChangeLedgerEventType =
  | "baseline.recorded"
  | "change.amended"
  | "change.covered"
  | "change.ignored"
  | "reason.created"
  | "reason.updated"
  | "release.amended"
  | "release.applied"
  | "source.draft-discarded"
  | "source.drafted"
  | "source.moved"
  | "source.promoted";

export type ChangeLedgerEvent =
  | BaselineRecordedLedgerEvent
  | ChangeAmendedLedgerEvent
  | ChangeCoveredLedgerEvent
  | ChangeIgnoredLedgerEvent
  | ReasonCreatedLedgerEvent
  | ReasonUpdatedLedgerEvent
  | ReleaseAmendedLedgerEvent
  | ReleaseAppliedLedgerEvent
  | SourceDraftDiscardedLedgerEvent
  | SourceDraftedLedgerEvent
  | SourceMovedLedgerEvent
  | SourcePromotedLedgerEvent;

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
  | ReleaseAppliedLedgerPayload
  | SourceDraftDiscardedLedgerPayload
  | SourceDraftedLedgerPayload
  | SourceMovedLedgerPayload
  | SourcePromotedLedgerPayload;

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

export interface SourceMovedLedgerPayload {
  readonly from: string;
  readonly to: string;
}

export interface SourceDraftDiscardedLedgerPayload {
  readonly draft: string;
  readonly draftEventId: string;
  readonly shipped: string;
}

export interface SourceDraftedLedgerPayload {
  readonly draft: string;
  readonly shipped: string;
  readonly sourceHash: string;
}

export interface SourcePromotedLedgerPayload {
  readonly draft: string;
  readonly draftEventId?: string;
  readonly shipped: string;
}

export type ReasonCreatedLedgerEvent = ChangeLedgerEventBase<"reason.created", ReasonCreatedLedgerPayload>;
export type ReasonUpdatedLedgerEvent = ChangeLedgerEventBase<"reason.updated", ReasonUpdatedLedgerPayload>;
export type ChangeCoveredLedgerEvent = ChangeLedgerEventBase<"change.covered", ChangeCoveredLedgerPayload>;
export type ChangeIgnoredLedgerEvent = ChangeLedgerEventBase<"change.ignored", ChangeIgnoredLedgerPayload>;
export type ReleaseAppliedLedgerEvent = ChangeLedgerEventBase<"release.applied", ReleaseAppliedLedgerPayload>;
export type ChangeAmendedLedgerEvent = ChangeLedgerEventBase<"change.amended", ChangeAmendedLedgerPayload>;
export type ReleaseAmendedLedgerEvent = ChangeLedgerEventBase<"release.amended", ReleaseAmendedLedgerPayload>;
export type BaselineRecordedLedgerEvent = ChangeLedgerEventBase<"baseline.recorded", BaselineRecordedLedgerPayload>;
export type SourceDraftDiscardedLedgerEvent = ChangeLedgerEventBase<"source.draft-discarded", SourceDraftDiscardedLedgerPayload>;
export type SourceDraftedLedgerEvent = ChangeLedgerEventBase<"source.drafted", SourceDraftedLedgerPayload>;
export type SourceMovedLedgerEvent = ChangeLedgerEventBase<"source.moved", SourceMovedLedgerPayload>;
export type SourcePromotedLedgerEvent = ChangeLedgerEventBase<"source.promoted", SourcePromotedLedgerPayload>;

export interface ChangeLedgerReadOptions {
  readonly sourceDir?: string;
}

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
  "source.draft-discarded",
  "source.drafted",
  "source.moved",
  "source.promoted",
]);

/**
 * Read the change ledger in fold order: `ledger.jsonl` in file order, then
 * pending event files by name, each in line order (ADR-0038, ADR-0045).
 *
 * Readers take no lock, so a read can overlap `release apply`, which appends
 * the pending records to `ledger.jsonl` and then removes their files. Pending
 * files are read before `ledger.jsonl`, so a record a fold moved in between
 * is still found in the ledger. A pending record that repeats a ledger record
 * exactly is that fold's copy and is read once. The pending listing is taken
 * again after the read, and the read is retried when it changed, so a fold
 * or a rollback that removed or restored files mid-read is never half-seen.
 */
export async function readChangeLedger(
  rootPath: string,
  options: ChangeLedgerReadOptions = {}
): Promise<readonly ChangeLedgerEvent[]> {
  const ledgerPath = workspaceChangeFile(options.sourceDir, "ledger.jsonl");
  for (let attempt = 1; ; attempt += 1) {
    const pendingPaths = await listPendingLedgerEventFiles(rootPath, options.sourceDir);
    const pending = await Promise.all(
      pendingPaths.map(async (path) => ({ content: await readStream(rootPath, path), path }))
    );
    const ledger = await readStream(rootPath, ledgerPath);
    const relisted = await listPendingLedgerEventFiles(rootPath, options.sourceDir);
    const stable = relisted.length === pendingPaths.length
      && relisted.every((path, index) => path === pendingPaths[index])
      && pending.every((stream) => stream.content !== undefined);
    if (stable) return foldLedgerStreams([{ content: ledger, path: ledgerPath }, ...pending]);
    if (attempt === LEDGER_READ_ATTEMPTS) {
      throw new Error("skillset: the change ledger kept changing while it was read; retry the command");
    }
  }
}

const LEDGER_READ_ATTEMPTS = 5;

function foldLedgerStreams(
  streams: readonly { readonly content: string | undefined; readonly path: string }[]
): readonly ChangeLedgerEvent[] {
  const events: ChangeLedgerEvent[] = [];
  const ids = new Set<string>();
  // Records of the ledger itself (stream 0), the only stream that can hold a
  // fold's copy of a pending record.
  const ledgerRecords = new Map<string, string>();
  for (const [streamIndex, stream] of streams.entries()) {
    if (stream.content === undefined) continue;
    for (const [index, line] of stream.content.split("\n").entries()) {
      const lineNumber = index + 1;
      if (line.trim().length === 0) continue;
      const event = parseLedgerLine(line, stream.path, lineNumber);
      const record = JSON.stringify(JSON.parse(line) as unknown);
      if (ids.has(event.id)) {
        if (streamIndex > 0 && ledgerRecords.get(event.id) === record) continue;
        throw new Error(`skillset: duplicate change ledger event id ${event.id} in ${stream.path}:${lineNumber}`);
      }
      ids.add(event.id);
      if (streamIndex === 0) ledgerRecords.set(event.id, record);
      events.push(event);
    }
  }
  return events;
}

async function readStream(rootPath: string, path: string): Promise<string | undefined> {
  try {
    return await readFile(resolveInside(rootPath, path), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
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
    case "source.draft-discarded":
      return {
        ...readSourcePromotedPayload(payload, path, lineNumber),
        draftEventId: readRequiredString(payload, "draftEventId", path, lineNumber),
      };
    case "source.drafted":
      return readSourceDraftedPayload(payload, path, lineNumber);
    case "source.moved":
      return readSourceMovedPayload(payload, path, lineNumber);
    case "source.promoted":
      return readSourcePromotedPayload(payload, path, lineNumber);
  }
}

function readSourceDraftedPayload(payload: JsonRecord, path: string, lineNumber: number): SourceDraftedLedgerPayload {
  const shipped = normalizeLedgerSourceUnitSelector(readRequiredString(payload, "shipped", path, lineNumber));
  const draft = normalizeLedgerSourceUnitSelector(readRequiredString(payload, "draft", path, lineNumber));
  assertDraftRelationship(draft, shipped, path, lineNumber);
  return {
    draft,
    shipped,
    sourceHash: readRequiredSourceHash(payload, path, lineNumber),
  };
}

function readSourceMovedPayload(payload: JsonRecord, path: string, lineNumber: number): SourceMovedLedgerPayload {
  return {
    from: normalizeLedgerSourceUnitSelector(readRequiredString(payload, "from", path, lineNumber)),
    to: normalizeLedgerSourceUnitSelector(readRequiredString(payload, "to", path, lineNumber)),
  };
}

function readSourcePromotedPayload(payload: JsonRecord, path: string, lineNumber: number): SourcePromotedLedgerPayload {
  const shipped = normalizeLedgerSourceUnitSelector(readRequiredString(payload, "shipped", path, lineNumber));
  const draft = normalizeLedgerSourceUnitSelector(readRequiredString(payload, "draft", path, lineNumber));
  const draftEventId = readString(payload, "draftEventId");
  assertDraftRelationship(draft, shipped, path, lineNumber);
  return {
    draft,
    ...(draftEventId === undefined ? {} : { draftEventId }),
    shipped,
  };
}

function assertDraftRelationship(draft: string, shipped: string, path: string, lineNumber: number): void {
  if (draft === `${shipped}#draft`) return;
  throw new Error(`skillset: ${path}:${lineNumber} draft must be the shipped selector with #draft provenance`);
}

function readRequiredSourceHash(payload: JsonRecord, path: string, lineNumber: number): string {
  const sourceHash = readRequiredString(payload, "sourceHash", path, lineNumber);
  if (/^sha256:[0-9a-f]{64}$/u.test(sourceHash)) return sourceHash;
  throw new Error(`skillset: ${path}:${lineNumber} sourceHash must be a sha256 digest`);
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
  const rule = historicalRuleSelector(raw);
  if (rule !== undefined) return rule;
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
