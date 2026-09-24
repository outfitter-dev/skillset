import { access, lstat, readFile, stat } from "node:fs/promises";

/**
 * Absence codes a caller may treat as "not present".
 *
 * `ENOENT` is ordinary absence. `ENOTDIR` is not equivalent: it means a path
 * prefix is a non-directory, so each caller must opt in explicitly.
 */
export type MissingPathCode = "ENOENT" | "ENOTDIR";

export type PathExistenceProbe = "access" | "lstat" | "stat";

export const MISSING_PATH_ENOENT = ["ENOENT"] as const;
export const MISSING_PATH_ENOENT_OR_ENOTDIR = ["ENOENT", "ENOTDIR"] as const;

export interface PathExistenceOptions {
  readonly missing: readonly MissingPathCode[];
  readonly probe: PathExistenceProbe;
}

export interface DirectoryExistenceOptions {
  readonly missing: readonly MissingPathCode[];
  readonly probe: Exclude<PathExistenceProbe, "access">;
}

export interface OptionalTextOptions {
  readonly missing: readonly MissingPathCode[];
}

export function isMissingPathError(
  error: unknown,
  missing: readonly MissingPathCode[] = MISSING_PATH_ENOENT
): error is NodeJS.ErrnoException {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string" &&
    missing.includes(error.code as MissingPathCode)
  );
}

export function assignErrorPath(error: unknown, path: string): unknown {
  if (typeof error === "object" && error !== null) {
    if (!("path" in error) || error.path === undefined) {
      Object.defineProperty(error, "path", {
        configurable: true,
        enumerable: true,
        value: path,
        writable: true,
      });
    }
    return error;
  }
  return Object.assign(new Error(String(error)), { path });
}

/**
 * Returns false only for the caller's declared missing codes. `EACCES`, `EIO`,
 * `ELOOP`, and any other operational error are rethrown with `error.path`.
 */
export function falseIfMissingPath(
  error: unknown,
  path: string,
  missing: readonly MissingPathCode[] = MISSING_PATH_ENOENT
): false {
  if (isMissingPathError(error, missing)) return false;
  throw assignErrorPath(error, path);
}

export async function pathExists(
  path: string,
  options: PathExistenceOptions
): Promise<boolean> {
  try {
    await probePath(path, options.probe);
    return true;
  } catch (error) {
    return falseIfMissingPath(error, path, options.missing);
  }
}

export async function directoryExists(
  path: string,
  options: DirectoryExistenceOptions
): Promise<boolean> {
  try {
    const stats =
      options.probe === "lstat" ? await lstat(path) : await stat(path);
    return stats.isDirectory();
  } catch (error) {
    return falseIfMissingPath(error, path, options.missing);
  }
}

export async function readOptionalText(
  path: string,
  options: OptionalTextOptions
): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (isMissingPathError(error, options.missing)) return undefined;
    throw assignErrorPath(error, path);
  }
}

async function probePath(
  path: string,
  probe: PathExistenceProbe
): Promise<void> {
  if (probe === "access") {
    await access(path);
    return;
  }
  if (probe === "lstat") {
    await lstat(path);
    return;
  }
  await stat(path);
}
