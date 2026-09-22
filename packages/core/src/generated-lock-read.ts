import {
  parseCurrentGeneratedLock,
  parseGeneratedLock,
  type ParsedCurrentGeneratedLock,
  type ParsedGeneratedLock,
  type ParseGeneratedLockOptions,
} from "./generated-lock";
import {
  OnDiskJsonError,
  readOnDiskJson,
  type OnDiskJsonFailure,
  type OnDiskJsonMissingPolicy,
  type OnDiskJsonResult,
} from "./on-disk-json";
import { isJsonRecord } from "./yaml";

export const WORKSPACE_LOCK_LOGICAL_PATH = "skillset.lock";

export type GeneratedLockSchemaPolicy = "current" | "legacy";
export type GeneratedLockMissingPolicy = OnDiskJsonMissingPolicy;

export interface ReadGeneratedLockFromDiskOptions {
  readonly expectedOutputRoot?: string;
  readonly logicalPath: string;
  readonly missing?: GeneratedLockMissingPolicy;
  readonly provenance?: ParseGeneratedLockOptions["provenance"];
  readonly readText?: (path: string) => Promise<string>;
}

export type GeneratedLockDiskRead<T> =
  | { readonly kind: "absent" }
  | { readonly kind: "present"; readonly lock: T; readonly raw: unknown };

/**
 * Read JSON bytes that belong to a managed lock. Callers then apply an
 * explicit current or legacy schema policy. Only `ENOENT` may mean absence.
 */
export async function readGeneratedLockJsonFromDisk(
  absolutePath: string,
  options: Pick<
    ReadGeneratedLockFromDiskOptions,
    "logicalPath" | "missing" | "readText"
  >
): Promise<OnDiskJsonResult> {
  try {
    return await readOnDiskJson(absolutePath, {
      label: options.logicalPath,
      missing: options.missing ?? "error",
      ...(options.readText === undefined ? {} : { readText: options.readText }),
    });
  } catch (error) {
    throw lockReadError(options.logicalPath, error);
  }
}

/**
 * Read generated state that may authorize current compiler behavior.
 * Pre-v4 locks remain rebuild-only and never become absence.
 */
export async function readCurrentGeneratedLockFromDisk(
  absolutePath: string,
  options: ReadGeneratedLockFromDiskOptions
): Promise<GeneratedLockDiskRead<ParsedCurrentGeneratedLock>> {
  const json = await readGeneratedLockJsonFromDisk(absolutePath, options);
  if (json.kind === "absent") return { kind: "absent" };
  return {
    kind: "present",
    lock: parseCurrentLockOrCorrupt(json.value, options),
    raw: json.value,
  };
}

/**
 * Read a lock for bounded inspection, including schema-v1 through v3.
 * This never grants current ownership; callers must keep that policy explicit.
 */
export async function readLegacyGeneratedLockFromDisk(
  absolutePath: string,
  options: ReadGeneratedLockFromDiskOptions
): Promise<GeneratedLockDiskRead<ParsedGeneratedLock>> {
  const json = await readGeneratedLockJsonFromDisk(absolutePath, options);
  if (json.kind === "absent") return { kind: "absent" };
  return {
    kind: "present",
    lock: parseLegacyLockOrCorrupt(json.value, options),
    raw: json.value,
  };
}

/**
 * Read a lock whose schema is chosen after the bytes are known. Current v4
 * locks use the current reader; v1–v3 stay inspect-only. Corruption never
 * becomes absence.
 */
export async function readInspectableGeneratedLockFromDisk(
  absolutePath: string,
  options: ReadGeneratedLockFromDiskOptions
): Promise<GeneratedLockDiskRead<ParsedGeneratedLock>> {
  const json = await readGeneratedLockJsonFromDisk(absolutePath, options);
  if (json.kind === "absent") return { kind: "absent" };
  return {
    kind: "present",
    lock: isPreV4GeneratedLock(json.value)
      ? parseLegacyLockOrCorrupt(json.value, {
          ...options,
          provenance: options.provenance ?? "inspect",
        })
      : parseCurrentLockOrCorrupt(json.value, options),
    raw: json.value,
  };
}

export function parseCurrentLockOrCorrupt(
  value: unknown,
  options: Pick<
    ReadGeneratedLockFromDiskOptions,
    "expectedOutputRoot" | "logicalPath" | "provenance"
  >
): ParsedCurrentGeneratedLock {
  try {
    const lock = parseCurrentGeneratedLock(value, options.logicalPath, {
      provenance: options.provenance,
    });
    assertExpectedOutputRoot(lock.outputRoot, options);
    return lock;
  } catch (error) {
    throw lockReadError(options.logicalPath, error);
  }
}

export function parseLegacyLockOrCorrupt(
  value: unknown,
  options: Pick<
    ReadGeneratedLockFromDiskOptions,
    "expectedOutputRoot" | "logicalPath" | "provenance"
  >
): ParsedGeneratedLock {
  try {
    const lock = parseGeneratedLock(value, options.logicalPath, {
      provenance: options.provenance,
    });
    assertExpectedOutputRoot(lock.outputRoot, options);
    return lock;
  } catch (error) {
    throw lockReadError(options.logicalPath, error);
  }
}

export function isPreV4GeneratedLock(value: unknown): boolean {
  return (
    isJsonRecord(value) &&
    (value.schemaVersion === 1 ||
      value.schemaVersion === 2 ||
      value.schemaVersion === 3)
  );
}

export function isEmptyV2GeneratedLock(value: unknown): boolean {
  return (
    isJsonRecord(value) &&
    value.schemaVersion === 2 &&
    Array.isArray(value.items) &&
    value.items.length === 0
  );
}

export function isWorkspaceLockPath(logicalPath: string): boolean {
  return logicalPath === WORKSPACE_LOCK_LOGICAL_PATH;
}

export function corruptManagedLock(logicalPath: string, reason: string): Error {
  return isWorkspaceLockPath(logicalPath)
    ? corruptWorkspaceLock(logicalPath, reason)
    : corruptGeneratedLock(logicalPath, reason);
}

export function corruptWorkspaceLock(
  displayLockPath: string,
  reason: string
): Error {
  return new Error(
    `skillset: workspace lock ${displayLockPath} cannot guard generated state because ${reason}. ` +
      "Restore it from a clean build (skillset build) or remove it deliberately before rebuilding."
  );
}

export function corruptGeneratedLock(
  displayLockPath: string,
  reason: string
): Error {
  return new Error(
    `skillset: generated lock ${displayLockPath} cannot guard generated state because ${reason}. ` +
      "Fix or remove the lock before running build, check, or diff."
  );
}

function assertExpectedOutputRoot(
  outputRoot: string,
  options: Pick<
    ReadGeneratedLockFromDiskOptions,
    "expectedOutputRoot" | "logicalPath"
  >
): void {
  if (
    options.expectedOutputRoot === undefined ||
    outputRoot === options.expectedOutputRoot
  ) {
    return;
  }
  const expected =
    options.expectedOutputRoot === "."
      ? "the workspace root"
      : JSON.stringify(options.expectedOutputRoot);
  throw corruptManagedLock(
    options.logicalPath,
    `its outputRoot ${JSON.stringify(outputRoot)} is not ${expected}`
  );
}

function lockReadError(logicalPath: string, error: unknown): Error {
  if (isCorruptLockError(error, logicalPath)) return error as Error;
  return corruptManagedLock(logicalPath, reasonFromReadError(logicalPath, error));
}

function reasonFromReadError(logicalPath: string, error: unknown): string {
  if (error instanceof OnDiskJsonError) {
    return reasonFromJsonFailure(error.failure);
  }
  const message = error instanceof Error ? error.message : String(error);
  return stripLockLabel(logicalPath, message);
}

function reasonFromJsonFailure(failure: OnDiskJsonFailure): string {
  if (failure.kind === "missing") return "it is missing";
  if (failure.kind === "invalid-json") {
    return `it is not valid JSON: ${causeMessage(failure.cause)}`;
  }
  const code = failure.code === undefined ? "" : ` (${failure.code})`;
  return `it cannot be read${code}: ${causeMessage(failure.cause)}`;
}

function stripLockLabel(logicalPath: string, message: string): string {
  return message
    .replace(/^skillset: /, "")
    .replace(new RegExp(`^${escapeRegExp(logicalPath)} `), "");
}

function isCorruptLockError(error: unknown, logicalPath: string): boolean {
  if (!(error instanceof Error)) return false;
  const prefix = isWorkspaceLockPath(logicalPath)
    ? `skillset: workspace lock ${logicalPath} cannot guard generated state because `
    : `skillset: generated lock ${logicalPath} cannot guard generated state because `;
  return error.message.startsWith(prefix);
}

function causeMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
