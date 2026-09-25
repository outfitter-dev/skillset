import { describe, expect, test } from "bun:test";
import { appendFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  CHANGE_STREAM_PATHSPEC,
  collectChangeStreamViolations,
  parseMergeAttributes,
  scanChangeStreams,
} from "../change-stream-guard";
import {
  createTestGitFixtureRoot,
  initializeTestGitRepository,
  runTestGit,
} from "../test-helpers/git-remote";

const FILE = ".skillset/changes/ledger.jsonl";

function event(id: string, createdAt: string): string {
  return JSON.stringify({ createdAt, id, payload: {}, schemaVersion: 1, type: "reason.created" });
}

function stream(...lines: readonly string[]): string {
  return `${lines.join("\n")}\n`;
}

function scan(content: string, trunkContent?: string) {
  return scanChangeStreams([{ content, file: FILE, ...(trunkContent === undefined ? {} : { trunkContent }) }]);
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
      { file: FILE, line: 1, message: "record requires one of createdAt, appliedAt, amendedAt", rule: "missing-timestamp" },
      { file: FILE, line: 2, message: "timestamp nope is not a parseable date", rule: "invalid-timestamp" },
    ]);
  });

  test("accepts appliedAt and amendedAt as the record timestamp", () => {
    const content = stream(
      JSON.stringify({ appliedAt: "2026-08-02T00:00:00.000Z", id: "rec-2" }),
      JSON.stringify({ amendedAt: "2026-08-01T00:00:00.000Z", id: "chg-1" })
    );

    expect(scan(content)).toEqual([]);
  });

  test("accepts a branch that only appends after trunk's records", () => {
    const trunk = stream(
      event("evt-base-1", "2026-08-01T00:00:00.000Z"),
      event("evt-base-2", "2026-08-02T00:00:00.000Z")
    );

    expect(scan(`${trunk}${stream(event("evt-ours-1", "2026-08-03T00:00:00.000Z"))}`, trunk)).toEqual([]);
  });

  test("accepts an appended block older than trunk's tail", () => {
    const trunk = stream(
      event("evt-base-1", "2026-08-01T00:00:00.000Z"),
      event("evt-trunk-newer", "2026-08-05T00:00:00.000Z")
    );
    const branch = `${trunk}${stream(
      event("evt-ours-1", "2026-08-02T00:00:00.000Z"),
      event("evt-ours-2", "2026-08-03T00:00:00.000Z")
    )}`;

    expect(scan(branch, trunk)).toEqual([]);
  });

  test("flags a branch that reorders trunk's records at the first divergent line", () => {
    const trunk = stream(
      event("evt-base-1", "2026-08-01T00:00:00.000Z"),
      event("evt-base-2", "2026-08-02T00:00:00.000Z"),
      event("evt-base-3", "2026-08-03T00:00:00.000Z")
    );
    const branch = stream(
      event("evt-base-1", "2026-08-01T00:00:00.000Z"),
      event("evt-base-3", "2026-08-03T00:00:00.000Z"),
      event("evt-base-2", "2026-08-02T00:00:00.000Z")
    );

    expect(scan(branch, trunk)).toEqual([
      {
        file: FILE,
        line: 2,
        message:
          "line 2 does not match trunk record evt-base-2; keep trunk's records in their original order and append new records after them",
        rule: "trunk-prefix-divergence",
      },
    ]);
  });

  test("flags a branch that deletes a trunk record", () => {
    const trunk = stream(
      event("evt-base-1", "2026-08-01T00:00:00.000Z"),
      event("evt-base-2", "2026-08-02T00:00:00.000Z")
    );
    const branch = stream(event("evt-base-1", "2026-08-01T00:00:00.000Z"));

    expect(scan(branch, trunk)).toEqual([
      {
        file: FILE,
        line: 2,
        message:
          "trunk record evt-base-2 at line 2 is missing; keep trunk's records in their original order and append new records after them",
        rule: "trunk-prefix-divergence",
      },
    ]);
  });

  test("checks the trunk prefix against a real merge-base", async () => {
    const disposableRoot = await createTestGitFixtureRoot("skillset-change-stream-guard-");
    const root = join(disposableRoot, "repo");
    const ledger = join(root, FILE);
    const trunk = stream(
      event("evt-base-1", "2026-08-01T00:00:00.000Z"),
      event("evt-base-2", "2026-08-05T00:00:00.000Z")
    );
    await mkdir(join(root, ".skillset/changes"), { recursive: true });
    await writeFile(join(root, ".gitattributes"), ".skillset/changes/*.jsonl merge=union\n", "utf8");
    await writeFile(ledger, trunk, "utf8");
    await initializeTestGitRepository(root, { disposableRoot });
    await runTestGit(root, "switch", "--quiet", "-c", "feature");

    await writeFile(ledger, `${trunk}${stream(event("evt-ours-1", "2026-08-02T00:00:00.000Z"))}`, "utf8");
    expect(await collectChangeStreamViolations({ rootPath: root, trunkRef: "main" })).toEqual({
      scanned: 1,
      violations: [],
    });

    await writeFile(
      ledger,
      stream(
        event("evt-base-2", "2026-08-05T00:00:00.000Z"),
        event("evt-base-1", "2026-08-01T00:00:00.000Z")
      ),
      "utf8"
    );
    expect(await collectChangeStreamViolations({ rootPath: root, trunkRef: "main" })).toEqual({
      scanned: 1,
      violations: [{
        file: FILE,
        line: 1,
        message:
          "line 1 does not match trunk record evt-base-1; keep trunk's records in their original order and append new records after them",
        rule: "trunk-prefix-divergence",
      }],
    });
  });

  test("passes a real union restack whose appended block is older than trunk's tail", async () => {
    const { ledger, root } = await gitStreamFixture(stream(
      event("evt-base-1", "2026-08-01T00:00:00.000Z"),
      event("evt-base-2", "2026-08-02T00:00:00.000Z")
    ));
    await runTestGit(root, "switch", "--quiet", "-c", "feature");
    await appendFile(ledger, stream(event("evt-branch-1", "2026-08-03T00:00:00.000Z")), "utf8");
    await runTestGit(root, "commit", "--quiet", "--all", "-m", "branch append");
    await runTestGit(root, "switch", "--quiet", "main");
    await appendFile(ledger, stream(event("evt-trunk-3", "2026-08-09T00:00:00.000Z")), "utf8");
    await runTestGit(root, "commit", "--quiet", "--all", "-m", "trunk append");
    await runTestGit(root, "switch", "--quiet", "feature");
    await runTestGit(root, "rebase", "--quiet", "main");

    expect((await readFile(ledger, "utf8")).split("\n").filter(Boolean).map((line) => (JSON.parse(line) as { id: string }).id))
      .toEqual(["evt-base-1", "evt-base-2", "evt-trunk-3", "evt-branch-1"]);
    expect(await collectChangeStreamViolations({ rootPath: root, trunkRef: "main" })).toEqual({
      scanned: 1,
      violations: [],
    });
  });

  test("flags a trunk stream deleted from the working copy", async () => {
    const { ledger, root } = await gitStreamFixture(stream(event("evt-base-1", "2026-08-01T00:00:00.000Z")));
    await runTestGit(root, "switch", "--quiet", "-c", "feature");
    await rm(ledger);

    expect(await collectChangeStreamViolations({ rootPath: root, trunkRef: "main" })).toEqual({
      scanned: 1,
      violations: [{
        file: FILE,
        line: 1,
        message:
          "trunk record evt-base-1 at line 1 is missing; keep trunk's records in their original order and append new records after them",
        rule: "trunk-prefix-divergence",
      }],
    });
  });

  test("fails loudly with a reason when the trunk merge-base cannot be resolved", async () => {
    const { root } = await gitStreamFixture(stream(event("evt-base-1", "2026-08-01T00:00:00.000Z")));
    await runTestGit(root, "switch", "--quiet", "--orphan", "unrelated");
    await runTestGit(root, "commit", "--quiet", "--allow-empty", "-m", "unrelated history");
    await runTestGit(root, "switch", "--quiet", "main");

    const failure = await collectChangeStreamViolations({ rootPath: root, trunkRef: "unrelated" }).then(
      () => undefined,
      (error: unknown) => (error instanceof Error ? error.message : String(error))
    );
    expect(failure).toContain("cannot find a merge-base between HEAD and unrelated");
    expect(failure).toContain("fetch the trunk with full history");
  });

  test("names the pathspec that mirrors .gitattributes", () => {
    expect(CHANGE_STREAM_PATHSPEC).toBe(".skillset/changes/*.jsonl");
  });

  test("parses git check-attr merge output", () => {
    const attributes = parseMergeAttributes(
      ".skillset/changes/ledger.jsonl: merge: union\n.skillset/changes/state.json: merge: unspecified\n"
    );

    expect(attributes.get(".skillset/changes/ledger.jsonl")).toBe("union");
    expect(attributes.get(".skillset/changes/state.json")).toBe("unspecified");
  });
});

async function gitStreamFixture(trunk: string): Promise<{ readonly ledger: string; readonly root: string }> {
  const disposableRoot = await createTestGitFixtureRoot("skillset-change-stream-guard-");
  const root = join(disposableRoot, "repo");
  const ledger = join(root, FILE);
  await mkdir(join(root, ".skillset/changes"), { recursive: true });
  await writeFile(join(root, ".gitattributes"), ".skillset/changes/*.jsonl merge=union\n", "utf8");
  await writeFile(ledger, trunk, "utf8");
  await initializeTestGitRepository(root, { disposableRoot });
  return { ledger, root };
}
