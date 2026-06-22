import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { readString } from "./config";
import { compareStrings, resolveInside } from "./path";
import { sourceUnitSelector } from "./source-unit-selector";
import type { JsonRecord, ReleaseScopeState, ReleaseState, SkillsetOptions } from "./types";
import { validateVersionField } from "./versioning";
import { workspaceChangeFile } from "./workspace-state";
import { isJsonRecord, stringifyJson } from "./yaml";

const STATE_FILE = "state.json";

export async function readReleaseState(
  rootPath: string,
  options: SkillsetOptions = {}
): Promise<ReleaseState> {
  const statePath = releaseStatePath(rootPath, options);
  if (!(await exists(statePath))) return { scopes: {} };

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
  if (parsed.schemaVersion !== undefined && parsed.schemaVersion !== 1) {
    throw new Error("skillset: release state schemaVersion must be 1");
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
  return { scopes };
}

export async function writeReleaseState(
  rootPath: string,
  state: ReleaseState,
  options: SkillsetOptions = {}
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
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, stringifyJson({ schemaVersion: 1, scopes }), "utf8");
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
