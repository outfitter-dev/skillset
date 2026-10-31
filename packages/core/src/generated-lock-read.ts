import {
  GeneratedLockValidationError,
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

/** Isolated builds remap generated paths under this prefix. It is display only. */
const ISOLATED_LOCK_PREFIX = ".skillset/cache/latest/";

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
    const lock = parseCurrentGeneratedLock(
      value,
      options.logicalPath,
      options.provenance === undefined ? {} : { provenance: options.provenance }
    );
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
    const lock = parseGeneratedLock(
      value,
      options.logicalPath,
      options.provenance === undefined ? {} : { provenance: options.provenance }
    );
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
  return lockIdentityPath(logicalPath) === WORKSPACE_LOCK_LOGICAL_PATH;
}

function lockIdentityPath(logicalPath: string): string {
  const normalized = logicalPath.replaceAll("\\", "/");
  return normalized.startsWith(ISOLATED_LOCK_PREFIX)
    ? normalized.slice(ISOLATED_LOCK_PREFIX.length)
    : normalized;
}

export type GeneratedLockFailureKind = OnDiskJsonFailure["kind"] | "schema";

/** Recovery context without erasing whether reading or validating failed. */
export class GeneratedLockReadError extends Error {
  readonly kind: GeneratedLockFailureKind;
  readonly logicalPath: string;
  readonly code?: string;
  readonly path?: string;

  constructor(
    logicalPath: string,
    reason: string,
    kind: GeneratedLockFailureKind,
    cause?: unknown,
    workspace = isWorkspaceLockPath(logicalPath)
  ) {
    super(
      `skillset: ${workspace ? "workspace" : "generated"} lock ${logicalPath} cannot guard generated state because ${reason}. ` +
        (workspace
          ? "Restore it from a clean build (skillset build) or remove it deliberately before rebuilding."
          : "Fix or remove the lock before running build, check, or diff."),
      { cause }
    );
    this.name = "GeneratedLockReadError";
    this.kind = kind;
    this.logicalPath = logicalPath;
    if (cause instanceof OnDiskJsonError) {
      this.path = cause.failure.path;
      if (cause.failure.code !== undefined) this.code = cause.failure.code;
    }
  }
}

export function corruptManagedLock(logicalPath: string, reason: string): Error {
  return new GeneratedLockReadError(logicalPath, reason, "schema");
}

export function corruptWorkspaceLock(
  displayLockPath: string,
  reason: string
): Error {
  return new GeneratedLockReadError(
    displayLockPath,
    reason,
    "schema",
    undefined,
    true
  );
}

export function corruptGeneratedLock(
  displayLockPath: string,
  reason: string
): Error {
  return new GeneratedLockReadError(
    displayLockPath,
    reason,
    "schema",
    undefined,
    false
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

function lockReadError(logicalPath: string, error: unknown): unknown {
  if (
    error instanceof GeneratedLockReadError &&
    error.logicalPath === logicalPath
  ) {
    return error;
  }
  if (error instanceof OnDiskJsonError) {
    return new GeneratedLockReadError(
      logicalPath,
      reasonFromJsonFailure(error.failure),
      error.failure.kind,
      error
    );
  }
  if (error instanceof GeneratedLockValidationError) {
    return new GeneratedLockReadError(
      logicalPath,
      stripLockLabel(logicalPath, error.message),
      "schema",
      error
    );
  }
  return error;
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

function causeMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
