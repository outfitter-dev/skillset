/* eslint-disable no-await-in-loop -- Parent components must be inspected and created in ancestry order. */

import { lstat, mkdir, realpath } from "node:fs/promises";
import {
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";

import { isPathInside } from "./path";

/**
 * Repository mutation ancestry.
 *
 * Lexical containment (`resolveInside`) does not constrain filesystem
 * resolution. Callers that create, write, rename, restore, or delete through
 * repository-relative parents must walk those parents with `lstat` so a
 * symlinked `.skillset`, source, plugin, or generated-output component cannot
 * redirect bytes outside the workspace.
 *
 * A workspace root may itself be a symlink. After `realpath`, that resolved
 * directory is the mutation root. Intermediate parent components must be real
 * directories — never symlinks or non-directories. There is no supported
 * contract for an intermediate source-root symlink. An existing leaf must not
 * be a symlink either, unless the caller replaces the leaf itself
 * (`replacesLeaf`) instead of writing through it.
 */
export class RepositoryMutationError extends Error {
  readonly code?: string;
  readonly logicalPath: string;

  constructor(
    message: string,
    options: {
      readonly cause?: unknown;
      readonly code?: string;
      readonly logicalPath?: string;
    } = {}
  ) {
    super(`skillset: ${message}`, {
      ...(options.cause === undefined ? {} : { cause: options.cause }),
    });
    this.name = "RepositoryMutationError";
    this.logicalPath = options.logicalPath ?? "";
    if (options.code !== undefined) {
      this.code = options.code;
    }
  }
}

/** Test seams for concurrent parent replacement during creation. */
export interface RepositoryMutationTestHooks {
  readonly afterCreateComponent?: (
    logicalPath: string,
    absolutePath: string
  ) => Promise<void> | void;
  readonly beforeInspectComponent?: (
    logicalPath: string,
    absolutePath: string
  ) => Promise<void> | void;
}

export interface PrepareRepositoryMutationPathOptions {
  /**
   * Create missing parent directories one component at a time. Defaults to
   * `true`. Delete and absent-restore paths should pass `false` so a missing
   * ancestor is not created, while an existing symlink ancestor still fails
   * closed.
   */
  readonly createParents?: boolean;
  /**
   * The caller removes, renames over, or exclusively creates the leaf (`rm`,
   * `rename`, atomic publication, `link`/`wx` install) and so never writes
   * through it. Defaults to `false`: an existing symbolic-link leaf is
   * refused, because `writeFile` and `appendFile` would follow it out of the
   * workspace.
   */
  readonly replacesLeaf?: boolean;
  readonly testHooks?: RepositoryMutationTestHooks;
}

export interface PreparedRepositoryMutationPath {
  readonly createdDirectories: readonly string[];
  readonly path: string;
  readonly workspaceRoot: string;
}

const INSPECT_FAILURE_CODES = new Set(["EACCES", "EIO", "ELOOP"]);

/**
 * Resolve the workspace mutation root.
 *
 * A symlink supplied as the workspace root is supported: `realpath` follows it
 * once, then the resolved directory must be a real directory. Intermediate
 * symlink traversal beneath that root is refused by
 * {@link prepareRepositoryMutationPath}.
 */
export async function resolveWorkspaceMutationRoot(
  workspaceRoot: string
): Promise<string> {
  const supplied = resolve(workspaceRoot);
  let resolved: string;
  try {
    resolved = await realpath(supplied);
  } catch (error) {
    if (isErrno(error, "ENOENT")) {
      throw new RepositoryMutationError(
        `workspace root does not exist: ${displayLogicalPath(workspaceRoot)}`,
        { cause: error, code: "ENOENT", logicalPath: displayLogicalPath(workspaceRoot) }
      );
    }
    throw wrapInspectError(error, displayLogicalPath(workspaceRoot));
  }
  const entry = await inspectExisting(resolved, displayLogicalPath(workspaceRoot));
  if (entry.isSymbolicLink() || !entry.isDirectory()) {
    throw new RepositoryMutationError(
      `workspace root is not a directory: ${displayLogicalPath(workspaceRoot)}`,
      { logicalPath: displayLogicalPath(workspaceRoot) }
    );
  }
  return resolved;
}

/**
 * Resolve `path` inside the workspace and ensure every existing parent
 * component is a real directory. Missing parents are created one component at
 * a time when `createParents` is true, then rechecked so a concurrent symlink
 * or non-directory replacement fails closed.
 */
export async function prepareRepositoryMutationPath(
  workspaceRoot: string,
  path: string,
  options: PrepareRepositoryMutationPathOptions = {}
): Promise<PreparedRepositoryMutationPath> {
  const createParents = options.createParents !== false;
  const resolvedRoot = await resolveWorkspaceMutationRoot(workspaceRoot);
  const relativePath = repositoryRelativePath(workspaceRoot, resolvedRoot, path);
  const absolutePath =
    relativePath === "" ? resolvedRoot : resolve(resolvedRoot, relativePath);
  const parentRelative = relativePath === "" ? "" : dirname(relativePath);
  const prepared = {
    createdDirectories: [] as string[],
    path: absolutePath,
    workspaceRoot: resolvedRoot,
  };
  if (relativePath === "") {
    return prepared;
  }

  const { createdDirectories } = prepared;
  let current = resolvedRoot;
  for (const segment of parentRelative.split(sep).filter((part) => part !== "" && part !== ".")) {
    current = join(current, segment);
    const logicalPath = relative(resolvedRoot, current);
    try {
      await options.testHooks?.beforeInspectComponent?.(logicalPath, current);
    } catch (error) {
      throw wrapInspectError(error, logicalPath);
    }
    const existing = await inspectComponent(current, logicalPath);
    if (existing !== undefined) {
      assertPlainDirectory(existing, logicalPath);
      continue;
    }
    if (!createParents) {
      return prepared;
    }

    let created = false;
    try {
      await mkdir(current);
      created = true;
    } catch (error) {
      if (!isErrno(error, "EEXIST")) {
        throw wrapInspectError(error, logicalPath);
      }
    }
    await options.testHooks?.afterCreateComponent?.(logicalPath, current);
    const recheck = await inspectComponent(current, logicalPath);
    if (recheck === undefined) {
      throw new RepositoryMutationError(
        `parent disappeared during creation: ${logicalPath}`,
        { logicalPath }
      );
    }
    assertPlainDirectory(recheck, logicalPath);
    if (created) {
      createdDirectories.push(current);
    }
  }

  if (options.replacesLeaf !== true) {
    const logicalPath = relative(resolvedRoot, absolutePath);
    const leaf = await inspectComponent(absolutePath, logicalPath);
    if (leaf?.isSymbolicLink() === true) {
      throw new RepositoryMutationError(
        `refusing to write through symbolic link: ${logicalPath}`,
        { logicalPath }
      );
    }
  }
  return prepared;
}

function repositoryRelativePath(
  workspaceRoot: string,
  resolvedRoot: string,
  path: string
): string {
  const unresolvedRoot = resolve(workspaceRoot);
  const absolute = isAbsolute(path) ? resolve(path) : resolve(unresolvedRoot, path);
  if (isPathInside(unresolvedRoot, absolute, { allowEqual: true })) {
    return relative(unresolvedRoot, absolute);
  }
  if (isPathInside(resolvedRoot, absolute, { allowEqual: true })) {
    return relative(resolvedRoot, absolute);
  }
  throw new RepositoryMutationError(`path escapes workspace root: ${path}`, {
    logicalPath: path,
  });
}

async function inspectComponent(path: string, logicalPath: string) {
  try {
    return await lstat(path);
  } catch (error) {
    if (isErrno(error, "ENOENT")) {
      return;
    }
    if (isErrno(error, "ENOTDIR")) {
      throw new RepositoryMutationError(
        `refusing to traverse non-directory parent: ${logicalPath}`,
        { logicalPath }
      );
    }
    throw wrapInspectError(error, logicalPath);
  }
}

async function inspectExisting(path: string, logicalPath: string) {
  try {
    return await lstat(path);
  } catch (error) {
    throw wrapInspectError(error, logicalPath);
  }
}

function assertPlainDirectory(
  entry: Awaited<ReturnType<typeof lstat>>,
  logicalPath: string
): void {
  if (entry.isSymbolicLink()) {
    throw new RepositoryMutationError(
      `refusing to traverse symbolic link: ${logicalPath}`,
      { logicalPath }
    );
  }
  if (!entry.isDirectory()) {
    throw new RepositoryMutationError(
      `refusing to traverse non-directory parent: ${logicalPath}`,
      { logicalPath }
    );
  }
}

function wrapInspectError(error: unknown, logicalPath: string): Error {
  if (error instanceof RepositoryMutationError) {
    return error;
  }
  const code = errnoCode(error);
  if (code !== undefined && INSPECT_FAILURE_CODES.has(code)) {
    return new RepositoryMutationError(
      `unable to inspect ${logicalPath}: ${code}`,
      { cause: error, code, logicalPath }
    );
  }
  return error instanceof Error
    ? error
    : new RepositoryMutationError(`unable to inspect ${logicalPath}`, {
        cause: error,
        logicalPath,
      });
}

function isErrno(error: unknown, code: string): boolean {
  return errnoCode(error) === code;
}

function errnoCode(error: unknown): string | undefined {
  return error instanceof Error && "code" in error && typeof error.code === "string"
    ? error.code
    : undefined;
}

function displayLogicalPath(path: string): string {
  return path === "" ? "." : path;
}
