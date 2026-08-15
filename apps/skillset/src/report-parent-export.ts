import { lstat, realpath } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

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
  readonly artifactDirectory?: string;
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
  input: ExportSandboxReportInput
): Promise<StoredReportBundle> {
  if (!UUID_V4_PATTERN.test(input.reportId)) {
    throw new Error("skillset: sandbox report export requires a full UUIDv4");
  }
  if (!isAbsolute(input.parentXdg.state)) {
    throw new Error(
      "skillset: sandbox report export requires an absolute captured parent XDG state root"
    );
  }

  const sandbox = await validateTestSandbox(
    input.childEnv,
    input.expectedRepoRoot
  );
  const childReportRoot = resolveReportStoreRoot({
    env: { XDG_STATE_HOME: sandbox.xdg.state },
  });
  const parentReportRoot = resolveReportStoreRoot({
    env: { XDG_STATE_HOME: input.parentXdg.state },
  });
  if (input.artifactDirectory !== undefined) {
    await rejectOverlappingRoots(
      [
        sandbox.descriptor.sandboxPath,
        sandbox.xdg.state,
        childReportRoot,
        input.parentXdg.state,
        parentReportRoot,
        join(parentReportRoot, input.reportId),
      ],
      [input.artifactDirectory]
    );
  }
  await rejectOverlappingRoots(
    [sandbox.descriptor.sandboxPath, sandbox.xdg.state, childReportRoot],
    [input.parentXdg.state, parentReportRoot]
  );

  return importReportBundle({
    destination: {
      env: { XDG_STATE_HOME: input.parentXdg.state },
    },
    sentinels: input.sensitiveValues,
    sourceReference: input.reportId,
    sourceReportRoot: childReportRoot,
    sourceSandboxRoot: sandbox.descriptor.sandboxPath,
  });
}

async function rejectOverlappingRoots(
  childPaths: readonly string[],
  parentPaths: readonly string[]
): Promise<void> {
  const canonicalChildren = await Promise.all(
    childPaths.map(canonicalizePotentialPath)
  );
  const canonicalParents = await Promise.all(
    parentPaths.map(canonicalizePotentialPath)
  );
  for (const childPath of canonicalChildren) {
    for (const parentPath of canonicalParents) {
      if (pathsOverlap(childPath, parentPath)) {
        throw new Error(
          "skillset: child and parent report state must not overlap"
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
      }
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
