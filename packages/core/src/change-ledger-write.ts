import { appendFile, open, rm, stat } from "node:fs/promises";

import { publishAtomicFile } from "./atomic-file-publication";
import { readString } from "./config";
import { MISSING_PATH_ENOENT, pathExists, readOptionalText } from "./fs-existence";
import type { JsonRecord } from "./types";
import { isJsonRecord } from "./yaml";

const TIMESTAMP_FIELDS = ["createdAt", "appliedAt", "amendedAt"] as const;
const ROLLBACK_ATTEMPTS = 5;

/**
 * Writer-lock contract for append-only JSONL streams (ADR-0038).
 *
 * Every appender and every rollback of one stream must run while holding the
 * same writer lock; in production that is the change-ledger lock, which the
 * change, release, and lifecycle commands take for their whole mutation. These
 * primitives do not take the lock themselves. Rollback additionally re-reads
 * the stream immediately before it publishes and starts over if the bytes
 * changed, so an append that bypasses the lock is not silently dropped in the
 * read-to-publish window.
 */

/**
 * Append serialized JSON objects to an append-only JSONL stream and return the
 * exact lines that this writer owns, in append order. Rollback uses those lines,
 * never a whole-file snapshot, so a later foreign append cannot be erased.
 *
 * A non-empty stream without a trailing newline is refused: appending would
 * join the new record onto the last line. The caller prepares the parent
 * directory (see `prepareRepositoryMutationPath`) so a symlinked ancestor fails
 * closed; this helper never creates directories.
 */
export async function appendOwnedJsonlRecords(
  absolutePath: string,
  records: readonly object[]
): Promise<readonly string[]> {
  if (records.length === 0) return [];
  await assertEndsWithNewline(absolutePath);
  const lines = records.map((record) => JSON.stringify(record));
  await appendFile(absolutePath, `${lines.join("\n")}\n`, "utf8");
  return lines;
}

export interface RollbackOwnedJsonlOptions {
  /** @internal Test seam after each read of the stream, before publication. */
  readonly testHooks?: { readonly afterRead?: () => Promise<void> | void };
}

/**
 * Remove exactly the JSONL records this transaction appended, one occurrence
 * per owned line, scanning from the end so an earlier identical line (for
 * example a trunk record) is kept. Foreign lines stay in file order. The
 * remainder is published atomically with the stream's current mode; a stream
 * left with no records is removed. Callers hold the stream's writer lock (see
 * the contract above).
 */
export async function rollbackOwnedJsonlRecords(
  absolutePath: string,
  ownedLines: readonly string[],
  options: RollbackOwnedJsonlOptions = {}
): Promise<void> {
  if (ownedLines.length === 0) return;
  for (let attempt = 0; attempt < ROLLBACK_ATTEMPTS; attempt += 1) {
    const current = await readOptionalText(absolutePath, { missing: MISSING_PATH_ENOENT });
    if (current === undefined) return;
    const { mode } = await stat(absolutePath);
    const remaining = withoutOwnedLines(current, ownedLines);
    await options.testHooks?.afterRead?.();
    const unchanged = async (): Promise<boolean> =>
      (await readOptionalText(absolutePath, { missing: MISSING_PATH_ENOENT })) === current;

    if (remaining.length === 0) {
      if (!(await unchanged())) continue;
      await rm(absolutePath, { force: true });
      return;
    }
    try {
      await publishAtomicFile(absolutePath, `${remaining.join("\n")}\n`, {
        beforeRename: async () => {
          if (!(await unchanged())) throw new StreamChangedDuringRollback();
        },
        mode: mode & 0o777,
      });
      return;
    } catch (error) {
      if (error instanceof StreamChangedDuringRollback) continue;
      throw error;
    }
  }
  throw new Error(
    `skillset: ${absolutePath} kept changing during rollback; rerun while no other Skillset command is writing it`
  );
}

class StreamChangedDuringRollback extends Error {}

function withoutOwnedLines(content: string, ownedLines: readonly string[]): readonly string[] {
  const owed = new Map<string, number>();
  for (const line of ownedLines) owed.set(line, (owed.get(line) ?? 0) + 1);
  const kept: string[] = [];
  const lines = content.split("\n").filter((line) => line.length > 0);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index] ?? "";
    const count = owed.get(line) ?? 0;
    if (count > 0) {
      owed.set(line, count - 1);
      continue;
    }
    kept.push(line);
  }
  return kept.toReversed();
}

async function assertEndsWithNewline(absolutePath: string): Promise<void> {
  if (!(await pathExists(absolutePath, { missing: MISSING_PATH_ENOENT, probe: "stat" }))) return;
  const file = await open(absolutePath, "r");
  try {
    const { size } = await file.stat();
    if (size === 0) return;
    const last = Buffer.alloc(1);
    await file.read(last, 0, 1, size - 1);
    if (last[0] !== 0x0a) {
      throw new Error(
        `skillset: cannot append to ${absolutePath}: the stream does not end with a newline, so a new record would join its last line; add the missing newline (bun run change-stream:guard reports it) and retry`
      );
    }
  } finally {
    await file.close();
  }
}

/**
 * Choose the next event timestamp as `max(now, tail)`. File order is the fold
 * order (ADR-0038); this keeps event time non-decreasing in file order for
 * readers of live appends. A future-dated tail pins later stamps forward.
 */
export function nextJsonlTimestamp(
  previousTimestamp: string | undefined,
  nowMs = Date.now()
): string {
  if (previousTimestamp === undefined) return new Date(nowMs).toISOString();
  const previousMs = Date.parse(previousTimestamp);
  if (!Number.isFinite(previousMs)) {
    throw new Error(`skillset: cannot append after invalid JSONL timestamp ${JSON.stringify(previousTimestamp)}`);
  }
  return new Date(Math.max(nowMs, previousMs)).toISOString();
}

/**
 * Choose one timestamp that does not invert any of the named JSONL tails.
 * Release writes history, releases, and ledger in one transaction and needs one
 * shared event time that is non-decreasing on every stream it appends to.
 */
export async function nextJsonlTimestampForPaths(
  absolutePaths: readonly string[],
  nowMs = Date.now()
): Promise<string> {
  let timestamp = new Date(nowMs).toISOString();
  for (const absolutePath of absolutePaths) {
    timestamp = nextJsonlTimestamp(await readJsonlTailTimestamp(absolutePath), Date.parse(timestamp));
  }
  return timestamp;
}

export async function readJsonlTailTimestamp(absolutePath: string): Promise<string | undefined> {
  const content = await readOptionalText(absolutePath, { missing: MISSING_PATH_ENOENT });
  return content === undefined ? undefined : jsonlTailTimestamp(content);
}

/** The event timestamp of the last non-empty record in JSONL `content`, if any. */
export function jsonlTailTimestamp(content: string): string | undefined {
  const lines = content.split("\n");
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    if (line === undefined || line.trim().length === 0) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line) as unknown;
    } catch {
      return undefined;
    }
    if (!isJsonRecord(parsed)) return undefined;
    return readJsonlTimestamp(parsed);
  }
  return undefined;
}

export function readJsonlTimestamp(record: JsonRecord): string | undefined {
  for (const field of TIMESTAMP_FIELDS) {
    const value = readString(record, field);
    if (value !== undefined) return value;
  }
  return undefined;
}
