import { readFile, stat } from "node:fs/promises";

import {
  type AtomicFilePublicationTestHooks,
  publishAtomicFile,
} from "./atomic-file-publication";
import { readChangeLedger, type ChangeLedgerEvent } from "./change-ledger";
import { readString } from "./config";
import { compareStrings, resolveInside } from "./path";
import { prepareRepositoryMutationPath } from "./repository-mutation";
import { sourceUnitSelector } from "./source-unit-selector";
import { latestSourceMoveCursor, sourceIdentityMappings, sourceMappingsAfterCursor } from "./source-identity-mapping";
import type { JsonRecord, ReleaseScopeState, ReleaseState, SkillsetOptions } from "./types";
import { validateVersionField } from "./versioning";
import { workspaceChangeFile } from "./workspace-state";
import { isJsonRecord, stringifyJson } from "./yaml";

const STATE_FILE = "state.json";

export async function readReleaseState(
  rootPath: string,
  options: SkillsetOptions = {}
): Promise<ReleaseState> {
  const events = await readChangeLedger(rootPath, options);
  const mappings = sourceIdentityMappings(events);
  const derived = readLedgerReleaseState(events);
  const statePath = releaseStatePath(rootPath, options);
  if (!(await exists(statePath))) return derived;

  let cached: { readonly cursor: string | null | undefined; readonly state: ReleaseState };
  try {
    cached = await readCachedReleaseState(statePath);
  } catch (error) {
    if (Object.keys(derived.scopes).length > 0) return derived;
    throw error;
  }
  return mergeReleaseStates(
    remapReleaseState(cached.state, sourceMappingsAfterCursor(mappings, cached.cursor)),
    derived
  );
}

async function readCachedReleaseState(statePath: string): Promise<{ readonly cursor: string | null | undefined; readonly state: ReleaseState }> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(statePath, "utf8")) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`skillset: release state is not valid JSON: ${message}`);
  }
  if (!isJsonRecord(parsed)) {
    throw new Error("skillset: release state must be a JSON object");
  }
  if (parsed.schemaVersion !== undefined && parsed.schemaVersion !== 1 && parsed.schemaVersion !== 2) {
    throw new Error("skillset: release state schemaVersion must be 1 or 2");
  }
  const cursor = parsed.schemaVersion === 2 ? parsed.sourceMoveCursor : undefined;
  if (parsed.schemaVersion === 2 && cursor !== null && typeof cursor !== "string") {
    throw new Error("skillset: release state sourceMoveCursor must be a string or null");
  }
  const rawScopes = parsed.scopes;
  if (!isJsonRecord(rawScopes)) {
    throw new Error("skillset: release state requires a scopes object");
  }

  const scopes: Record<string, ReleaseScopeState> = {};
  for (const [scope, value] of Object.entries(rawScopes).sort(([left], [right]) => compareStrings(left, right))) {
    if (!isJsonRecord(value)) {
      throw new Error(`skillset: release state scope ${scope} must be an object`);
    }
    const version = readString(value, "version");
    if (version === undefined) {
      throw new Error(`skillset: release state scope ${scope} requires version`);
    }
    validateVersionField(value, `release state scope ${scope}.version`);
    const removed = value.removed;
    if (removed !== undefined && typeof removed !== "boolean") {
      throw new Error(`skillset: release state scope ${scope} removed must be a boolean`);
    }
    const sourceHash = readString(value, "sourceHash");
    if (sourceHash !== undefined && !/^sha256:[0-9a-f]{64}$/.test(sourceHash)) {
      throw new Error(`skillset: release state scope ${scope} sourceHash must be a sha256 digest`);
    }
    const updatedAt = readString(value, "updatedAt");
    scopes[sourceUnitSelector(scope)] = {
      ...(removed === true ? { removed } : {}),
      ...(sourceHash === undefined ? {} : { sourceHash }),
      ...(updatedAt === undefined ? {} : { updatedAt }),
      version,
    };
  }
  return { cursor: cursor as string | null | undefined, state: { scopes } };
}

function readLedgerReleaseState(events: readonly ChangeLedgerEvent[]): ReleaseState {
  const scopes: Record<string, ReleaseScopeState> = {};
  for (const event of events) {
    if (event.type === "source.moved") {
      const previous = scopes[event.payload.from];
      if (previous !== undefined) {
        delete scopes[event.payload.from];
        scopes[event.payload.to] = previous;
      }
      continue;
    }
    if (event.type !== "release.applied") continue;
    for (const scope of event.payload.scopes) {
      scopes[sourceUnitSelector(scope.selector)] = {
        ...(scope.removed === true ? { removed: true } : {}),
        ...(scope.removed === true || scope.sourceHash === undefined ? {} : { sourceHash: scope.sourceHash }),
        updatedAt: event.createdAt,
        version: scope.version,
      };
    }
  }
  return { scopes };
}

function remapReleaseState(state: ReleaseState, mappings: ReturnType<typeof sourceIdentityMappings>): ReleaseState {
  const scopes: Record<string, ReleaseScopeState> = { ...state.scopes };
  for (const mapping of mappings) {
    const previous = scopes[mapping.from];
    if (previous === undefined) continue;
    delete scopes[mapping.from];
    scopes[mapping.to] = previous;
  }
  return { scopes };
}

function mergeReleaseStates(
  cached: ReleaseState,
  derived: ReleaseState
): ReleaseState {
  return {
    scopes: {
      ...cached.scopes,
      ...derived.scopes,
    },
  };
}

export async function writeReleaseState(
  rootPath: string,
  state: ReleaseState,
  options: SkillsetOptions = {},
  testHooks: AtomicFilePublicationTestHooks = {}
): Promise<string> {
  const relativePath = workspaceChangeFile(options.sourceDir, STATE_FILE);
  const absolutePath = resolveInside(rootPath, relativePath);
  const scopes: Record<string, JsonRecord> = {};
  for (const [scope, value] of Object.entries(state.scopes).sort(([left], [right]) => compareStrings(left, right))) {
    scopes[sourceUnitSelector(scope)] = {
      ...(value.removed === true ? { removed: true } : {}),
      ...(value.sourceHash === undefined ? {} : { sourceHash: value.sourceHash }),
      ...(value.updatedAt === undefined ? {} : { updatedAt: value.updatedAt }),
      version: value.version,
    };
  }
  await prepareRepositoryMutationPath(rootPath, absolutePath);
  const cursor = latestSourceMoveCursor(sourceIdentityMappings(await readChangeLedger(rootPath, options)));
  await publishAtomicFile(
    absolutePath,
    stringifyJson({ schemaVersion: 2, sourceMoveCursor: cursor, scopes }),
    { testHooks }
  );
  return relativePath;
}

function releaseStatePath(rootPath: string, options: SkillsetOptions): string {
  return resolveInside(rootPath, workspaceChangeFile(options.sourceDir, STATE_FILE));
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
