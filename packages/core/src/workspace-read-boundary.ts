import { AsyncLocalStorage } from "node:async_hooks";
import { lstatSync } from "node:fs";
import { lstat, realpath } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { isPathInside, logicalDiagnosticPath } from "./path";

interface WorkspaceReadBoundary {
  readonly selectedRoot: string;
  readonly root: string;
  /** Keep refusals visible even when an existing optional reader catches them. */
  failure?: { readonly error: unknown };
}

const boundaries = new AsyncLocalStorage<WorkspaceReadBoundary>();

export class WorkspaceReadBoundaryError extends Error {
  constructor(message: string) {
    super(`skillset: workspace inspection ${message}`);
    this.name = "WorkspaceReadBoundaryError";
  }
}

/**
 * Constrain the shared read facade to one explicitly selected workspace.
 * The root may be a symlink; descendants may not. This guards pre-existing
 * links, not a concurrent attacker swapping paths between lstat and a read.
 */
export async function withWorkspaceReadBoundary<T>(
  rootPath: string,
  inspect: () => Promise<T>
): Promise<T> {
  const selectedRoot = resolve(rootPath);
  const root = await realpath(selectedRoot);
  if (!(await lstat(root)).isDirectory()) {
    throw new WorkspaceReadBoundaryError("requires a directory as the selected root");
  }
  const boundary: WorkspaceReadBoundary = { root, selectedRoot };
  return boundaries.run(boundary, async () => {
    try {
      return await inspect();
    } finally {
      if (boundary.failure !== undefined) throw boundary.failure.error;
    }
  });
}

export function hasWorkspaceReadBoundary(): boolean {
  return boundaries.getStore() !== undefined;
}

/** Used by the read facade, immediately before each asynchronous operation. */
export async function prepareWorkspaceRead(path: unknown): Promise<string> {
  const boundary = boundaries.getStore();
  if (boundary === undefined) throw new Error("workspace read boundary is not active");
  try {
    const plan = readPathPlan(boundary, path);
    for (const component of plan.components) {
      let entry;
      try {
        entry = await lstat(component);
      } catch (error) {
        if (isMissing(error)) break;
        throw error;
      }
      assertNotLink(boundary, component, entry.isSymbolicLink());
    }
    return plan.path;
  } catch (error) {
    boundary.failure ??= { error };
    throw error;
  }
}

/** Synchronous render/dependency readers must obey the same scope. */
export function prepareWorkspaceReadSync(path: unknown): string {
  const boundary = boundaries.getStore();
  if (boundary === undefined) throw new Error("workspace read boundary is not active");
  try {
    const plan = readPathPlan(boundary, path);
    for (const component of plan.components) {
      let entry;
      try {
        entry = lstatSync(component);
      } catch (error) {
        if (isMissing(error)) break;
        throw error;
      }
      assertNotLink(boundary, component, entry.isSymbolicLink());
    }
    return plan.path;
  } catch (error) {
    boundary.failure ??= { error };
    throw error;
  }
}

function readPathPlan(boundary: WorkspaceReadBoundary, operand: unknown) {
  const value = operand instanceof URL ? fileURLToPath(operand) : operand;
  if (typeof value !== "string") {
    throw new WorkspaceReadBoundaryError("requires a named workspace path");
  }
  const absolute = resolve(value);
  const from = isPathInside(boundary.selectedRoot, absolute, { allowEqual: true })
    ? boundary.selectedRoot : boundary.root;
  if (!isPathInside(from, absolute, { allowEqual: true })) {
    throw new WorkspaceReadBoundaryError("refuses a path outside the selected workspace");
  }
  const suffix = relative(from, absolute);
  const components = [boundary.root];
  let path = boundary.root;
  for (const part of suffix.split(sep).filter(Boolean)) {
    path = join(path, part);
    components.push(path);
  }
  return { components, path };
}

function assertNotLink(boundary: WorkspaceReadBoundary, path: string, isLink: boolean): void {
  if (isLink) {
    throw new WorkspaceReadBoundaryError(
      `refuses a symbolic link at ${logicalDiagnosticPath(boundary.root, path) || "."}`
    );
  }
}

function isMissing(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
