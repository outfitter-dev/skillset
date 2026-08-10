import { expect, test } from "bun:test";
import { mkdir, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  createTestGitFixtureRoot,
  createTestGitRemote,
  runTestGit,
} from "../../test-helpers/git-remote";
import {
  discoverMarkdownChanges,
  isMigrationDocumentationPath,
  parseGitNameStatus,
  parseMigrationMap,
  validateMigrationAccounting,
  validateMigrationMap,
} from "../migrations";

const existing = new Set(["docs/new.md", "docs/part-a.md", "docs/part-b.md"]);
const pathExists = (path: string): boolean => existing.has(path);

test("accepts a valid version 1 migration map", () => {
  const result = validateMigrationMap(
    {
      entries: [
        {
          from: "docs/old.md",
          primary: "docs/new.md",
          status: "moved",
          successors: ["docs/new.md"],
        },
        { from: "docs/removed.md", status: "deleted" },
      ],
      schemaVersion: 1,
    },
    { pathExists }
  );

  expect(result.diagnostics).toEqual([]);
  expect(result.map?.entries).toHaveLength(2);
});

test("reports malformed JSON and version 1 schema violations", () => {
  expect(parseMigrationMap("{", { pathExists }).diagnostics[0]?.subject).toBe(
    "json"
  );

  const result = validateMigrationMap(
    {
      entries: [null, { extra: true, from: "docs/old.md", status: "unknown" }],
      extra: true,
      schemaVersion: 2,
    },
    { pathExists }
  );

  expect(result.diagnostics.map(({ subject }) => subject)).toEqual([
    "document.extra",
    "schemaVersion",
    "entries[0]",
    "entries[1].extra",
    "entries[1].status",
  ]);
  expect(result.map).toBeUndefined();
});

test("rejects unsafe, non-Markdown, duplicate, and still-existing sources", () => {
  const result = validateMigrationMap(
    {
      entries: [
        { from: "../old.md", status: "deleted" },
        { from: "/tmp/old.md", status: "deleted" },
        { from: "C:/outside.md", status: "deleted" },
        { from: "docs\\old.md", status: "deleted" },
        { from: "docs/old.txt", status: "deleted" },
        { from: ".skillset/rules/old.md", status: "deleted" },
        { from: "docs/new.md", status: "deleted" },
        { from: "docs/repeated.md", status: "deleted" },
        { from: "docs/repeated.md", status: "deleted" },
      ],
      schemaVersion: 1,
    },
    { pathExists }
  );

  expect(result.diagnostics.map(({ subject }) => subject)).toEqual([
    "entries[0].from",
    "entries[1].from",
    "entries[2].from",
    "entries[3].from",
    "entries[4].from",
    "entries[5].from",
    "entries[6].from",
    "source:docs/repeated.md",
  ]);
});

test("rejects control characters in migration paths", () => {
  const result = validateMigrationMap(
    {
      entries: [{ from: "docs/bad\u0000path.md", status: "deleted" }],
      schemaVersion: 1,
    },
    { pathExists }
  );
  expect(result.diagnostics).toEqual([
    expect.objectContaining({ subject: "entries[0].from" }),
  ]);
});

test("validates destination requirements and existence", () => {
  const result = validateMigrationMap(
    {
      entries: [
        { from: "docs/no-primary.md", status: "moved" },
        {
          from: "docs/missing.md",
          primary: "docs/absent.md",
          status: "archived",
          successors: ["docs/absent.md"],
        },
        {
          from: "docs/split.md",
          primary: "docs/part-a.md",
          status: "split",
          successors: ["docs/part-b.md", "docs/part-b.md"],
        },
        {
          from: "docs/deleted.md",
          primary: "docs/new.md",
          status: "deleted",
          successors: [],
        },
      ],
      schemaVersion: 1,
    },
    { pathExists }
  );

  expect(result.diagnostics.map(({ subject }) => subject)).toEqual([
    "entries[0].primary",
    "entries[1].primary",
    "entries[1].successors:docs/absent.md",
    "entries[2].successors:docs/part-b.md",
    "entries[2].successors",
    "entries[3].primary",
    "entries[3].successors",
  ]);
});

test("parses NUL-delimited Git name-status output", () => {
  expect(
    parseGitNameStatus(
      "D\0docs/deleted.md\0R087\0docs/old.md\0docs/new.md\0M\0README.md\0"
    )
  ).toEqual([
    { path: "docs/deleted.md", status: "D" },
    {
      from: "docs/old.md",
      status: "R087",
      to: "docs/new.md",
    },
    { path: "README.md", status: "M" },
  ]);
  expect(() => parseGitNameStatus("R101\0docs/a.md\0docs/b.md\0")).toThrow(
    "malformed"
  );
  expect(() => parseGitNameStatus("D\0")).toThrow("malformed");
});

test("requires migration entries for deletions and old rename paths", () => {
  const changes = parseGitNameStatus(
    "D\0docs/deleted.md\0D\0docs/covered.md\0R100\0docs/old.md\0docs/new.md\0D\0.changeset/note.md\0D\0AGENTS.md\0A\0docs/added.md\0"
  );
  const diagnostics = validateMigrationAccounting(
    [{ from: "docs/covered.md", status: "deleted" }],
    changes
  );

  expect(diagnostics.map(({ subject }) => subject)).toEqual([
    "unmapped:docs/deleted.md",
    "unmapped:docs/old.md",
  ]);
});

test("classifies only repository documentation migration paths", () => {
  for (const path of [
    "README.md",
    "CONTRIBUTING.md",
    "SECURITY.md",
    "docs/guide.md",
    "examples/first-author/README.md",
  ]) {
    expect(isMigrationDocumentationPath(path)).toBe(true);
  }
  for (const path of [
    ".changeset/note.md",
    "AGENTS.md",
    "apps/skillset/README.md",
    "fixtures/example/README.md",
    "packages/registry/README.md",
  ]) {
    expect(isMigrationDocumentationPath(path)).toBe(false);
  }
});

test("accounts for rewritten deletions and clean renames through the same source record", () => {
  const entries = [
    {
      from: "docs/old.md",
      primary: "docs/new.md",
      status: "moved" as const,
      successors: ["docs/new.md"],
    },
  ];

  expect(
    validateMigrationAccounting(
      entries,
      parseGitNameStatus("D\0docs/old.md\0A\0docs/new.md\0")
    )
  ).toEqual([]);
  expect(
    validateMigrationAccounting(
      entries,
      parseGitNameStatus("R100\0docs/old.md\0docs/new.md\0")
    )
  ).toEqual([]);
  expect(
    validateMigrationAccounting(
      [{ from: "docs/old.md", status: "deleted" }],
      parseGitNameStatus("R100\0docs/old.md\0docs/new.md\0")
    )
  ).toEqual([expect.objectContaining({ subject: "rename:docs/old.md" })]);
  expect(
    validateMigrationAccounting(
      [
        {
          from: "docs/old.md",
          primary: "docs/unrelated.md",
          status: "moved",
          successors: ["docs/unrelated.md"],
        },
      ],
      parseGitNameStatus("R100\0docs/old.md\0docs/new.md\0")
    )
  ).toEqual([expect.objectContaining({ subject: "rename:docs/old.md" })]);
});

test("discovers Markdown renames and deletions from an isolated Git fixture", async () => {
  const disposableRoot = await createTestGitFixtureRoot(
    "skillset-docs-migrations-"
  );
  const workPath = path.join(disposableRoot, "work");
  await mkdir(path.join(workPath, "docs"), { recursive: true });
  await writeFile(path.join(workPath, "docs", "old.md"), "# Old\n", "utf-8");
  await writeFile(
    path.join(workPath, "docs", "deleted.md"),
    "# Deleted\n",
    "utf-8"
  );
  const remote = await createTestGitRemote(workPath, { disposableRoot });
  await runTestGit(workPath, "remote", "add", "origin", remote.remotePath);
  await runTestGit(workPath, "fetch", "origin");
  await runTestGit(workPath, "remote", "set-head", "origin", "main");

  await rename(
    path.join(workPath, "docs", "old.md"),
    path.join(workPath, "docs", "new.md")
  );
  await unlink(path.join(workPath, "docs", "deleted.md"));
  await runTestGit(workPath, "add", "--all");

  const commands: readonly string[][] = [];
  const mutableCommands = commands as string[][];
  const changes = await discoverMarkdownChanges(workPath, (command) => {
    mutableCommands.push([...command]);
    if (command[0]?.endsWith("scripts/git-trunk.sh")) {
      return Promise.resolve("origin/main\n");
    }
    expect(command[0]).toBe("git");
    return runTestGit(workPath, ...command.slice(1));
  });

  expect(commands[1]).toEqual(["git", "merge-base", "origin/main", "HEAD"]);
  expect(commands[2]).toEqual([
    "git",
    "diff",
    "--name-status",
    "-z",
    "-M",
    await runTestGit(workPath, "merge-base", "origin/main", "HEAD"),
    "--",
    "*.md",
  ]);
  expect(changes).toEqual([
    { path: "docs/deleted.md", status: "D" },
    {
      from: "docs/old.md",
      status: "R100",
      to: "docs/new.md",
    },
  ]);
});
