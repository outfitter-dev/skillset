/**
 * Output-repair planning and scoped-write policy (SET-599).
 *
 * `output-repair.ts` owns pure three-way verdicts. This module connects those
 * verdicts to managed output state, expands explicit paths to complete lock
 * items, and merges scoped lock writes so the lock still describes disk.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";

import { withLockProvenance } from "./lock-provenance";
import { classifyRepairPath, planOutputRepair } from "./output-repair";
import type { SkillsetRepairPlan } from "./output-repair";
import type { ManagedOutputState, OutputPathResolver } from "./output-safety";
import { compareStrings } from "./path";
import { renderValidatedJson } from "./structured-output";
import type {
  JsonRecord,
  JsonValue,
  RenderedFile,
  SkillsetRepairOptions,
} from "./types";
import { isJsonRecord } from "./yaml";

const textDecoder = new TextDecoder();
const textEncoder = new TextEncoder();

const outputRootForLockPath = (lockPath: string): string => {
  if (lockPath === "skillset.lock") {
    return ".";
  }
  return path.dirname(lockPath).replaceAll("\\", "/");
};

const isLockFilePath = (candidatePath: string): boolean =>
  candidatePath === "skillset.lock" || candidatePath.endsWith("/skillset.lock");

const readLockRecord = async (
  absolutePath: string
): Promise<JsonRecord | undefined> => {
  try {
    const contents = await readFile(absolutePath, "utf-8");
    const parsed = JSON.parse(contents) as unknown;
    return isJsonRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
};

const readPreviousLocks = async (
  locks: readonly RenderedFile[],
  resolveOutputPath: OutputPathResolver
): Promise<ReadonlyMap<string, JsonRecord | undefined>> =>
  new Map(
    await Promise.all(
      locks.map(
        async (lock) =>
          [
            lock.path,
            await readLockRecord(resolveOutputPath(lock.path)),
          ] as const
      )
    )
  );

const parseRenderedLock = (file: RenderedFile): JsonRecord | undefined => {
  try {
    const parsed = JSON.parse(textDecoder.decode(file.content)) as unknown;
    return isJsonRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
};

const lockItemGroups = (
  lockPath: string,
  record: JsonRecord | undefined
): readonly (readonly string[])[] => {
  if (record === undefined) {
    return [];
  }
  const root = outputRootForLockPath(lockPath);
  const items = Array.isArray(record.items) ? record.items : [];
  return items.flatMap((item) => {
    if (!isJsonRecord(item) || !Array.isArray(item.files)) {
      return [];
    }
    const files = item.files.filter(
      (file): file is string => typeof file === "string"
    );
    return [files.map((file) => (root === "." ? file : `${root}/${file}`))];
  });
};

const expandScopeToLockItems = (
  requested: ReadonlySet<string>,
  locks: readonly RenderedFile[],
  previousByLock: ReadonlyMap<string, JsonRecord | undefined>
): ReadonlySet<string> => {
  const scope = new Set(requested);
  for (const lock of locks) {
    const groups = [
      ...lockItemGroups(lock.path, parseRenderedLock(lock)),
      ...lockItemGroups(lock.path, previousByLock.get(lock.path)),
    ];
    for (const group of groups) {
      if (!group.some((candidatePath) => requested.has(candidatePath))) {
        continue;
      }
      for (const candidatePath of group) {
        scope.add(candidatePath);
      }
    }
  }
  return scope;
};

const mergeScopedLock = (
  lock: RenderedFile,
  previous: JsonRecord | undefined,
  scope: ReadonlySet<string>
): RenderedFile => {
  const fresh = parseRenderedLock(lock);
  if (fresh === undefined || previous === undefined) {
    return lock;
  }
  const root = outputRootForLockPath(lock.path);
  const qualify = (item: JsonValue): readonly string[] => {
    if (!isJsonRecord(item) || !Array.isArray(item.files)) {
      return [];
    }
    return item.files
      .filter((file): file is string => typeof file === "string")
      .map((file) => (root === "." ? file : `${root}/${file}`));
  };
  const inScope = (item: JsonValue): boolean => {
    const files = qualify(item);
    return (
      files.length > 0 &&
      files.every((candidatePath) => scope.has(candidatePath))
    );
  };
  const freshItems = Array.isArray(fresh.items) ? fresh.items : [];
  const previousItems = Array.isArray(previous.items) ? previous.items : [];
  const merged = [
    ...freshItems.filter((item) => inScope(item)),
    ...previousItems.filter((item) => !inScope(item)),
  ].toSorted((left, right) =>
    compareStrings(
      isJsonRecord(left) ? String(left.outputPath) : "",
      isJsonRecord(right) ? String(right.outputPath) : ""
    )
  );
  const value = withLockProvenance({ ...fresh, items: merged });
  return {
    ...lock,
    content: textEncoder.encode(renderValidatedJson(value, lock.path)),
  };
};

/** Classify every managed output in the requested repair scope. */
export const inspectOutputRepairPlan = (args: {
  readonly actualPaths: ReadonlySet<string>;
  readonly changedPaths: readonly string[];
  readonly expected: ReadonlyMap<string, RenderedFile>;
  readonly managedState: ManagedOutputState;
  readonly repair: SkillsetRepairOptions;
  readonly scope: ReadonlySet<string> | undefined;
}): SkillsetRepairPlan => {
  const changed = new Set(args.changedPaths);
  const verdicts = [...args.managedState.paths]
    .filter((candidatePath) => !isLockFilePath(candidatePath))
    .filter(
      (candidatePath) =>
        args.expected.has(candidatePath) || args.actualPaths.has(candidatePath)
    )
    .filter(
      (candidatePath) =>
        args.scope === undefined || args.scope.has(candidatePath)
    )
    .map((candidatePath) =>
      classifyRepairPath({
        ...(args.repair.discardEdits === undefined
          ? {}
          : { discardEdits: args.repair.discardEdits }),
        fileMatchesLock: !args.managedState.editedPaths.has(candidatePath),
        filePresent: args.actualPaths.has(candidatePath),
        lockComparable:
          !args.managedState.lockIncomparablePaths.has(candidatePath),
        outputPath: candidatePath,
        renderMatchesFile: !changed.has(candidatePath),
        renderMatchesLock:
          !args.managedState.renderDriftPaths.has(candidatePath),
        rendered: args.expected.has(candidatePath),
      })
    );
  return planOutputRepair(verdicts);
};

/** Expand named repair paths to every file covered by the same lock item. */
export const expandOutputRepairScope = async (args: {
  readonly rendered: readonly RenderedFile[];
  readonly repairPaths: readonly string[];
  readonly resolveOutputPath: OutputPathResolver;
}): Promise<ReadonlySet<string>> => {
  const locks = args.rendered.filter((file) => isLockFilePath(file.path));
  const previousByLock = await readPreviousLocks(locks, args.resolveOutputPath);
  return expandScopeToLockItems(
    new Set(args.repairPaths),
    locks,
    previousByLock
  );
};

/**
 * Narrow a repair write while keeping each affected lock internally complete.
 *
 * The full projection is still inspected. Write-side safety planning and the
 * final transaction are scoped together, and each affected lock combines fresh
 * in-scope entries with prior out-of-scope entries so its hashes continue to
 * describe the files actually on disk.
 */
export const scopeOutputRepairWrite = async (args: {
  readonly rendered: readonly RenderedFile[];
  readonly repairScope: ReadonlySet<string> | undefined;
  readonly resolveOutputPath: OutputPathResolver;
  readonly staleManagedPaths: readonly string[];
}): Promise<{
  readonly rendered: readonly RenderedFile[];
  readonly staleManagedPaths: readonly string[];
}> => {
  if (args.repairScope === undefined) {
    return {
      rendered: args.rendered,
      staleManagedPaths: args.staleManagedPaths,
    };
  }

  const scope = args.repairScope;
  const locks = args.rendered.filter((file) => isLockFilePath(file.path));
  const previousByLock = await readPreviousLocks(locks, args.resolveOutputPath);
  const rendered = args.rendered.flatMap((file) => {
    if (!isLockFilePath(file.path)) {
      return scope.has(file.path) ? [file] : [];
    }
    return [mergeScopedLock(file, previousByLock.get(file.path), scope)];
  });

  return {
    rendered,
    staleManagedPaths: args.staleManagedPaths.filter((candidatePath) =>
      scope.has(candidatePath)
    ),
  };
};
