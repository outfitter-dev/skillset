import { readdir } from "node:fs/promises";
import { posix } from "node:path";

import { jsonlTailTimestamp } from "./change-ledger-write";
import { MISSING_PATH_ENOENT, readOptionalText } from "./fs-existence";
import { compareStrings, resolveInside } from "./path";
import { workspaceChangeFile } from "./workspace-state";

/**
 * Pending change-ledger events (ADR-0045). Every mutation that records a ledger
 * event writes its records to one new file under `<source-root>/changes/events/`
 * instead of appending to `ledger.jsonl`, so branches that each record events
 * add different files and never conflict. Readers fold `ledger.jsonl` in file
 * order, then pending files in name order, then each file's records in line
 * order. `skillset release apply` folds pending files into `ledger.jsonl`.
 */
export const PENDING_LEDGER_EVENTS_DIR = "events";

const LEDGER_FILE = "ledger.jsonl";
const PENDING_FILE_PATTERN = /^\d{8}T\d{9}Z-[A-Za-z0-9][A-Za-z0-9-]*\.jsonl$/u;
const ISO_TIMESTAMP_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.(\d{3})Z$/u;

/** The workspace-relative directory that holds pending ledger event files. */
export function pendingLedgerEventsDir(sourceDir: string | undefined): string {
  return workspaceChangeFile(sourceDir, PENDING_LEDGER_EVENTS_DIR);
}

/**
 * The pending file for a mutation whose first event is `id`, stamped with that
 * event's `createdAt`. The compact UTC stamp sorts by time, is valid on every
 * filesystem, and the id keeps concurrent branches' names distinct.
 */
export function pendingLedgerEventFile(
  sourceDir: string | undefined,
  createdAt: string,
  id: string
): string {
  return `${pendingLedgerEventsDir(sourceDir)}/${pendingLedgerEventFileName(createdAt, id)}`;
}

/** The file name alone of `pendingLedgerEventFile`. */
export function pendingLedgerEventFileName(createdAt: string, id: string): string {
  const match = ISO_TIMESTAMP_PATTERN.exec(createdAt);
  if (match === null) {
    throw new Error(
      `skillset: pending ledger event timestamp must be a UTC ISO timestamp with milliseconds, got ${JSON.stringify(createdAt)}`
    );
  }
  const [, year, month, day, hour, minute, second, millis] = match;
  const name = `${year}${month}${day}T${hour}${minute}${second}${millis}Z-${id}.jsonl`;
  if (!PENDING_FILE_PATTERN.test(name)) {
    throw new Error(`skillset: change ledger event id ${JSON.stringify(id)} cannot name a pending event file`);
  }
  return name;
}

/** Whether a workspace-relative path names a pending ledger event file. */
export function isPendingLedgerEventFile(
  sourceDir: string | undefined,
  relativePath: string
): boolean {
  const prefix = `${pendingLedgerEventsDir(sourceDir)}/`;
  return relativePath.startsWith(prefix) &&
    PENDING_FILE_PATTERN.test(relativePath.slice(prefix.length));
}

/**
 * Pending ledger event files in fold order. Dotfiles such as `.gitkeep` are
 * ignored; any other entry is refused, because a misnamed file would be
 * silently left out of the fold.
 */
export async function listPendingLedgerEventFiles(
  rootPath: string,
  sourceDir: string | undefined
): Promise<readonly string[]> {
  return listPendingLedgerEventFilesIn(rootPath, pendingLedgerEventsDir(sourceDir));
}

async function listPendingLedgerEventFilesIn(
  rootPath: string,
  directory: string
): Promise<readonly string[]> {
  let entries;
  try {
    entries = await readdir(resolveInside(rootPath, directory), { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    if (!entry.isFile() || !PENDING_FILE_PATTERN.test(entry.name)) {
      throw new Error(
        `skillset: ${directory}/${entry.name} is not a pending change ledger event file; expected <YYYYMMDDTHHMMSSmmmZ>-<event-id>.jsonl`
      );
    }
    files.push(`${directory}/${entry.name}`);
  }
  return files.toSorted(compareStrings);
}

/** Every ledger stream in fold order: `ledger.jsonl`, then pending files. */
export async function changeLedgerStreamPaths(
  rootPath: string,
  sourceDir: string | undefined
): Promise<readonly string[]> {
  return streamPathsFor(rootPath, pendingLedgerEventsDir(sourceDir));
}

async function streamPathsFor(
  rootPath: string,
  eventsDir: string
): Promise<readonly string[]> {
  return [
    posix.join(posix.dirname(eventsDir), LEDGER_FILE),
    ...await listPendingLedgerEventFilesIn(rootPath, eventsDir),
  ];
}

/**
 * The latest event time across `ledger.jsonl` and every pending file. New
 * events stamp `max(now, latest)`, so event time stays non-decreasing in fold
 * order on a branch.
 */
export async function readChangeLedgerTailTimestamp(
  rootPath: string,
  sourceDir: string | undefined
): Promise<string | undefined> {
  return readChangeLedgerTailTimestampAt(rootPath, pendingLedgerEventsDir(sourceDir));
}

/** `readChangeLedgerTailTimestamp` for a workspace-relative events directory. */
export async function readChangeLedgerTailTimestampAt(
  rootPath: string,
  eventsDir: string
): Promise<string | undefined> {
  let latest: string | undefined;
  let latestMs = Number.NEGATIVE_INFINITY;
  for (const path of await streamPathsFor(rootPath, eventsDir)) {
    const content = await readOptionalText(resolveInside(rootPath, path), {
      missing: MISSING_PATH_ENOENT,
    });
    const tail = content === undefined ? undefined : jsonlTailTimestamp(content);
    if (tail === undefined) continue;
    const tailMs = Date.parse(tail);
    if (Number.isFinite(tailMs) && tailMs >= latestMs) {
      latest = tail;
      latestMs = tailMs;
    }
  }
  return latest;
}
