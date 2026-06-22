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

export type AppliedChangeBump = "major" | "minor" | "none" | "patch";

export interface AppliedChangeGroup {
  readonly id: string;
  readonly provider?: string;
}

export interface AppliedChangeRecord {
  readonly bump?: AppliedChangeBump;
  readonly group?: AppliedChangeGroup;
  readonly id: string;
  readonly ignored: boolean;
  readonly path: string;
  readonly reason: string;
  readonly scopes: readonly string[];
  readonly sourceHashes: ReadonlyMap<string, readonly string[]>;
}

const HISTORY_FILE = "history.jsonl";
const AMENDMENTS_FILE = "amendments.jsonl";

export async function readAppliedChangeRecords(
  rootPath: string,
  options: { readonly sourceDir?: string } = {}
): Promise<readonly AppliedChangeRecord[]> {
  const path = workspaceChangeFile(options.sourceDir, HISTORY_FILE);
  const absolutePath = resolveInside(rootPath, path);
  if (!(await exists(absolutePath))) return [];
  const entries: AppliedChangeRecord[] = [];
  const lines = (await readFile(absolutePath, "utf8")).split("\n");
  for (const [index, line] of lines.entries()) {
    if (line.trim().length === 0) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line) as unknown;
    } catch {
      throw new Error(`skillset: invalid JSON in ${path}:${index + 1}`);
    }
    if (!isJsonRecord(parsed)) throw new Error(`skillset: expected ${path}:${index + 1} to contain a JSON object`);
    const id = readString(parsed, "id");
    if (id === undefined) continue;
    const scopes = readHistoryScopes(parsed);
    const bump = readHistoryBump(parsed.bump);
    const group = readHistoryGroup(parsed.group);
    entries.push({
      ...(bump === undefined ? {} : { bump }),
      ...(group === undefined ? {} : { group }),
      id,
      ignored: parsed.ignored === true,
      path: `${path}:${index + 1}`,
      reason: readString(parsed, "reason") ?? readString(parsed, "body") ?? "",
      scopes,
      sourceHashes: readHistoryEvidence(parsed.evidence, scopes),
    });
  }
  const amended = await applyHistoryAmendments(rootPath, options.sourceDir, entries);
  return [...amended].sort((left, right) => compareStrings(left.id, right.id));
}

export function groupRef(group: AppliedChangeGroup | undefined): string | undefined {
  if (group === undefined) return undefined;
  return group.provider === undefined ? group.id : `${group.provider}:${group.id}`;
}

function readHistoryScopes(record: JsonRecord): readonly string[] {
  const values: string[] = [];
  const scope = record.scope;
  const scopes = record.scopes;
  if (typeof scope === "string") values.push(scope);
  if (Array.isArray(scopes)) {
    for (const item of scopes) {
      if (typeof item === "string") values.push(item);
    }
  }
  return [...new Set(values.map(historicalSourceUnitSelector))].sort(compareStrings);
}

function readHistoryBump(value: JsonValue | undefined): AppliedChangeBump | undefined {
  return value === "major" || value === "minor" || value === "none" || value === "patch" ? value : undefined;
}

function readHistoryGroup(value: JsonValue | undefined): AppliedChangeGroup | undefined {
  if (typeof value === "string") return { id: value };
  if (!isJsonRecord(value)) return undefined;
  const id = readString(value, "id");
  const provider = readString(value, "provider");
  return id === undefined ? undefined : { id, ...(provider === undefined ? {} : { provider }) };
}

async function applyHistoryAmendments(
  rootPath: string,
  sourceDir: string | undefined,
  entries: readonly AppliedChangeRecord[]
): Promise<readonly AppliedChangeRecord[]> {
  const amendments = await readHistoryAmendments(rootPath, sourceDir);
  if (amendments.size === 0) return entries;
  return entries.map((entry) => {
    const amendment = amendments.get(entry.id);
    return amendment === undefined ? entry : { ...entry, reason: amendment.reason };
  });
}

async function readHistoryAmendments(rootPath: string, sourceDir: string | undefined): Promise<ReadonlyMap<string, { readonly reason: string }>> {
  const path = workspaceChangeFile(sourceDir, AMENDMENTS_FILE);
  const absolutePath = resolveInside(rootPath, path);
  if (!(await exists(absolutePath))) return new Map();
  const amendments = new Map<string, { readonly reason: string }>();
  const lines = (await readFile(absolutePath, "utf8")).split("\n");
  for (const [index, line] of lines.entries()) {
    if (line.trim().length === 0) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line) as unknown;
    } catch {
      throw new Error(`skillset: invalid JSON in ${path}:${index + 1}`);
    }
    if (!isJsonRecord(parsed)) throw new Error(`skillset: expected ${path}:${index + 1} to contain a JSON object`);
    const id = readString(parsed, "id");
    const reason = readString(parsed, "reason");
    if (id === undefined || reason === undefined) continue;
    amendments.set(id, { reason });
  }
  return amendments;
}

function readHistoryEvidence(raw: JsonValue | undefined, scopes: readonly string[]): ReadonlyMap<string, readonly string[]> {
  const evidence = new Map<string, string[]>();
  const add = (scope: string | undefined, hash: string | undefined): void => {
    if (scope === undefined || hash === undefined) return;
    const normalizedScope = historicalSourceUnitSelector(scope);
    const current = evidence.get(normalizedScope) ?? [];
    current.push(hash);
    evidence.set(normalizedScope, current);
  };
  const singleScope = scopes.length === 1 ? scopes[0] : undefined;
  if (!Array.isArray(raw)) return evidence;
  for (const item of raw) {
    if (!isJsonRecord(item)) continue;
    add(readString(item, "scope") ?? singleScope, readString(item, "sourceHash") ?? readString(item, "hash") ?? readString(item, "currentHash"));
  }
  return evidence;
}

// Applied history is append-only, so records written before the SET-53 selector
// cutover keep their original scope strings. Normalize only while reading
// history; pending/current change scopes remain strict via sourceUnitSelector.
function historicalSourceUnitSelector(raw: string): string {
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
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
    throw error;
  }
}
