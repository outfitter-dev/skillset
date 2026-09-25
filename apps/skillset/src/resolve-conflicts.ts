/**
 * Git conflict inventory for `skillset resolve` (SET-600).
 *
 * Everything here runs through `git -C <root>` with {@link gitSafeEnv}, so it
 * works inside a linked worktree and under a hook that exported `GIT_DIR`.
 */

import {
  chmod,
  lstat,
  mkdir,
  readFile,
  readlink,
  realpath,
  rm,
  rmdir,
  symlink,
  writeFile,
} from "node:fs/promises";
import { dirname, join, posix, relative, resolve, sep } from "node:path";

import {
  lockDisagreementPaths,
  parseGeneratedLock,
  WORKSPACE_LOCK_FILE,
  type GeneratedFileSnapshot,
} from "@skillset/core";
import {
  normalizeGeneratedFileMode,
  supportsGeneratedFileModes,
} from "@skillset/core/internal/generated-file-mode";
import { compareStrings, isPathInside, isRelativePathInside } from "@skillset/core/internal/path";

import { gitSafeEnv } from "./git-env";

/** Conflict stages git records for an unmerged path: 2 is ours, 3 is theirs. */
const CONFLICT_STAGES = [2, 3] as const;

type ConflictStage = (typeof CONFLICT_STAGES)[number];

export interface ConflictInventory {
  /** Conflicted paths that are not generated output; a human owns these. */
  readonly authored: readonly string[];
  /** Conflicted paths that a `skillset.lock` claims as generated output. */
  readonly generated: readonly string[];
  /**
   * Conflicted generated paths whose committed bytes disagreed with their own
   * side's lock. Regenerating these would discard a hand edit, so they are a
   * human's call rather than a repair's.
   */
  readonly handEdited: readonly string[];
  /** Every managed generated path the locks claim, conflicted or not. */
  readonly managedPaths: ReadonlySet<string>;
  /** Git side whose lock and payload bytes must be materialized together. */
  readonly materializationStages: ReadonlyMap<string, ConflictStage>;
}

interface GitResult {
  readonly exitCode: number;
  readonly ok: boolean;
  readonly stderr: string;
  readonly stdout: string;
}

interface GitBlobEntry {
  readonly mode: number;
  readonly oid: string;
}

export type WorktreePathSnapshot =
  | {
      readonly kind: "file";
      readonly content: Uint8Array;
      readonly mode: number;
      readonly path: string;
    }
  | {
      readonly kind: "missing";
      /** Parent directories that were also absent before the repair. */
      readonly missingParents: readonly string[];
      readonly path: string;
    }
  | {
      readonly kind: "symlink";
      readonly path: string;
      readonly target: string;
    };

async function git(
  rootPath: string,
  args: readonly string[]
): Promise<GitResult> {
  const proc = Bun.spawn({
    cmd: ["git", "-C", rootPath, ...args],
    env: gitSafeEnv(),
    stderr: "pipe",
    stdout: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { exitCode, ok: exitCode === 0, stderr, stdout };
}

function requireGit(result: GitResult, operation: string): string {
  if (!result.ok) {
    throw new Error(`skillset: resolve could not ${operation}`);
  }
  return result.stdout;
}

function splitLines(value: string): readonly string[] {
  return value.split("\n").filter((line) => line.length > 0);
}

function splitNul(value: string): readonly string[] {
  return value.split("\0").filter((entry) => entry.length > 0);
}

/** True when `rootPath` is inside a git repository at all. */
export async function isGitRepository(rootPath: string): Promise<boolean> {
  return (await git(rootPath, ["rev-parse", "--git-dir"])).ok;
}

/**
 * Conflicted paths, rewritten relative to `rootPath`. Git reports them relative
 * to the repository top level, which is not the Skillset root when a workspace
 * lives in a subdirectory.
 */
export async function readConflictedPaths(
  rootPath: string
): Promise<readonly string[]> {
  const top = await git(rootPath, ["rev-parse", "--show-toplevel"]);
  const topLevel = requireGit(top, "locate the repository root").trim();
  const listed = await git(rootPath, [
    "diff",
    "--name-only",
    "-z",
    "--diff-filter=U",
  ]);
  const conflicted = requireGit(listed, "read conflicted paths");
  return [
    ...new Set(
      splitNul(conflicted).map((path) =>
        relative(rootPath, join(topLevel, path)).replaceAll("\\", "/")
      )
    ),
  ]
    .filter((path) => isRelativePathInside(path, { allowEqual: true, path: posix }))
    .sort(compareStrings);
}

/**
 * Unstaged or untracked compiler inputs below the Skillset root, excluding
 * known conflicts. A resolve build may consume staged conflict resolutions,
 * but it must not fold worktree-only source into generated output it stages.
 * Unrelated notes and receipts are deliberately outside this gate.
 */
export async function readUnstagedProjectionPaths(
  rootPath: string,
  ignoredPaths: ReadonlySet<string>,
  sourceRoot = ".skillset",
  externalInputPaths: readonly string[] = []
): Promise<readonly string[]> {
  const top = await git(rootPath, ["rev-parse", "--show-toplevel"]);
  if (!top.ok) {
    throw new Error("skillset: resolve could not locate the repository root");
  }
  const [unstaged, untracked] = await Promise.all([
    git(rootPath, ["diff", "--name-only", "-z", "--"]),
    git(rootPath, ["ls-files", "--others", "--exclude-standard", "-z", "--"]),
  ]);
  if (!unstaged.ok || !untracked.ok) {
    throw new Error("skillset: resolve could not inspect worktree-only paths");
  }
  const topLevel = top.stdout.trim();
  const normalizedSourceRoot = relative(
    rootPath,
    resolve(rootPath, sourceRoot)
  ).replaceAll("\\", "/");
  if (!isRelativePathInside(normalizedSourceRoot, { allowEqual: true, path: posix })) {
    throw new Error(
      "skillset: resolve source root must be inside the workspace"
    );
  }
  const externalRoots = externalInputPaths.map((path) =>
    relative(rootPath, resolve(path)).replaceAll("\\", "/")
  );
  return [
    ...new Set(
      [...splitNul(unstaged.stdout), ...splitNul(untracked.stdout)].map(
        (path) => relative(rootPath, join(topLevel, path)).replaceAll("\\", "/")
      )
    ),
  ]
    .filter(
      (path) =>
        isRelativePathInside(path, { allowEqual: true, path: posix }) &&
        !ignoredPaths.has(path) &&
        (path === "skillset.yaml" ||
          normalizedSourceRoot.length === 0 ||
          path === normalizedSourceRoot ||
          path.startsWith(`${normalizedSourceRoot}/`) ||
          externalRoots.some(
            (root) => path === root || path.startsWith(`${root}/`)
          ))
    )
    .sort(compareStrings);
}

export function isLockPath(path: string): boolean {
  return (
    path === WORKSPACE_LOCK_FILE || path.endsWith(`/${WORKSPACE_LOCK_FILE}`)
  );
}

function lockOutputRoot(lockPath: string): string {
  return lockPath === WORKSPACE_LOCK_FILE ? "" : dirname(lockPath);
}

/** Every `skillset.lock` git tracks, including ones deleted from the worktree. */
async function trackedLockPaths(rootPath: string): Promise<readonly string[]> {
  const listed = await git(rootPath, [
    "ls-files",
    WORKSPACE_LOCK_FILE,
    `*/${WORKSPACE_LOCK_FILE}`,
  ]);
  return splitLines(requireGit(listed, "read tracked generated locks"))
    .filter(isLockPath)
    .sort(compareStrings);
}

/**
 * Restore every conflicted lock to a parseable state. A lock carrying conflict
 * markers will not parse, and the managed-path inventory that decides what is
 * generated is read out of the locks — so this has to happen before anything
 * else can be classified.
 */
export async function materializeConflictedPaths(
  rootPath: string,
  paths: readonly string[],
  preferredStages: ReadonlyMap<string, ConflictStage> = new Map()
): Promise<readonly string[]> {
  const restored: string[] = [];
  const entries = await readIndexEntries(rootPath, paths);
  for (const path of paths) {
    const absolute = await safeWorktreePath(rootPath, path);
    const snapshot = await readConflictSnapshot(
      rootPath,
      path,
      entries,
      preferredStages.get(path)
    );
    if (snapshot === undefined) {
      // No side kept the file, so the repair decides whether source still
      // produces it.
      await rm(absolute, { force: true });
      restored.push(path);
      continue;
    }
    // Never follow a worktree symlink while materializing a Git blob. The
    // generated path itself is replaced; its target is outside this operation.
    await rm(absolute, { force: true, recursive: true });
    await mkdir(dirname(absolute), { recursive: true });
    await writeFile(absolute, snapshot.content);
    if (supportsGeneratedFileModes()) await chmod(absolute, snapshot.mode);
    restored.push(path);
  }
  return restored;
}

/** Capture exact worktree state before conflict materialization mutates it. */
export async function snapshotWorktreePaths(
  rootPath: string,
  paths: readonly string[]
): Promise<readonly WorktreePathSnapshot[]> {
  return Promise.all(
    paths.map(async (path): Promise<WorktreePathSnapshot> => {
      const absolute = await safeWorktreePath(rootPath, path);
      const info = await lstat(absolute).catch((error: unknown) => {
        if (isMissingPathError(error)) return undefined;
        throw error;
      });
      if (info === undefined) {
        return {
          kind: "missing",
          missingParents: await missingParentPaths(rootPath, path),
          path,
        };
      }
      if (info.isSymbolicLink()) {
        return { kind: "symlink", path, target: await readlink(absolute) };
      }
      if (!info.isFile()) {
        throw new Error(
          `skillset: resolve refuses to replace non-file path ${path}`
        );
      }
      return {
        content: await readFile(absolute),
        kind: "file",
        mode: info.mode & 0o7777,
        path,
      };
    })
  );
}

/** Restore worktree state after a materialized repair is refused or throws. */
export async function restoreWorktreePaths(
  rootPath: string,
  snapshots: readonly WorktreePathSnapshot[]
): Promise<void> {
  for (const snapshot of snapshots) {
    const absolute = await safeWorktreePath(rootPath, snapshot.path);
    await rm(absolute, { force: true, recursive: true });
    if (snapshot.kind === "missing") {
      for (const parent of snapshot.missingParents) {
        await removeEmptyDirectory(await safeWorktreePath(rootPath, parent));
      }
      continue;
    }
    await mkdir(dirname(absolute), { recursive: true });
    if (snapshot.kind === "symlink") {
      await symlink(snapshot.target, absolute);
      continue;
    }
    await writeFile(absolute, snapshot.content);
    if (supportsGeneratedFileModes()) await chmod(absolute, snapshot.mode);
  }
}

async function missingParentPaths(
  rootPath: string,
  candidatePath: string
): Promise<readonly string[]> {
  const root = await realpath(rootPath);
  const absolute = await safeWorktreePath(root, candidatePath);
  const missing: string[] = [];
  let cursor = dirname(absolute);
  while (cursor !== root) {
    const info = await lstat(cursor).catch((error: unknown) => {
      if (isMissingPathError(error)) return undefined;
      throw error;
    });
    if (info !== undefined) break;
    missing.push(relative(root, cursor));
    cursor = dirname(cursor);
  }
  return missing;
}

async function removeEmptyDirectory(path: string): Promise<void> {
  await rmdir(path).catch((error: unknown) => {
    if (isMissingPathError(error) || isNonEmptyDirectoryError(error)) return;
    throw error;
  });
}

async function safeWorktreePath(
  rootPath: string,
  candidatePath: string
): Promise<string> {
  const root = await realpath(rootPath);
  const absolute = resolve(root, candidatePath);
  const relativePath = relative(root, absolute);
  if (!isPathInside(root, absolute)) {
    throw new Error(
      `skillset: resolve refuses path outside the workspace: ${candidatePath}`
    );
  }

  const parent = dirname(relativePath);
  if (parent === ".") return absolute;
  let cursor = root;
  for (const segment of parent.split(sep)) {
    cursor = join(cursor, segment);
    const info = await lstat(cursor).catch((error: unknown) => {
      if (isMissingPathError(error)) return undefined;
      throw error;
    });
    if (info === undefined) break;
    if (info.isSymbolicLink()) {
      throw new Error(
        `skillset: resolve refuses path through symlinked parent: ${candidatePath}`
      );
    }
    if (!info.isDirectory()) {
      throw new Error(
        `skillset: resolve refuses path through non-directory parent: ${candidatePath}`
      );
    }
  }
  return absolute;
}

function isMissingPathError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

function isNonEmptyDirectoryError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error.code === "ENOTEMPTY" || error.code === "EEXIST")
  );
}

/**
 * One whole conflict-side snapshot, including the executable bit Git recorded.
 * A preferred side never falls through to the other side: mixing a lock from
 * one tree with payload bytes from the other invalidates the repair baseline.
 */
async function readConflictSnapshot(
  rootPath: string,
  path: string,
  entries: ReadonlyMap<string, ReadonlyMap<number, GitBlobEntry>>,
  preferredStage?: ConflictStage
): Promise<GeneratedFileSnapshot | undefined> {
  const stages =
    preferredStage === undefined ? CONFLICT_STAGES : [preferredStage];
  for (const stage of stages) {
    const entry = entries.get(path)?.get(stage);
    if (entry === undefined) continue;
    return {
      content: await readGitBlob(
        rootPath,
        entry.oid,
        `${path} at stage ${stage}`
      ),
      mode: normalizeGeneratedFileMode(entry.mode),
    };
  }
  return preferredStage === undefined
    ? readTreeSnapshot(rootPath, "HEAD", path)
    : undefined;
}

/**
 * Blob identity and mode recorded per index stage. Stage 0 is a merged entry;
 * 2 and 3 are the two sides of a conflict.
 */
async function readIndexEntries(
  rootPath: string,
  paths: readonly string[]
): Promise<ReadonlyMap<string, ReadonlyMap<number, GitBlobEntry>>> {
  const entries = new Map<string, Map<number, GitBlobEntry>>();
  if (paths.length === 0) return entries;
  const listed = await git(rootPath, ["ls-files", "-s", "-z", "--", ...paths]);
  const records = requireGit(listed, "read conflict index entries");
  // `<mode> <sha> <stage>\t<path>` per NUL-terminated record.
  for (const record of splitNul(records)) {
    const [meta, path] = record.split("\t");
    const [rawMode, oid, rawStage] = meta?.split(" ") ?? [];
    if (
      path === undefined ||
      rawMode === undefined ||
      oid === undefined ||
      rawStage === undefined
    ) {
      throw new Error(
        "skillset: resolve received a malformed conflict index entry"
      );
    }
    const mode = readGeneratedGitMode(rawMode, path);
    const stage = Number(rawStage);
    if (!Number.isInteger(stage) || stage < 0 || stage > 3) {
      throw new Error(
        `skillset: resolve received an invalid index stage for ${path}`
      );
    }
    const byStage = entries.get(path) ?? new Map<number, GitBlobEntry>();
    byStage.set(stage, { mode, oid });
    entries.set(path, byStage);
  }
  return entries;
}

function readGeneratedGitMode(rawMode: string, path: string): number {
  if (rawMode !== "100644" && rawMode !== "100755") {
    throw new Error(
      `skillset: resolve refuses unsupported Git mode ${rawMode} for ${path}`
    );
  }
  return Number.parseInt(rawMode, 8);
}

/**
 * Every managed path sharing a lock item with one of `paths`.
 *
 * `outputHash` is recorded per item — a group of files — so an item can only be
 * verified when every member is present. A plugin skill's item is
 * `[LICENSE.txt, SKILL.md]` and the LICENSE rarely changes, so without its
 * unconflicted sibling the conflicted SKILL.md would be silently unverifiable.
 */
async function expandToLockItems(
  rootPath: string,
  paths: readonly string[],
  lockPaths: readonly string[],
  conflictedLocks: ReadonlySet<string>
): Promise<readonly string[]> {
  const wanted = new Set(paths);
  const expanded = new Set(paths);
  for (const lockPath of lockPaths) {
    const root = lockOutputRoot(lockPath);
    for (const lockJson of await lockJsonCandidates(
      rootPath,
      lockPath,
      conflictedLocks.has(lockPath)
    )) {
      const parsed = parseGeneratedLock(lockJson, lockPath);
      for (const item of parsed.items) {
        const group = item.files.map((file_) =>
          root === "" ? file_ : `${root}/${file_}`
        );
        if (!group.some((path) => wanted.has(path))) continue;
        for (const path of group) expanded.add(path);
      }
    }
  }
  return [...expanded].sort(compareStrings);
}

async function lockJsonCandidates(
  rootPath: string,
  lockPath: string,
  conflicted: boolean
): Promise<readonly unknown[]> {
  const candidates: unknown[] = [];
  if (!conflicted) {
    const indexed = await readStageJson(rootPath, 0, lockPath);
    if (indexed !== undefined) candidates.push(indexed);
  }
  for (const stage of CONFLICT_STAGES) {
    const staged = await readStageJson(rootPath, stage, lockPath);
    if (staged !== undefined) candidates.push(staged);
  }
  return candidates;
}

async function readGitBlob(
  rootPath: string,
  oid: string,
  label: string
): Promise<Uint8Array> {
  const proc = Bun.spawn({
    cmd: ["git", "-C", rootPath, "cat-file", "blob", oid],
    env: gitSafeEnv(),
    stderr: "pipe",
    stdout: "pipe",
  });
  const [bytes, , exitCode] = await Promise.all([
    new Response(proc.stdout).bytes(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (exitCode !== 0) {
    throw new Error(`skillset: resolve could not read Git blob for ${label}`);
  }
  return bytes;
}

async function readTreeSnapshot(
  rootPath: string,
  revision: string,
  path: string
): Promise<GeneratedFileSnapshot | undefined> {
  const listed = await git(rootPath, [
    "ls-tree",
    "-z",
    revision,
    "--",
    `./${path}`,
  ]);
  const output = requireGit(listed, `read ${path} from ${revision}`);
  if (output.length === 0) return undefined;
  const records = splitNul(output);
  if (records.length !== 1) {
    throw new Error(
      `skillset: resolve received ambiguous tree data for ${path}`
    );
  }
  const [metadata, listedPath] = records[0]?.split("\t") ?? [];
  const [rawMode, type, oid] = metadata?.split(" ") ?? [];
  if (
    listedPath === undefined ||
    rawMode === undefined ||
    type !== "blob" ||
    oid === undefined
  ) {
    throw new Error(
      `skillset: resolve received malformed tree data for ${path}`
    );
  }
  const mode = readGeneratedGitMode(rawMode, path);
  return {
    content: await readGitBlob(rootPath, oid, `${path} at ${revision}`),
    mode: normalizeGeneratedFileMode(mode),
  };
}

async function otherConflictRevision(
  rootPath: string
): Promise<string | undefined> {
  for (const revision of [
    "REBASE_HEAD",
    "MERGE_HEAD",
    "CHERRY_PICK_HEAD",
  ] as const) {
    const resolved = await git(rootPath, [
      "rev-parse",
      "--verify",
      "--quiet",
      revision,
    ]);
    if (resolved.ok) return revision;
    if (resolved.exitCode !== 1) {
      throw new Error(`skillset: resolve could not inspect ${revision}`);
    }
  }
  return undefined;
}

/**
 * Conflicted generated paths that carried a hand edit on either side.
 *
 * A conflicted path on disk represents neither side, so the verdict table has
 * no baseline to work from. Instead each side is checked against its own
 * conflict-stage lock, or the shared stage-0 lock when the lock itself did not
 * conflict. A committed tree whose generated output disagrees with the
 * `outputHash` that tree records was edited after it was generated. Both
 * payload stages are checked because a rebase discards stage 3 ("theirs", the
 * commit being replayed), and an edit there is exactly as lost as one on stage
 * 2.
 */
async function readHandEditedPaths(
  rootPath: string,
  generatedPaths: readonly string[],
  lockPaths: readonly string[]
): Promise<readonly string[]> {
  const conflicted = new Set(
    generatedPaths.filter((path) => !isLockPath(path))
  );
  if (conflicted.size === 0) return [];
  const payloadPaths = await expandToLockItems(
    rootPath,
    [...conflicted],
    lockPaths,
    new Set(generatedPaths.filter(isLockPath))
  );
  const entries = await readIndexEntries(rootPath, payloadPaths);
  const handEdited = new Set<string>();
  const otherRevision = await otherConflictRevision(rootPath);

  for (const stage of CONFLICT_STAGES) {
    const snapshots = new Map<string, GeneratedFileSnapshot>();
    for (const path of payloadPaths) {
      const siblingRevision = stage === 2 ? "HEAD" : otherRevision;
      const snapshot = conflicted.has(path)
        ? await readConflictSnapshot(rootPath, path, entries, stage)
        : siblingRevision === undefined
          ? undefined
          : await readTreeSnapshot(rootPath, siblingRevision, path);
      if (snapshot !== undefined) snapshots.set(path, snapshot);
    }
    if (snapshots.size === 0) continue;
    for (const lockPath of lockPaths) {
      const sideLockJson = await readStageJson(rootPath, stage, lockPath);
      const lockJson = sideLockJson === undefined
        ? await readStageJson(rootPath, 0, lockPath)
        : sideLockJson;
      if (lockJson === undefined) continue;
      const scoped = scopeSnapshotsToRoot(snapshots, lockOutputRoot(lockPath));
      if (scoped.size === 0) continue;
      for (const path of lockDisagreementPaths(
        lockJson,
        lockOutputRoot(lockPath),
        scoped,
        lockPath
      )) {
        // Siblings are pulled in so the item hash can be computed at all; only
        // a conflicted path is this command's to report or resolve.
        if (conflicted.has(path)) handEdited.add(path);
      }
    }
  }
  return [...handEdited].sort(compareStrings);
}

/** Only the snapshots a given lock is responsible for. */
function scopeSnapshotsToRoot(
  snapshots: ReadonlyMap<string, GeneratedFileSnapshot>,
  outputRoot: string
): ReadonlyMap<string, GeneratedFileSnapshot> {
  const scoped = new Map<string, GeneratedFileSnapshot>();
  for (const [path, snapshot] of snapshots) {
    if (outputRoot === "" || path.startsWith(`${outputRoot}/`)) {
      scoped.set(path, snapshot);
    }
  }
  return scoped;
}

/** A lock's parsed content at one conflict stage, when that side has it. */
async function readStageJson(
  rootPath: string,
  stage: number,
  path: string
): Promise<unknown> {
  const entry = (await readIndexEntries(rootPath, [path]))
    .get(path)
    ?.get(stage);
  if (entry === undefined) return undefined;
  const bytes = await readGitBlob(
    rootPath,
    entry.oid,
    `${path} at stage ${stage}`
  );
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch (error) {
    throw new Error(
      `skillset: resolve could not parse ${path} at index stage ${stage}`,
      { cause: error }
    );
  }
}

/** Read every managed output path out of trusted stage-0 lock blobs. */
export async function readManagedPathsFromLocks(
  rootPath: string,
  lockPaths: readonly string[]
): Promise<ReadonlySet<string>> {
  const managed = new Set<string>();
  for (const lockPath of lockPaths) {
    managed.add(lockPath);
    const lockJson = await readStageJson(rootPath, 0, lockPath);
    if (lockJson === undefined) continue;
    collectManagedPaths(lockJson, lockPath, managed);
  }
  return managed;
}

/**
 * Managed paths claimed by **either** side of the conflict.
 *
 * Worktree bytes are mutable and may be marker soup, so they are never trusted
 * as provenance. Stage 0 is authoritative for merged or unconflicted locks;
 * stages 2 and 3 are authoritative for the two conflict sides. If either side
 * claims an output, resolve must not misclassify it as authored and ask a human
 * to hand-merge generated output.
 */
async function readManagedPathsAcrossStages(
  rootPath: string,
  lockPaths: readonly string[]
): Promise<ReadonlySet<string>> {
  const managed = new Set(await readManagedPathsFromLocks(rootPath, lockPaths));
  for (const stage of CONFLICT_STAGES) {
    for (const lockPath of lockPaths) {
      const lockJson = await readStageJson(rootPath, stage, lockPath);
      if (lockJson === undefined) continue;
      collectManagedPaths(lockJson, lockPath, managed);
    }
  }
  return managed;
}

/** Add every output path one valid lock claims. */
function collectManagedPaths(
  lockJson: unknown,
  lockPath: string,
  into: Set<string>
): void {
  if (lockJson === undefined) return;
  into.add(lockPath);
  const parsed = parseGeneratedLock(lockJson, lockPath);
  const root = lockOutputRoot(lockPath);
  const qualify = (path: string): string =>
    root === "" ? path : `${root}/${path}`;
  for (const item of parsed.items) {
    for (const relativeFile of item.files) into.add(qualify(relativeFile));
    if (item.outputPath !== undefined) into.add(qualify(item.outputPath));
  }
}

/**
 * Choose one side per conflicted lock and route every path either side claims
 * to that same side. The repair needs the broader ownership inventory, but its
 * temporary lock and payload baseline must still describe one coherent tree.
 */
async function preferredMaterializationStages(
  rootPath: string,
  conflictedLocks: readonly string[]
): Promise<ReadonlyMap<string, ConflictStage>> {
  const preferred = new Map<string, ConflictStage>();
  for (const lockPath of conflictedLocks) {
    let best:
      | {
          readonly claims: number;
          readonly stage: ConflictStage;
        }
      | undefined;
    const claimedAcrossSides = new Set<string>();
    for (const stage of CONFLICT_STAGES) {
      const lockJson = await readStageJson(rootPath, stage, lockPath);
      if (lockJson === undefined) continue;
      const claimed = new Set<string>();
      collectManagedPaths(lockJson, lockPath, claimed);
      for (const path of claimed) claimedAcrossSides.add(path);
      if (best === undefined || claimed.size > best.claims) {
        best = { claims: claimed.size, stage };
      }
    }
    if (best === undefined) continue;
    preferred.set(lockPath, best.stage);
    for (const path of claimedAcrossSides) {
      if (!preferred.has(path)) preferred.set(path, best.stage);
    }
  }
  return preferred;
}

/**
 * Partition the conflicted set without changing the worktree. Conflict-stage
 * locks provide the ownership inventory until `--yes` authorizes a write.
 */
export async function inventoryConflicts(
  rootPath: string,
  conflicted: readonly string[]
): Promise<ConflictInventory> {
  const conflictedLocks = conflicted.filter(isLockPath);
  const lockPaths = [
    ...new Set([...(await trackedLockPaths(rootPath)), ...conflictedLocks]),
  ].sort(compareStrings);
  const managedPaths = await readManagedPathsAcrossStages(rootPath, lockPaths);
  const generated = conflicted.filter(
    (path) => managedPaths.has(path) || isLockPath(path)
  );
  const generatedSet = new Set(generated);
  const materializationStages = await preferredMaterializationStages(
    rootPath,
    conflictedLocks
  );
  return {
    authored: conflicted.filter((path) => !generatedSet.has(path)),
    generated,
    handEdited: await readHandEditedPaths(rootPath, generated, lockPaths),
    managedPaths,
    materializationStages,
  };
}

/** Stage resolved paths. Callers pass only paths confirmed generated. */
export async function stagePaths(
  rootPath: string,
  paths: readonly string[]
): Promise<boolean> {
  if (paths.length === 0) return true;
  return (await git(rootPath, ["add", "--", ...paths])).ok;
}
