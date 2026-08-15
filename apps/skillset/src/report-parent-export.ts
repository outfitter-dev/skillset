import { lstat, realpath } from "node:fs/promises";
import {
  dirname,
  isAbsolute,
  join,
  parse,
  relative,
  resolve,
  sep,
} from "node:path";

import {
  importReportBundle,
  resolveReportStoreRoot,
  type StoredReportBundle,
} from "@skillset/core/internal/report-store";

import { validateTestSandbox } from "./verification-sandbox";

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export interface CapturedParentXdg {
  /** Captured before replacing the child process environment. */
  readonly state: string;
}

export interface ExportSandboxReportInput {
  readonly childEnv: Readonly<Record<string, string | undefined>>;
  readonly expectedRepoRoot: string;
  readonly parentXdg: CapturedParentXdg;
  readonly reportId: string;
  readonly sensitiveValues?: readonly string[];
}

/**
 * Imports one explicitly requested report from an owned child sandbox.
 *
 * Neither side supplies a report path: the source is derived from validated
 * child XDG state and the destination from parent XDG state captured before
 * the child environment was constructed.
 */
export async function exportSandboxReportToParent(
  input: ExportSandboxReportInput,
): Promise<StoredReportBundle> {
  if (!UUID_V4_PATTERN.test(input.reportId)) {
    throw new Error("skillset: sandbox report export requires a full UUIDv4");
  }
  if (!isAbsolute(input.parentXdg.state)) {
    throw new Error(
      "skillset: sandbox report export requires an absolute captured parent XDG state root",
    );
  }

  const sandbox = await validateTestSandbox(
    input.childEnv,
    input.expectedRepoRoot,
  );
  const childReportRoot = resolveReportStoreRoot({
    env: { XDG_STATE_HOME: sandbox.xdg.state },
  });
  const parentReportRoot = resolveReportStoreRoot({
    env: { XDG_STATE_HOME: input.parentXdg.state },
  });
  const parentTrustedBase = await findExistingTrustedBase(
    input.parentXdg.state,
  );

  await rejectOverlappingRoots(
    [sandbox.descriptor.sandboxPath, sandbox.xdg.state, childReportRoot],
    [input.parentXdg.state, parentReportRoot],
  );

  return importReportBundle({
    destination: {
      boundary: {
        reportRoot: parentReportRoot,
        trustedBase: parentTrustedBase,
      },
    },
    sentinels: input.sensitiveValues,
    sourceReference: input.reportId,
    sourceReportRoot: childReportRoot,
    sourceSandboxRoot: sandbox.descriptor.sandboxPath,
  });
}

async function findExistingTrustedBase(path: string): Promise<string> {
  const absolute = resolve(path);
  const authority = parse(absolute).root;
  const authorityEntry = await lstat(authority);
  if (authorityEntry.isSymbolicLink() || !authorityEntry.isDirectory()) {
    throw new Error(
      "skillset: parent filesystem authority must be a plain directory",
    );
  }

  const components = relative(authority, absolute)
    .split(sep)
    .filter((component) => component.length > 0);
  let candidate = authority;
  let trustedBase = authority;
  let reachedMissingComponent = false;
  for (const component of components) {
    candidate = join(candidate, component);
    if (reachedMissingComponent) continue;
    try {
      const entry = await lstat(candidate);
      if (entry.isSymbolicLink()) {
        throw new Error(
          "skillset: captured parent XDG state ancestry must not contain symlinks",
        );
      }
      if (!entry.isDirectory()) {
        throw new Error(
          "skillset: captured parent XDG state ancestry must contain only directories",
        );
      }
      trustedBase = candidate;
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        reachedMissingComponent = true;
        continue;
      }
      throw error;
    }
  }
  return trustedBase;
}

async function rejectOverlappingRoots(
  childPaths: readonly string[],
  parentPaths: readonly string[],
): Promise<void> {
  const canonicalChildren = await Promise.all(
    childPaths.map(canonicalizePotentialPath),
  );
  const canonicalParents = await Promise.all(
    parentPaths.map(canonicalizePotentialPath),
  );
  for (const childPath of canonicalChildren) {
    for (const parentPath of canonicalParents) {
      if (pathsOverlap(childPath, parentPath)) {
        throw new Error(
          "skillset: child and parent report state must not overlap",
        );
      }
    }
  }
}

async function canonicalizePotentialPath(path: string): Promise<string> {
  const absolute = resolve(path);
  let existing = absolute;
  const missing: string[] = [];
  while (true) {
    const entry = await lstat(existing).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return undefined;
        throw error;
      },
    );
    if (entry !== undefined) {
      return resolve(await realpath(existing), ...missing.reverse());
    }
    const parent = dirname(existing);
    if (parent === existing) return absolute;
    missing.push(relative(parent, existing));
    existing = parent;
  }
}

function pathsOverlap(left: string, right: string): boolean {
  return contains(left, right) || contains(right, left);
}

function contains(parent: string, child: string): boolean {
  const path = relative(parent, child);
  return (
    path === "" ||
    (!path.startsWith(`..${sep}`) && path !== ".." && !isAbsolute(path))
  );
}
