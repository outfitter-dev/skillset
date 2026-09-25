import { appendFile, readFile, rm, stat, writeFile } from "node:fs/promises";

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
 * including concurrent appends after the owned block, stay in file order.
 */
export async function rollbackOwnedJsonlRecords(
  absolutePath: string,
  ownedLines: ReadonlySet<string>
): Promise<void> {
  if (ownedLines.size === 0 || !(await pathExists(absolutePath))) return;

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
  await writeFile(absolutePath, `${remaining.join("\n")}\n`, "utf8");
}

/**
 * Choose the next event timestamp so a new append cannot invert the current
 * tail. File order remains authoritative; this only keeps `createdAt`/`appliedAt`
 * from introducing a new guard-visible inversion on a live write.
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
 * Release writes history, releases, and ledger in one transaction and needs a
 * shared event time that stays guard-clean on every stream.
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
