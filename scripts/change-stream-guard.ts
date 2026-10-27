/**
 * Append-only change-stream guard (SET-502, SET-661).
 *
 * `.skillset/changes/*.jsonl` are append-only event streams (ADR-0014,
 * ADR-0015). `.gitattributes` declares `merge=union` for them so cross-branch
 * merges and restacks resolve deterministically instead of by hand. Union is a
 * line-level strategy: it keeps both sides' appended lines, but it cannot check
 * that the result is still a valid stream. This guard checks what union cannot:
 *
 * - every stream ends with a newline, so appends can never join two records
 *   onto one line;
 * - every non-empty line is one JSON object with an id and a parseable event
 *   timestamp (what the ledger/history readers require);
 * - record ids are unique within a file (`readChangeLedger` throws otherwise),
 *   except in amendment streams, where `id` names the amended record and a
 *   later amendment of the same record supersedes an earlier one;
 * - trunk's stream is an in-order prefix of the working copy: every record at
 *   the merge-base with the remote trunk (`scripts/git-trunk.sh`) is still
 *   present, byte for byte, at the same line, and new records only follow it.
 *
 * Pending change-ledger event files under `.skillset/changes/events/`
 * (ADR-0045) are write-once instead: each must be a valid stream with a
 * conforming name, a trunk file may be deleted only once `release apply` has
 * folded every one of its records into `ledger.jsonl`, it is never edited, and
 * ids stay unique across `ledger.jsonl` and every pending file. They fold after `ledger.jsonl`, by file name.
 *
 * File order is the only fold order (ADR-0038): `readLedgerReleaseState` and the
 * pending-fact reader in `change-entries.ts` fold events top to bottom and let
 * later records win, so reordering or removing a trunk record silently changes
 * derived release state. `createdAt`/`appliedAt`/`amendedAt` are event time,
 * not sequence, so an appended block may be older than trunk's tail — that is
 * what `merge=union` produces when a branch is restacked — and the guard does
 * not compare timestamps across records.
 */

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { gitSafeEnv } from "../apps/skillset/src/git-env";

export type ChangeStreamRule =
  | "duplicate-id"
  | "invalid-json"
  | "invalid-timestamp"
  | "missing-id"
  | "missing-timestamp"
  | "missing-trailing-newline"
  | "invalid-pending-event-name"
  | "missing-union-merge-attribute"
  | "not-an-object"
  | "pending-event-dropped"
  | "pending-event-edited"
  | "trunk-prefix-divergence";

export type ChangeStreamViolation = {
  readonly file: string;
  /** 1-based record line; `0` means the violation is about the whole file. */
  readonly line: number;
  readonly message: string;
  readonly rule: ChangeStreamRule;
};

/**
 * Pathspec for the append-only streams; mirrors the `.gitattributes` pattern.
 * `:(glob)` keeps `*` inside one path segment, as in `.gitattributes`, so the
 * pending event files under `changes/events/` are not append-only streams.
 */
export const CHANGE_STREAM_PATHSPEC = ":(glob).skillset/changes/*.jsonl";

/**
 * Pending change-ledger event files (ADR-0045): one new file per mutation,
 * folded into `ledger.jsonl` and deleted by `skillset release apply`. They are
 * write-once, so they need no merge attribute; a trunk file may be deleted but
 * never edited.
 */
export const PENDING_EVENT_PATHSPEC = ":(glob).skillset/changes/events/*.jsonl";

/**
 * Timestamp fields, in precedence order. `ledger.jsonl` records `createdAt`;
 * `history.jsonl` and `releases.jsonl` record `appliedAt`; amendment streams
 * record `amendedAt`.
 */
const TIMESTAMP_FIELDS: readonly string[] = ["createdAt", "appliedAt", "amendedAt"];

function readTimestamp(record: Record<string, unknown>): string | undefined {
  for (const field of TIMESTAMP_FIELDS) {
    const value = record[field];
    if (typeof value === "string") return value;
  }
  return undefined;
}

/**
 * Amendment streams key each record by the history or release record it
 * amends, so the same id legitimately repeats; readers let the last one win.
 */
const AMENDMENT_STREAM = /(?:^|\/)(?:release-)?amendments\.jsonl$/u;

function scanFile(file: string, content: string): readonly ChangeStreamViolation[] {
  const violations: ChangeStreamViolation[] = [];
  if (content.length > 0 && !content.endsWith("\n")) {
    violations.push({
      file,
      line: 0,
      message: "append-only stream must end with a newline so appended records cannot join the last line",
      rule: "missing-trailing-newline",
    });
  }

  const seenIds = new Set<string>();
  for (const [index, text] of content.split("\n").entries()) {
    const line = index + 1;
    if (text.trim().length === 0) continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(text) as unknown;
    } catch {
      violations.push({ file, line, message: "line is not valid JSON", rule: "invalid-json" });
      continue;
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      violations.push({ file, line, message: "line must be a JSON object", rule: "not-an-object" });
      continue;
    }

    const record = parsed as Record<string, unknown>;
    const rawId = record.id;
    if (typeof rawId === "string" && rawId.length > 0) {
      if (seenIds.has(rawId) && !AMENDMENT_STREAM.test(file)) {
        violations.push({ file, line, message: `duplicate record id ${rawId}`, rule: "duplicate-id" });
      }
      seenIds.add(rawId);
    } else {
      violations.push({ file, line, message: "record requires a non-empty string id", rule: "missing-id" });
    }

    const rawTimestamp = readTimestamp(record);
    if (rawTimestamp === undefined) {
      violations.push({
        file,
        line,
        message: `record requires one of ${TIMESTAMP_FIELDS.join(", ")}`,
        rule: "missing-timestamp",
      });
    } else if (Number.isNaN(Date.parse(rawTimestamp))) {
      violations.push({
        file,
        line,
        message: `timestamp ${rawTimestamp} is not a parseable date`,
        rule: "invalid-timestamp",
      });
    }
  }

  return violations;
}

/** One stream as the working copy has it, plus its content at the trunk merge-base. */
export type ChangeStreamInput = {
  readonly content: string;
  readonly file: string;
  /** Content at the trunk merge-base; absent when the stream is new on this branch. */
  readonly trunkContent?: string;
};

const TRUNK_PREFIX_HINT =
  "keep trunk's records in their original order and append new records after them";

/** Split records on LF or CRLF, so a CRLF checkout still matches trunk's LF blob. */
function streamLines(content: string): readonly string[] {
  const lines = content.split(/\r?\n/u);
  if (lines.at(-1) === "") lines.pop();
  return lines;
}

function recordLabel(text: string): string {
  try {
    const parsed = JSON.parse(text) as unknown;
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      const id = (parsed as Record<string, unknown>).id;
      if (typeof id === "string" && id.length > 0) return id;
    }
  } catch {
    // Fall through: name the record by its line text.
  }
  return JSON.stringify(text);
}

/**
 * Report the first line where the working copy stops extending trunk's stream.
 * Only the first divergence is reported: every later line is shifted by it.
 */
function scanTrunkPrefix(file: string, content: string, trunkContent: string): readonly ChangeStreamViolation[] {
  const lines = streamLines(content);
  for (const [index, trunkLine] of streamLines(trunkContent).entries()) {
    const line = index + 1;
    const current = lines[index];
    if (current === trunkLine) continue;
    const trunkRecord = recordLabel(trunkLine);
    return [{
      file,
      line,
      message:
        current === undefined
          ? `trunk record ${trunkRecord} at line ${line} is missing; ${TRUNK_PREFIX_HINT}`
          : `line ${line} does not match trunk record ${trunkRecord}; ${TRUNK_PREFIX_HINT}`,
      rule: "trunk-prefix-divergence",
    }];
  }
  return [];
}

/** Scan every append-only change stream. Pure; used by tests and by `main`. */
export function scanChangeStreams(files: readonly ChangeStreamInput[]): readonly ChangeStreamViolation[] {
  const violations: ChangeStreamViolation[] = [];
  for (const entry of files) {
    violations.push(...scanFile(entry.file, entry.content));
    if (entry.trunkContent !== undefined) {
      violations.push(...scanTrunkPrefix(entry.file, entry.content, entry.trunkContent));
    }
  }
  return violations;
}

/** Parse `git check-attr merge -- <paths>` output into path -> attribute value. */
export function parseMergeAttributes(output: string): ReadonlyMap<string, string> {
  const attributes = new Map<string, string>();
  for (const line of output.split("\n")) {
    const match = /^(?<path>.+): merge: (?<value>.+)$/u.exec(line.trim());
    const path = match?.groups?.path;
    const value = match?.groups?.value;
    if (path !== undefined && value !== undefined) attributes.set(path, value);
  }
  return attributes;
}

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));

const CHANGE_STREAM_FILE = /^\.skillset\/changes\/[^/]+\.jsonl$/u;
const PENDING_EVENT_FILE = /^\.skillset\/changes\/events\/[^/]+\.jsonl$/u;
const PENDING_EVENT_NAME = /^\d{8}T\d{9}Z-[A-Za-z0-9][A-Za-z0-9-]*\.jsonl$/u;
const LEDGER_STREAM = ".skillset/changes/ledger.jsonl";

/**
 * Check pending event files: each is a valid stream with a conforming name, a
 * file already on trunk is unchanged (only `release apply` removes one), and
 * record ids are unique across `ledger.jsonl` and every pending file, which is
 * what `readChangeLedger` requires of the folded ledger.
 */
export function scanPendingEventFiles(
  files: readonly ChangeStreamInput[],
  ledgerContent = ""
): readonly ChangeStreamViolation[] {
  const violations: ChangeStreamViolation[] = [];
  const seen = new Map<string, string>();
  const noteIds = (file: string, content: string): void => {
    for (const [index, text] of content.split("\n").entries()) {
      let id: unknown;
      try {
        id = (JSON.parse(text) as Record<string, unknown> | null)?.id;
      } catch {
        continue;
      }
      if (typeof id !== "string" || id.length === 0) continue;
      const first = seen.get(id);
      if (first !== undefined && first !== file) {
        violations.push({
          file,
          line: index + 1,
          message: `record id ${id} is already used in ${first}`,
          rule: "duplicate-id",
        });
      }
      seen.set(id, first ?? file);
    }
  };
  noteIds(LEDGER_STREAM, ledgerContent);
  for (const entry of files) {
    const name = entry.file.slice(entry.file.lastIndexOf("/") + 1);
    if (!PENDING_EVENT_NAME.test(name)) {
      violations.push({
        file: entry.file,
        line: 0,
        message: "pending event file must be named <YYYYMMDDTHHMMSSmmmZ>-<event-id>.jsonl",
        rule: "invalid-pending-event-name",
      });
    }
    violations.push(...scanFile(entry.file, entry.content));
    if (entry.trunkContent !== undefined && entry.trunkContent !== entry.content) {
      violations.push({
        file: entry.file,
        line: 0,
        message: "a pending event file on trunk is write-once; restore it exactly, or let `skillset release apply` fold it",
        rule: "pending-event-edited",
      });
    }
    noteIds(entry.file, entry.content);
  }
  return violations;
}

/**
 * A pending event file that exists at the merge-base and is gone from the
 * working copy is legitimate only when `release apply` folded it: every one of
 * its records must now be a line of `ledger.jsonl`. Otherwise its events would
 * silently drop out of the folded ledger.
 */
export function scanDroppedPendingEventFile(
  file: string,
  trunkContent: string,
  ledgerContent: string
): readonly ChangeStreamViolation[] {
  const ledgerLines = new Set(ledgerContent.replaceAll("\r\n", "\n").split("\n"));
  const missing = trunkContent
    .replaceAll("\r\n", "\n")
    .split("\n")
    .filter((line) => line.trim().length > 0 && !ledgerLines.has(line));
  return missing.length === 0
    ? []
    : [{
        file,
        line: 0,
        message: `pending event file was deleted but ${missing.length} of its record(s) are not in ${LEDGER_STREAM}; restore it, or let \`skillset release apply\` fold it`,
        rule: "pending-event-dropped",
      }];
}

async function runText(cwd: string, command: readonly string[]): Promise<string> {
  const subprocess = Bun.spawn([...command], {
    cwd,
    env: gitSafeEnv(),
    stderr: "pipe",
    stdout: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    subprocess.exited,
    new Response(subprocess.stdout).text(),
    new Response(subprocess.stderr).text(),
  ]);
  if (exitCode !== 0) throw new Error(`${command.join(" ")} failed: ${stderr.trim()}`);
  return stdout;
}

function nonEmptyLines(output: string): readonly string[] {
  return output.split("\n").map((line) => line.trim()).filter(Boolean);
}

async function resolveMergeBase(rootPath: string, trunkRef: string): Promise<string> {
  let output: string;
  try {
    output = await runText(rootPath, ["git", "merge-base", "HEAD", trunkRef]);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `skillset: change stream guard cannot find a merge-base between HEAD and ${trunkRef} (${detail.trim()}); ` +
        "fetch the trunk with full history (for example `git fetch --unshallow origin`, or `fetch-depth: 0` in CI) and retry",
      { cause: error }
    );
  }
  return output.trim();
}

/**
 * Read every append-only stream in `rootPath`'s working copy, pair it with its
 * content at `git merge-base HEAD <trunkRef>`, and return all violations. A
 * stream that exists at the merge-base but not in the working copy is scanned
 * as empty, so deleting it reports trunk's first record as missing.
 */
export async function collectChangeStreamViolations(options: {
  readonly rootPath: string;
  readonly trunkRef: string;
}): Promise<{ readonly scanned: number; readonly violations: readonly ChangeStreamViolation[] }> {
  const { rootPath, trunkRef } = options;
  const mergeBase = await resolveMergeBase(rootPath, trunkRef);
  const trunkFiles = new Set(
    nonEmptyLines(await runText(rootPath, ["git", "ls-tree", "-r", "--name-only", mergeBase, "--", ".skillset/changes"]))
      .filter((file) => CHANGE_STREAM_FILE.test(file))
  );
  const tracked = nonEmptyLines(await runText(rootPath, ["git", "ls-files", "--", CHANGE_STREAM_PATHSPEC]));

  const files: ChangeStreamInput[] = [];
  const present: string[] = [];
  for (const file of [...new Set([...tracked, ...trunkFiles])].sort()) {
    const path = join(rootPath, file);
    const exists = existsSync(path);
    if (!exists && !trunkFiles.has(file)) continue;
    if (exists) present.push(file);
    files.push({
      content: exists ? await Bun.file(path).text() : "",
      file,
      ...(trunkFiles.has(file)
        ? { trunkContent: await runText(rootPath, ["git", "show", `${mergeBase}:${file}`]) }
        : {}),
    });
  }

  const violations = [...scanChangeStreams(files)];

  const trunkPending = new Set(
    nonEmptyLines(await runText(rootPath, ["git", "ls-tree", "-r", "--name-only", mergeBase, "--", ".skillset/changes/events"]))
      .filter((file) => PENDING_EVENT_FILE.test(file))
  );
  const pendingFiles: ChangeStreamInput[] = [];
  for (const file of nonEmptyLines(await runText(rootPath, ["git", "ls-files", "--", PENDING_EVENT_PATHSPEC])).toSorted()) {
    const path = join(rootPath, file);
    if (!existsSync(path)) continue;
    pendingFiles.push({
      content: await Bun.file(path).text(),
      file,
      ...(trunkPending.has(file)
        ? { trunkContent: await runText(rootPath, ["git", "show", `${mergeBase}:${file}`]) }
        : {}),
    });
  }
  const ledgerPath = join(rootPath, LEDGER_STREAM);
  const ledgerContent = existsSync(ledgerPath) ? await Bun.file(ledgerPath).text() : "";
  violations.push(...scanPendingEventFiles(pendingFiles, ledgerContent));
  for (const file of [...trunkPending].toSorted()) {
    if (existsSync(join(rootPath, file))) continue;
    violations.push(...scanDroppedPendingEventFile(
      file,
      await runText(rootPath, ["git", "show", `${mergeBase}:${file}`]),
      ledgerContent
    ));
  }
  if (present.length > 0) {
    const attributes = parseMergeAttributes(
      await runText(rootPath, ["git", "check-attr", "merge", "--", ...present])
    );
    for (const file of present) {
      if (attributes.get(file) === "union") continue;
      violations.push({
        file,
        line: 0,
        message: "append-only stream must declare `merge=union` in .gitattributes",
        rule: "missing-union-merge-attribute",
      });
    }
  }

  return { scanned: files.length + pendingFiles.length, violations };
}

async function main(): Promise<void> {
  const trunkRef = (await runText(rootDir, ["bash", "scripts/git-trunk.sh"])).trim();
  const { scanned, violations } = await collectChangeStreamViolations({ rootPath: rootDir, trunkRef });

  if (violations.length === 0) {
    console.error(
      `skillset: change stream guard scanned ${scanned} append-only stream(s) against ${trunkRef}; union-merge safe`
    );
    return;
  }

  console.error(`skillset: change stream guard found ${violations.length} append-only stream problem(s):`);
  for (const violation of violations) {
    const location = violation.line === 0 ? violation.file : `${violation.file}:${violation.line}`;
    console.error(`  ${location}: ${violation.rule}`);
    console.error(`    ${violation.message}`);
  }
  console.error(
    `skillset: append-only streams may only gain records after ${trunkRef}'s. Restore trunk's records ` +
      "exactly as they are at the merge-base and move this branch's records after them. Never sort a stream."
  );
  process.exit(1);
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
