import { appendFile, readFile, rm, stat } from "node:fs/promises";

import { publishAtomicFile } from "./atomic-file-publication";
import { readString } from "./config";
import type { JsonRecord } from "./types";
import { isJsonRecord } from "./yaml";

const TIMESTAMP_FIELDS = ["createdAt", "appliedAt", "amendedAt"] as const;

/**
 * Append serialized JSON objects to an append-only JSONL stream and return the
 * exact lines that this writer owns. Rollback uses those lines, never a
 * whole-file snapshot, so a later foreign append cannot be erased.
 *
 * The caller prepares the parent directory (see `prepareRepositoryMutationPath`)
 * so a symlinked ancestor fails closed; this helper never creates directories.
 */
export async function appendOwnedJsonlRecords(
  absolutePath: string,
  records: readonly object[]
): Promise<readonly string[]> {
  if (records.length === 0) return [];
  const lines = records.map((record) => JSON.stringify(record));
  await appendFile(absolutePath, `${lines.join("\n")}\n`, "utf8");
  return lines;
}

/**
 * Remove only the exact JSONL records this transaction appended. Foreign lines,
 * including concurrent appends after the owned block, stay in file order. The
 * remainder is published atomically with the stream's current mode, so an
 * interrupted rollback leaves either the previous stream or the complete
 * remainder, never a truncated one. A stream left with no records is removed.
 */
export async function rollbackOwnedJsonlRecords(
  absolutePath: string,
  ownedLines: ReadonlySet<string>
): Promise<void> {
  if (ownedLines.size === 0 || !(await pathExists(absolutePath))) return;
  const { mode } = await stat(absolutePath);

  const remaining: string[] = [];
  const pending = new Set(ownedLines);
  for (const line of (await readFile(absolutePath, "utf8")).split("\n")) {
    if (line.length === 0) continue;
    if (pending.has(line)) {
      pending.delete(line);
      continue;
    }
    remaining.push(line);
  }

  if (remaining.length === 0) {
    await rm(absolutePath, { force: true });
    return;
  }
  await publishAtomicFile(absolutePath, `${remaining.join("\n")}\n`, { mode: mode & 0o777 });
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
  if (!(await pathExists(absolutePath))) return undefined;
  const lines = (await readFile(absolutePath, "utf8")).split("\n");
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

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}
