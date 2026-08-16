import { describe, expect, test } from "bun:test";

import {
  CHANGE_STREAM_PATHSPEC,
  INVERSION_ALLOWANCES,
  type InversionAllowance,
  parseMergeAttributes,
  scanChangeStreams,
} from "../change-stream-guard";

const FILE = ".skillset/changes/ledger.jsonl";

function event(id: string, createdAt: string): string {
  return JSON.stringify({ createdAt, id, payload: {}, schemaVersion: 1, type: "reason.created" });
}

function stream(...lines: readonly string[]): string {
  return `${lines.join("\n")}\n`;
}

function scan(content: string, allowances: readonly InversionAllowance[] = []) {
  return scanChangeStreams([{ content, file: FILE }], allowances);
}

describe("change stream guard", () => {
  test("accepts a clean union merge that keeps both sides' records", () => {
    const content = stream(
      event("evt-base-1", "2026-08-01T00:00:00.000Z"),
      event("evt-base-2", "2026-08-02T00:00:00.000Z"),
      event("evt-ours-1", "2026-08-03T00:00:00.000Z"),
      event("evt-theirs-1", "2026-08-04T00:00:00.000Z")
    );

    expect(scan(content)).toEqual([]);
  });

  test("flags a duplicate record id", () => {
    const content = stream(
      event("evt-base-1", "2026-08-01T00:00:00.000Z"),
      event("evt-base-1", "2026-08-02T00:00:00.000Z")
    );

    expect(scan(content)).toEqual([
      { file: FILE, line: 2, message: "duplicate record id evt-base-1", rule: "duplicate-id" },
    ]);
  });

  test("flags a newly introduced timestamp inversion", () => {
    const content = stream(
      event("evt-base-1", "2026-08-01T00:00:00.000Z"),
      event("evt-theirs-1", "2026-08-04T00:00:00.000Z"),
      event("evt-ours-1", "2026-08-03T00:00:00.000Z")
    );

    expect(scan(content)).toEqual([
      {
        file: FILE,
        line: 3,
        message: "record evt-ours-1 is older than the record above it (evt-theirs-1)",
        rule: "timestamp-inversion",
      },
    ]);
  });

  test("accepts a recorded pre-existing inversion and still flags a new one", () => {
    const allowances: readonly InversionAllowance[] = [
      { file: FILE, id: "evt-old", previousId: "evt-new", rationale: "committed before the guard existed." },
    ];
    const content = stream(
      event("evt-new", "2026-08-04T00:00:00.000Z"),
      event("evt-old", "2026-08-03T00:00:00.000Z"),
      event("evt-later", "2026-08-06T00:00:00.000Z"),
      event("evt-regression", "2026-08-05T00:00:00.000Z")
    );

    expect(scan(content, allowances)).toEqual([
      {
        file: FILE,
        line: 4,
        message: "record evt-regression is older than the record above it (evt-later)",
        rule: "timestamp-inversion",
      },
    ]);
  });

  test("flags an allowance that no longer matches any pair", () => {
    const allowances: readonly InversionAllowance[] = [
      { file: FILE, id: "evt-gone", previousId: "evt-missing", rationale: "stale." },
    ];
    const content = stream(event("evt-base-1", "2026-08-01T00:00:00.000Z"));

    expect(scan(content, allowances)).toEqual([
      {
        file: FILE,
        line: 0,
        message:
          "unmatched inversion allowance evt-missing -> evt-gone; the pair no longer exists, so remove it",
        rule: "unmatched-inversion-allowance",
      },
    ]);
  });

  test("flags malformed JSON and non-object lines", () => {
    const content = stream(event("evt-base-1", "2026-08-01T00:00:00.000Z"), "{not json", "[1, 2]");

    expect(scan(content)).toEqual([
      { file: FILE, line: 2, message: "line is not valid JSON", rule: "invalid-json" },
      { file: FILE, line: 3, message: "line must be a JSON object", rule: "not-an-object" },
    ]);
  });

  test("flags a stream that does not end with a newline", () => {
    const content = event("evt-base-1", "2026-08-01T00:00:00.000Z");

    expect(scan(content)).toEqual([
      {
        file: FILE,
        line: 0,
        message:
          "append-only stream must end with a newline so appended records cannot join the last line",
        rule: "missing-trailing-newline",
      },
    ]);
  });

  test("flags records without an id or a usable timestamp", () => {
    const content = stream(JSON.stringify({ payload: {} }), JSON.stringify({ createdAt: "nope", id: "evt-1" }));

    expect(scan(content)).toEqual([
      { file: FILE, line: 1, message: "record requires a non-empty string id", rule: "missing-id" },
      { file: FILE, line: 1, message: "record requires one of createdAt, appliedAt", rule: "missing-timestamp" },
      { file: FILE, line: 2, message: "timestamp nope is not a parseable date", rule: "invalid-timestamp" },
    ]);
  });

  test("reads appliedAt for history and release streams", () => {
    const historyFile = ".skillset/changes/history.jsonl";
    const content = stream(
      JSON.stringify({ appliedAt: "2026-08-02T00:00:00.000Z", id: "rec-2" }),
      JSON.stringify({ appliedAt: "2026-08-01T00:00:00.000Z", id: "rec-1" })
    );

    expect(scanChangeStreams([{ content, file: historyFile }], [])).toEqual([
      {
        file: historyFile,
        line: 2,
        message: "record rec-1 is older than the record above it (rec-2)",
        rule: "timestamp-inversion",
      },
    ]);
  });

  test("ignores allowances recorded for files that were not scanned", () => {
    const allowances: readonly InversionAllowance[] = [
      { file: ".skillset/changes/releases.jsonl", id: "a", previousId: "b", rationale: "other file." },
    ];

    expect(scan(stream(event("evt-base-1", "2026-08-01T00:00:00.000Z")), allowances)).toEqual([]);
  });

  test("parses git check-attr merge output", () => {
    const attributes = parseMergeAttributes(
      ".skillset/changes/ledger.jsonl: merge: union\n.skillset/changes/state.json: merge: unspecified\n"
    );

    expect(attributes.get(".skillset/changes/ledger.jsonl")).toBe("union");
    expect(attributes.get(".skillset/changes/state.json")).toBe("unspecified");
  });

  test("records every pre-existing inversion against a committed stream path", () => {
    expect(CHANGE_STREAM_PATHSPEC).toBe(".skillset/changes/*.jsonl");
    expect(INVERSION_ALLOWANCES.length).toBeGreaterThan(0);
    for (const allowance of INVERSION_ALLOWANCES) {
      expect(allowance.file.startsWith(".skillset/changes/")).toBe(true);
      expect(allowance.rationale.length).toBeGreaterThan(0);
    }
  });
});
