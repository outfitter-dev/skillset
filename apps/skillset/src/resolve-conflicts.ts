/**
 * Git conflict inventory for `skillset resolve` (SET-600).
 *
 * Everything here runs through `git -C <root>` with {@link gitSafeEnv}, so it
 * works inside a linked worktree and under a hook that exported `GIT_DIR`.
 */

import { chmod, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";

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
import { compareStrings } from "@skillset/core/internal/path";

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
  readonly ok: boolean;
  readonly stdout: string;
}

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
  const [stdout, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    proc.exited,
  ]);
  return { ok: exitCode === 0, stdout };
}

function splitLines(value: string): readonly string[] {
  return value.split("\n").filter((line) => line.length > 0);
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
  if (!top.ok) return [];
  const topLevel = top.stdout.trim();
  const listed = await git(rootPath, [
    "diff",
    "--name-only",
    "--diff-filter=U",
  ]);
  if (!listed.ok) return [];
  return [
    ...new Set(
      splitLines(listed.stdout).map((path) =>
        relative(rootPath, join(topLevel, path)).replaceAll("\\", "/")
      )
    ),
  ]
    .filter((path) => !path.startsWith(".."))
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
  if (!listed.ok) return [];
  return splitLines(listed.stdout).filter(isLockPath).sort(compareStrings);
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
  const modes = await readIndexModes(rootPath, paths);
  for (const path of paths) {
    const absolute = join(rootPath, path);
    const snapshot = await readConflictSnapshot(
      rootPath,
      path,
      modes,
      preferredStages.get(path)
    );
    if (snapshot === undefined) {
      // No side kept the file, so the repair decides whether source still
      // produces it.
      await rm(absolute, { force: true });
      restored.push(path);
      continue;
    }
    await mkdir(dirname(absolute), { recursive: true });
    await writeFile(absolute, snapshot.content);
    if (supportsGeneratedFileModes()) await chmod(absolute, snapshot.mode);
    restored.push(path);
  }
  return restored;
}

/**
 * One whole conflict-side snapshot, including the executable bit Git recorded.
 * A preferred side never falls through to the other side: mixing a lock from
 * one tree with payload bytes from the other invalidates the repair baseline.
 */
async function readConflictSnapshot(
  rootPath: string,
  path: string,
  modes: ReadonlyMap<string, ReadonlyMap<number, number>>,
  preferredStage?: ConflictStage
): Promise<GeneratedFileSnapshot | undefined> {
  const stages =
    preferredStage === undefined ? CONFLICT_STAGES : [preferredStage];
  for (const stage of stages) {
    const content = await readStageBlob(rootPath, stage, path);
    if (content === undefined) continue;
    return {
      content,
      mode: normalizeGeneratedFileMode(modes.get(path)?.get(stage) ?? 0o644),
    };
  }
  return preferredStage === undefined
    ? readTreeSnapshot(rootPath, "HEAD", path)
    : undefined;
}

/**
 * Modes git recorded per index stage, keyed by path then stage. Stage 0 is a
 * merged entry; 2 and 3 are the two sides of a conflict.
 */
async function readIndexModes(
  rootPath: string,
  paths: readonly string[]
): Promise<ReadonlyMap<string, ReadonlyMap<number, number>>> {
  const modes = new Map<string, Map<number, number>>();
  if (paths.length === 0) return modes;
  const listed = await git(rootPath, ["ls-files", "-s", "-z", "--", ...paths]);
  if (!listed.ok) return modes;
  // `<mode> <sha> <stage>\t<path>` per NUL-terminated record.
  for (const record of listed.stdout.split("\0")) {
    const [meta, path] = record.split("\t");
    if (meta === undefined || path === undefined) continue;
    const [mode, , stage] = meta.split(" ");
    const entry = modes.get(path) ?? new Map<number, number>();
    entry.set(Number(stage), Number.parseInt(mode ?? "100644", 8));
    modes.set(path, entry);
  }
  return modes;
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
  lockPaths: readonly string[]
): Promise<readonly string[]> {
  const wanted = new Set(paths);
  const expanded = new Set(paths);
  for (const lockPath of lockPaths) {
    const root = lockOutputRoot(lockPath);
    for (const lockJson of await lockJsonCandidates(rootPath, lockPath)) {
      let parsed: ReturnType<typeof parseGeneratedLock>;
      try {
        parsed = parseGeneratedLock(lockJson, lockPath);
      } catch {
        continue;
      }
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
  lockPath: string
): Promise<readonly unknown[]> {
  const candidates: unknown[] = [];
  const working = await readJsonSafely(Bun.file(join(rootPath, lockPath)));
  if (working !== undefined) candidates.push(working);
  for (const stage of CONFLICT_STAGES) {
    const staged = await readStageJson(rootPath, stage, lockPath);
    if (staged !== undefined) candidates.push(staged);
  }
  return candidates;
}

/** Bytes at one conflict stage, or undefined when that side lacks the path. */
async function readStageBlob(
  rootPath: string,
  stage: number,
  path: string
): Promise<Uint8Array | undefined> {
  const proc = Bun.spawn({
    // `./` makes the index lookup relative to the selected Skillset root.
    // Without it Git interprets the path from the repository top level, which
    // breaks workspaces nested below that root.
    cmd: ["git", "-C", rootPath, "show", `:${stage}:./${path}`],
    env: gitSafeEnv(),
    stderr: "ignore",
    stdout: "pipe",
  });
  const [bytes, exitCode] = await Promise.all([
    new Response(proc.stdout).bytes(),
    proc.exited,
  ]);
  return exitCode === 0 ? bytes : undefined;
}

async function readRevisionBlob(
  rootPath: string,
  revision: string,
  path: string
): Promise<Uint8Array | undefined> {
  const proc = Bun.spawn({
    cmd: ["git", "-C", rootPath, "show", `${revision}:./${path}`],
    env: gitSafeEnv(),
    stderr: "ignore",
    stdout: "pipe",
  });
  const [bytes, exitCode] = await Promise.all([
    new Response(proc.stdout).bytes(),
    proc.exited,
  ]);
  return exitCode === 0 ? bytes : undefined;
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
  if (!listed.ok || listed.stdout.length === 0) return undefined;
  const [metadata] = listed.stdout.split("\t");
  const [mode] = metadata?.split(" ") ?? [];
  if (mode === undefined || mode.length === 0) return undefined;
  const content = await readRevisionBlob(rootPath, revision, path);
  if (content === undefined) return undefined;
  return {
    content,
    mode: normalizeGeneratedFileMode(Number.parseInt(mode, 8)),
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
  }
  return undefined;
}

/**
 * Conflicted generated paths that carried a hand edit on either side.
 *
 * A conflicted path on disk represents neither side, so the verdict table has
 * no baseline to work from. Instead each side is checked against its own lock:
 * a committed tree whose generated output disagrees with the `outputHash` that
 * same tree recorded was edited after it was generated. Both stages are checked
 * because a rebase discards stage 3 ("theirs", the commit being replayed), and
 * an edit there is exactly as lost as one on stage 2.
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
    lockPaths
  );
  const modes = await readIndexModes(rootPath, payloadPaths);
  const handEdited = new Set<string>();
  const otherRevision = await otherConflictRevision(rootPath);

  for (const stage of CONFLICT_STAGES) {
    const snapshots = new Map<string, GeneratedFileSnapshot>();
    for (const path of payloadPaths) {
      const snapshot = conflicted.has(path)
        ? await readConflictSnapshot(rootPath, path, modes, stage)
        : await readTreeSnapshot(
            rootPath,
            stage === 2 ? "HEAD" : (otherRevision ?? "__missing_side__"),
            path
          );
      if (snapshot !== undefined) snapshots.set(path, snapshot);
    }
    if (snapshots.size === 0) continue;
    for (const lockPath of lockPaths) {
      const lockJson = await readStageJson(rootPath, stage, lockPath);
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
  const bytes = await readStageBlob(rootPath, stage, path);
  if (bytes === undefined) return undefined;
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    return undefined;
  }
}

/** Read every managed output path out of parseable working-tree locks. */
export async function readManagedPathsFromLocks(
  rootPath: string,
  lockPaths: readonly string[]
): Promise<ReadonlySet<string>> {
  const managed = new Set<string>();
  for (const lockPath of lockPaths) {
    managed.add(lockPath);
    const file = Bun.file(join(rootPath, lockPath));
    if (!(await file.exists())) continue;
    collectManagedPaths(await readJsonSafely(file), lockPath, managed);
  }
  return managed;
}

/**
 * Managed paths claimed by **either** side of the conflict.
 *
 * Reading only the working tree is not enough: it holds the stage 2 lock, and
 * when that side deleted a source unit its lock no longer claims the outputs.
 * Those files would then look authored, and resolve would tell a human to
 * hand-merge generated output — the one thing this command exists to prevent.
 * Provenance is a property of the file, so a claim by any side is decisive.
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

async function readJsonSafely(
  file: ReturnType<typeof Bun.file>
): Promise<unknown> {
  try {
    return (await file.json()) as unknown;
  } catch {
    return undefined;
  }
}

/** Add every output path one lock claims. An unparseable lock claims nothing. */
function collectManagedPaths(
  lockJson: unknown,
  lockPath: string,
  into: Set<string>
): void {
  if (lockJson === undefined) return;
  into.add(lockPath);
  let parsed: ReturnType<typeof parseGeneratedLock>;
  try {
    parsed = parseGeneratedLock(lockJson, lockPath);
  } catch {
    return;
  }
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
