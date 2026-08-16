/**
 * Append-only change-stream guard (SET-502).
 *
 * `.skillset/changes/*.jsonl` are append-only event streams (ADR-0014,
 * ADR-0015). `.gitattributes` declares `merge=union` for them so cross-branch
 * merges and restacks resolve deterministically instead of by hand. Union is a
 * line-level strategy: it keeps both sides' appended lines, but it cannot check
 * that the result is still a valid stream. This guard checks what union cannot:
 *
 * - every stream ends with a newline, so appends can never join two records
 *   onto one line;
 * - every non-empty line is one JSON object (what the ledger/history readers
 *   require);
 * - record ids are unique within a file (`readChangeLedger` throws otherwise);
 * - no NEW timestamp inversion is introduced.
 *
 * File order is semantically load-bearing, not cosmetic: `readLedgerReleaseState`
 * and the pending-fact reader in `change-entries.ts` fold events in file order
 * and let later records win. A union merge that lands an older record after a
 * newer one silently changes derived release state.
 *
 * Global chronological order was never an invariant. The committed ledger
 * already contains five inversions inherited by every branch, so this guard
 * allows exactly those recorded adjacent pairs and fails on anything new. See
 * INVERSION_ALLOWANCES and the "Updating the allowances" note at the bottom.
 */

import { existsSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

export type ChangeStreamRule =
  | "duplicate-id"
  | "invalid-json"
  | "invalid-timestamp"
  | "missing-id"
  | "missing-timestamp"
  | "missing-trailing-newline"
  | "missing-union-merge-attribute"
  | "not-an-object"
  | "timestamp-inversion"
  | "unmatched-inversion-allowance";

export type ChangeStreamViolation = {
  readonly file: string;
  /** 1-based record line; `0` means the violation is about the whole file. */
  readonly line: number;
  readonly message: string;
  readonly rule: ChangeStreamRule;
};

/**
 * One recorded pre-existing adjacent inversion: `id` carries a timestamp older
 * than the record immediately above it (`previousId`). Pairs, not a count: a
 * count lets a merge remove one inversion and add another for free, while a
 * pair names the exact records and goes stale the moment history is rewritten.
 */
export type InversionAllowance = {
  readonly file: string;
  readonly id: string;
  readonly previousId: string;
  readonly rationale: string;
};

/** Pathspec for the append-only streams; mirrors the `.gitattributes` pattern. */
export const CHANGE_STREAM_PATHSPEC = ".skillset/changes/*.jsonl";

/**
 * Adjacent inversions already present in committed history before SET-502.
 * Each is a `reason.created`/`change.covered` record that landed after a
 * chronologically later `change.covered` record during a hand-resolved merge —
 * the exact drift `merge=union` plus this guard now makes visible.
 */
export const INVERSION_ALLOWANCES: readonly InversionAllowance[] = [
  {
    file: ".skillset/changes/ledger.jsonl",
    id: "evt-b1f779997a881b3a",
    previousId: "evt-009df2342d2ca1a9",
    rationale: "2026-07-13 reason.created landed after a 2026-07-14 change.covered record.",
  },
  {
    file: ".skillset/changes/ledger.jsonl",
    id: "evt-9f369e127683a21e",
    previousId: "evt-9719de8745c71767",
    rationale: "2026-07-23T22:14 reason.created landed after a 2026-07-23T23:42 change.covered record.",
  },
  {
    file: ".skillset/changes/ledger.jsonl",
    id: "evt-44870b11e357a6dd",
    previousId: "evt-59a32f52e9d7da2b",
    rationale: "2026-07-23T22:52 reason.created landed after a 2026-07-23T23:43 change.covered record.",
  },
  {
    file: ".skillset/changes/ledger.jsonl",
    id: "evt-f9e03e49e14caeb8",
    previousId: "evt-6c7ed57b4e164fd4",
    rationale: "2026-07-24 reason.created landed after a 2026-07-25 change.covered record.",
  },
  {
    file: ".skillset/changes/ledger.jsonl",
    id: "evt-2ddc0efa3d2e460a",
    previousId: "evt-1d875c4df907b1db",
    rationale: "2026-08-07T14:06 change.covered landed after a 2026-08-07T14:24 change.covered record.",
  },
];

/**
 * Timestamp fields, in precedence order. `ledger.jsonl` records `createdAt`;
 * `history.jsonl` and `releases.jsonl` record `appliedAt`.
 */
const TIMESTAMP_FIELDS: readonly string[] = ["createdAt", "appliedAt"];

type StreamRecord = {
  readonly id: string | undefined;
  readonly line: number;
  readonly timestamp: number | undefined;
};

function allowanceKey(file: string, previousId: string, id: string): string {
  return `${file}\0${previousId}\0${id}`;
}

function readTimestamp(record: Record<string, unknown>): string | undefined {
  for (const field of TIMESTAMP_FIELDS) {
    const value = record[field];
    if (typeof value === "string") return value;
  }
  return undefined;
}

function scanFile(
  file: string,
  content: string,
  matched: Set<string>,
  allowed: ReadonlySet<string>
): readonly ChangeStreamViolation[] {
  const violations: ChangeStreamViolation[] = [];
  if (content.length > 0 && !content.endsWith("\n")) {
    violations.push({
      file,
      line: 0,
      message: "append-only stream must end with a newline so appended records cannot join the last line",
      rule: "missing-trailing-newline",
    });
  }

  const records: StreamRecord[] = [];
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
    let id: string | undefined;
    if (typeof rawId === "string" && rawId.length > 0) {
      id = rawId;
      if (seenIds.has(rawId)) {
        violations.push({ file, line, message: `duplicate record id ${rawId}`, rule: "duplicate-id" });
      }
      seenIds.add(rawId);
    } else {
      violations.push({ file, line, message: "record requires a non-empty string id", rule: "missing-id" });
    }

    const rawTimestamp = readTimestamp(record);
    let timestamp: number | undefined;
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
    } else {
      timestamp = Date.parse(rawTimestamp);
    }

    records.push({ id, line, timestamp });
  }

  for (const [index, record] of records.entries()) {
    if (index === 0) continue;
    const previous = records[index - 1];
    if (previous === undefined || previous.timestamp === undefined || record.timestamp === undefined) continue;
    if (record.timestamp >= previous.timestamp) continue;

    const key =
      previous.id === undefined || record.id === undefined
        ? undefined
        : allowanceKey(file, previous.id, record.id);
    if (key !== undefined && allowed.has(key)) {
      matched.add(key);
      continue;
    }
    violations.push({
      file,
      line: record.line,
      message: `record ${record.id ?? "<no id>"} is older than the record above it (${previous.id ?? "<no id>"})`,
      rule: "timestamp-inversion",
    });
  }

  return violations;
}

/**
 * Scan every append-only change stream. Pure; used by tests and by `main`.
 * Allowances that match nothing are reported so the list cannot silently rot.
 */
export function scanChangeStreams(
  files: readonly { readonly content: string; readonly file: string }[],
  allowances: readonly InversionAllowance[] = INVERSION_ALLOWANCES
): readonly ChangeStreamViolation[] {
  const allowed = new Set(allowances.map((entry) => allowanceKey(entry.file, entry.previousId, entry.id)));
  const matched = new Set<string>();
  const violations: ChangeStreamViolation[] = [];

  const scannedFiles = new Set(files.map((entry) => entry.file));
  for (const entry of files) {
    violations.push(...scanFile(entry.file, entry.content, matched, allowed));
  }

  for (const allowance of allowances) {
    if (!scannedFiles.has(allowance.file)) continue;
    const key = allowanceKey(allowance.file, allowance.previousId, allowance.id);
    if (matched.has(key)) continue;
    violations.push({
      file: allowance.file,
      line: 0,
      message: `unmatched inversion allowance ${allowance.previousId} -> ${allowance.id}; the pair no longer exists, so remove it`,
      rule: "unmatched-inversion-allowance",
    });
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

async function runText(command: readonly string[]): Promise<string> {
  const subprocess = Bun.spawn([...command], { cwd: rootDir, stderr: "pipe", stdout: "pipe" });
  const [exitCode, stdout, stderr] = await Promise.all([
    subprocess.exited,
    new Response(subprocess.stdout).text(),
    new Response(subprocess.stderr).text(),
  ]);
  if (exitCode !== 0) throw new Error(`${command.join(" ")} failed: ${stderr.trim()}`);
  return stdout;
}

async function main(): Promise<void> {
  const tracked = (await runText(["git", "ls-files", "--", CHANGE_STREAM_PATHSPEC]))
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const files: { readonly content: string; readonly file: string }[] = [];
  for (const file of tracked) {
    const path = `${rootDir}/${file}`;
    if (!existsSync(path)) continue;
    files.push({ content: await Bun.file(path).text(), file });
  }

  const violations = [...scanChangeStreams(files)];

  if (files.length > 0) {
    const attributes = parseMergeAttributes(
      await runText(["git", "check-attr", "merge", "--", ...files.map((entry) => entry.file)])
    );
    for (const entry of files) {
      if (attributes.get(entry.file) === "union") continue;
      violations.push({
        file: entry.file,
        line: 0,
        message: "append-only stream must declare `merge=union` in .gitattributes",
        rule: "missing-union-merge-attribute",
      });
    }
  }

  if (violations.length === 0) {
    console.error(
      `skillset: change stream guard scanned ${files.length} append-only stream(s); union-merge safe`
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
    "skillset: append-only streams may only gain records at the end. Re-resolve the merge by keeping both " +
      "sides' appended records in timestamp order, or record a deliberate exception in INVERSION_ALLOWANCES " +
      "in scripts/change-stream-guard.ts."
  );
  process.exit(1);
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}

/*
 * Updating the allowances
 * -----------------------
 * The guard runs in `bun run check`. When `timestamp-inversion` fails:
 *
 * 1. Prefer fixing the stream. A union merge keeps both sides' records but
 *    concatenates ours-then-theirs, so a branch that appended earlier records
 *    can land them after a newer trunk record. Reorder the appended block by
 *    timestamp; never sort the whole file, because the recorded inversions
 *    below prove global order was never an invariant.
 * 2. Only record an allowance for an inversion that is already committed and
 *    cannot be reordered without rewriting shared history. Name both ids and
 *    say why. Unmatched allowances fail the guard, so a stale entry cannot
 *    quietly widen into a blanket exemption.
 */
