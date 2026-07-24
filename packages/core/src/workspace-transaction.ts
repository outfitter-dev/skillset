/* eslint-disable func-style, no-use-before-define -- Hoisted helpers keep the transaction phases readable from plan through rollback. */
/* eslint-disable no-await-in-loop -- Workspace mutations and rollback must run in a strict, observable sequence. */

import {
  lstat,
  mkdir,
  mkdtemp,
  realpath,
  rename,
  rm,
  rmdir,
  writeFile,
} from "node:fs/promises";
import nodePath from "node:path";

import { compareStrings } from "./path";

/** A file written as part of a bounded workspace transaction. */
export interface WorkspaceTransactionWrite {
  readonly content: string | Uint8Array;
  readonly path: string;
}

/** A filesystem entry moved as part of a bounded workspace transaction. */
export interface WorkspaceTransactionMove {
  readonly from: string;
  readonly to: string;
}

/**
 * A declarative workspace mutation plan. Paths may be workspace-relative or
 * absolute, but every path must resolve inside `workspaceRoot`.
 */
export interface WorkspaceTransactionPlan {
  readonly deletes?: readonly string[];
  readonly moves?: readonly WorkspaceTransactionMove[];
  readonly writes?: readonly WorkspaceTransactionWrite[];
}

/** A deterministic, content-free description of one planned operation. */
export type WorkspaceTransactionOperation =
  | { readonly kind: "delete"; readonly path: string }
  | { readonly from: string; readonly kind: "move"; readonly to: string }
  | { readonly kind: "write"; readonly path: string };

/** The completed plan, normalized and ordered independently of input order. */
export interface WorkspaceTransactionReport {
  readonly operations: readonly WorkspaceTransactionOperation[];
  readonly workspaceRoot: string;
}

/** A rollback action exposed only to deterministic test hooks. */
export interface WorkspaceTransactionRollbackAction {
  readonly kind:
    | "remove-created-directory"
    | "restore-move"
    | "restore-preimage"
    | "restore-write";
  readonly path: string;
}

/**
 * Test-only hooks. They are instance-local so production code never depends on
 * process-global fault state.
 */
export interface WorkspaceTransactionTestHooks {
  readonly beforeApply?: (
    operation: WorkspaceTransactionOperation,
    index: number
  ) => Promise<void> | void;
  readonly beforeRollback?: (
    action: WorkspaceTransactionRollbackAction,
    index: number
  ) => Promise<void> | void;
}

export interface WorkspaceTransactionOptions {
  /**
   * Test-only deterministic fault injection.
   *
   * @internal
   */
  readonly testHooks?: WorkspaceTransactionTestHooks;
}

export class WorkspaceTransactionRollbackError extends Error {
  public readonly originalError: unknown;
  public readonly rollbackFailures: readonly string[];

  public constructor(
    originalError: unknown,
    rollbackFailures: readonly string[]
  ) {
    const message =
      originalError instanceof Error
        ? originalError.message
        : String(originalError);
    super(
      `skillset: workspace transaction failed and rollback failed for ${rollbackFailures.join(", ")}: ${message}`,
      {
        cause: originalError,
      }
    );
    this.name = "WorkspaceTransactionRollbackError";
    this.originalError = originalError;
    this.rollbackFailures = rollbackFailures;
  }
}

interface NormalizedPath {
  readonly absolute: string;
  readonly relative: string;
}

interface NormalizedMove {
  readonly from: NormalizedPath;
  readonly operation: Extract<
    WorkspaceTransactionOperation,
    { readonly kind: "move" }
  >;
  readonly to: NormalizedPath;
}

interface NormalizedWrite {
  readonly content: string | Uint8Array;
  readonly operation: Extract<
    WorkspaceTransactionOperation,
    { readonly kind: "write" }
  >;
  readonly path: NormalizedPath;
}

interface NormalizedDelete {
  readonly operation: Extract<
    WorkspaceTransactionOperation,
    { readonly kind: "delete" }
  >;
  readonly path: NormalizedPath;
}

interface PreparedPlan {
  readonly deletes: readonly NormalizedDelete[];
  readonly moves: readonly NormalizedMove[];
  readonly operations: readonly WorkspaceTransactionOperation[];
  readonly writes: readonly NormalizedWrite[];
}

interface Preimage {
  readonly journalPath: string;
  readonly path: NormalizedPath;
}

interface AppliedMove {
  readonly caseStagingDirectory?: string;
  currentPath: string;
  readonly move: NormalizedMove;
  readonly preimage: Preimage;
}

interface AppliedWrite {
  currentPath: string;
  readonly stagingPath: string;
  readonly write: NormalizedWrite;
}

interface TransactionState {
  readonly appliedMoves: AppliedMove[];
  readonly appliedWrites: AppliedWrite[];
  readonly caseStagingDirectories: string[];
  readonly createdDirectories: string[];
  readonly journalPath: string;
  readonly latePreimages: Preimage[];
  readonly preimages: Map<string, Preimage>;
  readonly workspaceRoot: string;
}

const transactionError = (message: string): Error =>
  new Error(`skillset: workspace transaction ${message}`);

/**
 * Applies a filesystem plan beneath one existing workspace root.
 *
 * Preimages are moved into a private sibling journal before the first final
 * path is installed. That lets the transaction restore an exact prior entry
 * after a late write, move, delete, or injected failure without following
 * symlinks or touching paths outside the workspace.
 */
export async function applyWorkspaceTransaction(
  workspaceRoot: string,
  plan: WorkspaceTransactionPlan,
  options: WorkspaceTransactionOptions = {}
): Promise<WorkspaceTransactionReport> {
  const resolvedWorkspaceRoot = await resolveWorkspaceRoot(workspaceRoot);
  const prepared = preparePlan(resolvedWorkspaceRoot, plan);
  const initialEntries = await inspectInitialEntries(
    resolvedWorkspaceRoot,
    prepared
  );
  assertMoveTargetCollisions(prepared, initialEntries);

  const state: TransactionState = {
    appliedMoves: [],
    appliedWrites: [],
    caseStagingDirectories: [],
    createdDirectories: [],
    journalPath: await mkdtemp(
      nodePath.join(resolvedWorkspaceRoot, ".skillset-workspace-transaction-")
    ),
    latePreimages: [],
    preimages: new Map(),
    workspaceRoot: resolvedWorkspaceRoot,
  };

  try {
    await mkdir(nodePath.join(state.journalPath, "late-preimages"));
    await mkdir(nodePath.join(state.journalPath, "preimages"));
    await mkdir(nodePath.join(state.journalPath, "writes"));
    await stagePreimages(state, prepared, initialEntries);
    await applyMoves(
      state,
      prepared.moves,
      options.testHooks,
      prepared.operations
    );
    await applyWrites(
      state,
      prepared.writes,
      options.testHooks,
      prepared.operations
    );
    await applyDeletes(
      prepared.deletes,
      options.testHooks,
      prepared.operations
    );
    await cleanupCommittedTransaction(state);
    return {
      operations: prepared.operations,
      workspaceRoot: resolvedWorkspaceRoot,
    };
  } catch (error) {
    const rollbackFailures = await rollbackTransaction(
      state,
      options.testHooks
    );
    if (rollbackFailures.length > 0) {
      throw new WorkspaceTransactionRollbackError(error, rollbackFailures);
    }
    throw error;
  }
}

function preparePlan(
  workspaceRoot: string,
  plan: WorkspaceTransactionPlan
): PreparedPlan {
  const writes = (plan.writes ?? [])
    .map((write) => {
      const path = normalizePath(workspaceRoot, write.path);
      return {
        content: write.content,
        operation: { kind: "write" as const, path: path.relative },
        path,
      };
    })
    .toSorted((left, right) =>
      compareStrings(left.path.relative, right.path.relative)
    );
  const moves = (plan.moves ?? [])
    .map((move) => {
      const from = normalizePath(workspaceRoot, move.from);
      const to = normalizePath(workspaceRoot, move.to);
      if (from.relative === to.relative) {
        throw transactionError(
          `move source and target are identical: ${from.relative}`
        );
      }
      return {
        from,
        operation: {
          from: from.relative,
          kind: "move" as const,
          to: to.relative,
        },
        to,
      };
    })
    .toSorted((left, right) => {
      const bySource = compareStrings(left.from.relative, right.from.relative);
      return bySource === 0
        ? compareStrings(left.to.relative, right.to.relative)
        : bySource;
    });
  const deletes = (plan.deletes ?? [])
    .map((path) => {
      const normalized = normalizePath(workspaceRoot, path);
      return {
        operation: { kind: "delete" as const, path: normalized.relative },
        path: normalized,
      };
    })
    .toSorted((left, right) =>
      compareStrings(left.path.relative, right.path.relative)
    );

  assertPlanPaths(writes, moves, deletes);
  return {
    deletes,
    moves,
    operations: [
      ...moves.map((move) => move.operation),
      ...writes.map((write) => write.operation),
      ...deletes.map((entry) => entry.operation),
    ],
    writes,
  };
}

function assertPlanPaths(
  writes: readonly NormalizedWrite[],
  moves: readonly NormalizedMove[],
  deletes: readonly NormalizedDelete[]
): void {
  const writePaths = new Set<string>();
  const deletePaths = new Set<string>();
  const moveSources = new Set<string>();
  const moveTargets = new Set<string>();

  for (const write of writes) {
    assertUnique(writePaths, write.path.relative, "write path");
  }
  for (const entry of deletes) {
    assertUnique(deletePaths, entry.path.relative, "delete path");
  }
  for (const move of moves) {
    assertUnique(moveSources, move.from.relative, "move source");
    assertUnique(moveTargets, move.to.relative, "move target");
  }

  for (const path of writePaths) {
    if (deletePaths.has(path) || moveSources.has(path)) {
      throw transactionError(`conflicting planned operations for ${path}`);
    }
  }
  for (const path of deletePaths) {
    if (moveSources.has(path)) {
      throw transactionError(`a move source cannot also be deleted: ${path}`);
    }
  }

  const paths = [
    ...writes.map((write) => ({ path: write.path.relative, role: "write" })),
    ...moves.flatMap((move) => [
      { path: move.from.relative, role: "move-source" },
      { path: move.to.relative, role: "move-target" },
    ]),
    ...deletes.map((entry) => ({ path: entry.path.relative, role: "delete" })),
  ].toSorted((left, right) => compareStrings(left.path, right.path));

  for (const [index, left] of paths.entries()) {
    for (const right of paths.slice(index + 1)) {
      if (left.path === right.path) {
        continue;
      }
      if (sameCaseInsensitivePath(left.path, right.path)) {
        const isOneCaseOnlyMove = moves.some(
          (move) =>
            (move.from.relative === left.path &&
              move.to.relative === right.path) ||
            (move.from.relative === right.path &&
              move.to.relative === left.path)
        );
        if (!isOneCaseOnlyMove) {
          throw transactionError(
            `ambiguous case-only planned paths: ${left.path} and ${right.path}`
          );
        }
      }
      if (
        isAncestorPath(left.path, right.path) ||
        isAncestorPath(right.path, left.path)
      ) {
        if (isWriteUnderMoveTarget(left, right)) {
          continue;
        }
        throw transactionError(
          `overlapping planned paths: ${left.path} and ${right.path}`
        );
      }
    }
  }
}

function assertUnique(paths: Set<string>, path: string, label: string): void {
  if (paths.has(path)) {
    throw transactionError(`duplicate ${label}: ${path}`);
  }
  paths.add(path);
}

async function inspectInitialEntries(
  workspaceRoot: string,
  prepared: PreparedPlan
): Promise<ReadonlyMap<string, Awaited<ReturnType<typeof inspectPath>>>> {
  const paths = new Map<string, NormalizedPath>();
  for (const write of prepared.writes) {
    paths.set(write.path.relative, write.path);
  }
  for (const move of prepared.moves) {
    paths.set(move.from.relative, move.from);
    paths.set(move.to.relative, move.to);
  }
  for (const entry of prepared.deletes) {
    paths.set(entry.path.relative, entry.path);
  }

  const entries = new Map<string, Awaited<ReturnType<typeof inspectPath>>>();
  for (const path of [...paths.values()].toSorted((left, right) =>
    compareStrings(left.relative, right.relative)
  )) {
    entries.set(path.relative, await inspectPath(workspaceRoot, path));
  }

  for (const move of prepared.moves) {
    const source = entries.get(move.from.relative);
    if (source === undefined) {
      throw transactionError(
        `move source does not exist: ${move.from.relative}`
      );
    }
    assertMovableEntry(source, move.from.relative);
    if (
      prepared.writes.some(
        (write) => write.path.relative === move.to.relative
      ) &&
      !source.isFile()
    ) {
      throw transactionError(
        `only a moved regular file can be rewritten at its destination: ${move.to.relative}`
      );
    }
  }
  for (const write of prepared.writes) {
    const entry = entries.get(write.path.relative);
    if (entry !== undefined && !entry.isFile()) {
      throw transactionError(
        `write target is not a regular file: ${write.path.relative}`
      );
    }
  }
  for (const entry of prepared.deletes) {
    const existing = entries.get(entry.path.relative);
    if (existing !== undefined) {
      assertMovableEntry(existing, entry.path.relative);
    }
  }
  return entries;
}

function assertMoveTargetCollisions(
  prepared: PreparedPlan,
  entries: ReadonlyMap<string, Awaited<ReturnType<typeof inspectPath>>>
): void {
  const moveSources = new Set(prepared.moves.map((move) => move.from.relative));
  const deletes = new Set(prepared.deletes.map((entry) => entry.path.relative));
  for (const move of prepared.moves) {
    if (entries.get(move.to.relative) === undefined) {
      continue;
    }
    if (
      moveSources.has(move.to.relative) ||
      deletes.has(move.to.relative) ||
      isCaseOnlyMove(move)
    ) {
      continue;
    }
    throw transactionError(
      `move target already exists without a matching move source or delete: ${move.to.relative}`
    );
  }
}

async function stagePreimages(
  state: TransactionState,
  prepared: PreparedPlan,
  entries: ReadonlyMap<string, Awaited<ReturnType<typeof inspectPath>>>
): Promise<void> {
  const paths = new Map<string, NormalizedPath>();
  for (const move of prepared.moves) {
    paths.set(move.from.relative, move.from);
  }
  for (const entry of prepared.deletes) {
    if (entries.get(entry.path.relative) !== undefined) {
      paths.set(entry.path.relative, entry.path);
    }
  }
  for (const write of prepared.writes) {
    const installedByMove = prepared.moves.some(
      (move) =>
        move.to.relative === write.path.relative ||
        isAncestorPath(move.to.relative, write.path.relative)
    );
    if (!installedByMove && entries.get(write.path.relative) !== undefined) {
      paths.set(write.path.relative, write.path);
    }
  }

  const orderedPaths = [...paths.values()].toSorted((left, right) =>
    compareStrings(left.relative, right.relative)
  );
  for (const [index, path] of orderedPaths.entries()) {
    const journalPath = nodePath.join(
      state.journalPath,
      "preimages",
      `${String(index).padStart(6, "0")}-${nodePath.basename(path.absolute)}`
    );
    await rename(path.absolute, journalPath);
    state.preimages.set(path.relative, { journalPath, path });
  }
}

async function applyMoves(
  state: TransactionState,
  moves: readonly NormalizedMove[],
  hooks: WorkspaceTransactionTestHooks | undefined,
  operations: readonly WorkspaceTransactionOperation[]
): Promise<void> {
  for (const move of moves) {
    await invokeApplyHook(hooks, operations, move.operation);
    await ensureSafeParent(state, move.to);
    const preimage = state.preimages.get(move.from.relative);
    if (preimage === undefined) {
      throw transactionError(`missing move preimage: ${move.from.relative}`);
    }
    const applied: AppliedMove = {
      currentPath: preimage.journalPath,
      move,
      preimage,
    };
    state.appliedMoves.push(applied);

    if (isCaseOnlyMove(move)) {
      const caseStagingDirectory = await mkdtemp(
        nodePath.join(
          nodePath.dirname(move.to.absolute),
          ".skillset-workspace-case-"
        )
      );
      const stagingPath = nodePath.join(
        caseStagingDirectory,
        nodePath.basename(move.to.absolute)
      );
      state.caseStagingDirectories.push(caseStagingDirectory);
      await rename(applied.currentPath, stagingPath);
      applied.currentPath = stagingPath;
      Object.assign(applied, { caseStagingDirectory });
    }
    await rename(applied.currentPath, move.to.absolute);
    applied.currentPath = move.to.absolute;
  }
}

async function applyWrites(
  state: TransactionState,
  writes: readonly NormalizedWrite[],
  hooks: WorkspaceTransactionTestHooks | undefined,
  operations: readonly WorkspaceTransactionOperation[]
): Promise<void> {
  for (const [index, write] of writes.entries()) {
    await invokeApplyHook(hooks, operations, write.operation);
    await ensureSafeParent(state, write.path);
    if (
      !state.preimages.has(write.path.relative) &&
      (await inspectPath(state.workspaceRoot, write.path)) !== undefined
    ) {
      const journalPath = nodePath.join(
        state.journalPath,
        "late-preimages",
        `${String(index).padStart(6, "0")}-${nodePath.basename(write.path.absolute)}`
      );
      await rename(write.path.absolute, journalPath);
      state.latePreimages.push({ journalPath, path: write.path });
    }
    const stagingPath = nodePath.join(
      state.journalPath,
      "writes",
      `${String(index).padStart(6, "0")}-${nodePath.basename(write.path.absolute)}`
    );
    await writeFile(stagingPath, write.content);
    const applied: AppliedWrite = {
      currentPath: stagingPath,
      stagingPath,
      write,
    };
    state.appliedWrites.push(applied);
    await rename(applied.currentPath, write.path.absolute);
    applied.currentPath = write.path.absolute;
  }
}

async function applyDeletes(
  deletes: readonly NormalizedDelete[],
  hooks: WorkspaceTransactionTestHooks | undefined,
  operations: readonly WorkspaceTransactionOperation[]
): Promise<void> {
  for (const entry of deletes) {
    await invokeApplyHook(hooks, operations, entry.operation);
  }
}

async function invokeApplyHook(
  hooks: WorkspaceTransactionTestHooks | undefined,
  operations: readonly WorkspaceTransactionOperation[],
  operation: WorkspaceTransactionOperation
): Promise<void> {
  const index = operations.indexOf(operation);
  await hooks?.beforeApply?.(operation, index);
}

async function ensureSafeParent(
  state: TransactionState,
  path: NormalizedPath
): Promise<void> {
  const parentRelative = nodePath.relative(
    state.workspaceRoot,
    nodePath.dirname(path.absolute)
  );
  if (parentRelative === "") {
    return;
  }
  let current = state.workspaceRoot;
  for (const segment of parentRelative.split(nodePath.sep)) {
    current = nodePath.join(current, segment);
    const entry = await lstat(current).catch((error: unknown) => {
      if (isMissing(error)) {
        return;
      }
      throw error;
    });
    if (entry === undefined) {
      await mkdir(current);
      state.createdDirectories.push(current);
      continue;
    }
    if (entry.isSymbolicLink() || !entry.isDirectory()) {
      throw transactionError(
        `refusing to traverse non-directory parent: ${nodePath.relative(state.workspaceRoot, current)}`
      );
    }
  }
}

async function cleanupCommittedTransaction(
  state: TransactionState
): Promise<void> {
  for (const path of [...state.caseStagingDirectories].toReversed()) {
    await removeEmptyDirectory(path);
  }
  await rm(state.journalPath, { force: true, recursive: true });
}

async function rollbackTransaction(
  state: TransactionState,
  hooks: WorkspaceTransactionTestHooks | undefined
): Promise<readonly string[]> {
  const failures: string[] = [];
  let rollbackIndex = 0;
  const run = async (
    action: WorkspaceTransactionRollbackAction,
    operation: () => Promise<void>
  ): Promise<void> => {
    try {
      await hooks?.beforeRollback?.(action, rollbackIndex);
      rollbackIndex += 1;
      await operation();
    } catch (error) {
      failures.push(`${action.kind} ${action.path}: ${errorMessage(error)}`);
    }
  };

  for (const write of [...state.appliedWrites].toReversed()) {
    if (write.currentPath === write.stagingPath) {
      continue;
    }
    await run(
      { kind: "restore-write", path: write.write.path.relative },
      async () => {
        await rename(write.currentPath, write.stagingPath);
        write.currentPath = write.stagingPath;
      }
    );
  }
  for (const preimage of [...state.latePreimages].toReversed()) {
    await run(
      { kind: "restore-preimage", path: preimage.path.relative },
      async () => {
        await ensureSafeParent(state, preimage.path);
        await rename(preimage.journalPath, preimage.path.absolute);
      }
    );
  }
  for (const move of [...state.appliedMoves].toReversed()) {
    if (move.currentPath === move.preimage.journalPath) {
      continue;
    }
    await run(
      { kind: "restore-move", path: move.move.from.relative },
      async () => {
        await rename(move.currentPath, move.preimage.journalPath);
        move.currentPath = move.preimage.journalPath;
      }
    );
  }
  for (const preimage of [...state.preimages.values()].toReversed()) {
    await run(
      { kind: "restore-preimage", path: preimage.path.relative },
      async () => {
        await ensureSafeParent(state, preimage.path);
        await rename(preimage.journalPath, preimage.path.absolute);
      }
    );
  }
  for (const directory of [...state.createdDirectories].toReversed()) {
    await run(
      {
        kind: "remove-created-directory",
        path: nodePath.relative(state.workspaceRoot, directory),
      },
      async () => {
        await removeEmptyDirectory(directory);
      }
    );
  }
  for (const directory of [...state.caseStagingDirectories].toReversed()) {
    await run(
      {
        kind: "remove-created-directory",
        path: nodePath.relative(state.workspaceRoot, directory),
      },
      async () => {
        await removeEmptyDirectory(directory);
      }
    );
  }
  await run(
    {
      kind: "remove-created-directory",
      path: nodePath.relative(state.workspaceRoot, state.journalPath),
    },
    async () => {
      await rm(state.journalPath, { force: true, recursive: true });
    }
  );
  return failures;
}

async function removeEmptyDirectory(path: string): Promise<void> {
  try {
    await rmdir(path);
  } catch (error) {
    if (isMissing(error)) {
      return;
    }
    throw error;
  }
}

async function resolveWorkspaceRoot(workspaceRoot: string): Promise<string> {
  const resolved = await realpath(workspaceRoot);
  const entry = await lstat(resolved);
  if (entry.isSymbolicLink() || !entry.isDirectory()) {
    throw transactionError(
      `workspace root is not a directory: ${workspaceRoot}`
    );
  }
  return resolved;
}

function normalizePath(
  workspaceRoot: string,
  candidate: string
): NormalizedPath {
  const absolute = nodePath.resolve(workspaceRoot, candidate);
  const relativePath = nodePath.relative(workspaceRoot, absolute);
  if (relativePath === "" || !isContainedRelativePath(relativePath)) {
    throw transactionError(`path escapes workspace root: ${candidate}`);
  }
  return { absolute, relative: relativePath };
}

async function inspectPath(workspaceRoot: string, path: NormalizedPath) {
  let current = workspaceRoot;
  for (const segment of path.relative.split(nodePath.sep)) {
    current = nodePath.join(current, segment);
    const entry = await lstat(current).catch((error: unknown) => {
      if (isMissing(error)) {
        return;
      }
      throw error;
    });
    if (entry === undefined) {
      return;
    }
    if (entry.isSymbolicLink()) {
      throw transactionError(
        `refusing to traverse symbolic link: ${nodePath.relative(workspaceRoot, current)}`
      );
    }
    if (current !== path.absolute && !entry.isDirectory()) {
      throw transactionError(
        `refusing to traverse non-directory path: ${nodePath.relative(workspaceRoot, current)}`
      );
    }
    if (current === path.absolute) {
      return entry;
    }
  }
}

function assertMovableEntry(
  entry: NonNullable<Awaited<ReturnType<typeof inspectPath>>>,
  path: string
): void {
  if (!entry.isFile() && !entry.isDirectory()) {
    throw transactionError(`path is not a regular file or directory: ${path}`);
  }
}

function isCaseOnlyMove(move: NormalizedMove): boolean {
  return (
    move.from.relative !== move.to.relative &&
    sameCaseInsensitivePath(move.from.relative, move.to.relative)
  );
}

function sameCaseInsensitivePath(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function isAncestorPath(parent: string, child: string): boolean {
  return child.startsWith(`${parent}${nodePath.sep}`);
}

function isWriteUnderMoveTarget(
  left: { readonly path: string; readonly role: string },
  right: { readonly path: string; readonly role: string }
): boolean {
  return (
    (left.role === "move-target" &&
      right.role === "write" &&
      isAncestorPath(left.path, right.path)) ||
    (right.role === "move-target" &&
      left.role === "write" &&
      isAncestorPath(right.path, left.path))
  );
}

function isContainedRelativePath(relativePath: string): boolean {
  return (
    relativePath !== ".." &&
    !relativePath.startsWith(`..${nodePath.sep}`) &&
    !nodePath.isAbsolute(relativePath)
  );
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
