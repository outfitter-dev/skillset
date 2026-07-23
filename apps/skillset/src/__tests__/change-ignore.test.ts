import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { expect, test } from "bun:test";

import { ignorePendingChange } from "../change-workflow";
import {
  createTestGitFixtureRoot,
  initializeTestGitRepository,
} from "../../../../scripts/test-helpers/git-remote";

test("SET-330 change ignore previews, preserves reason evidence, and remains idempotent", async () => {
  const root = await ignoreFixture();
  const skillPath = join(root, ".skillset/skills/demo/SKILL.md");
  await writeFile(skillPath, skill("Changed body."), "utf8");

  const added = await runCli(
    "change", "add", "--root", root, "--since", "HEAD", "--scope", "skill:demo", "--bump", "patch",
    "--reason", "This pending change is intentionally recorded before an explicit audit-only ignore decision."
  );
  expect(added.exitCode).toBe(0);
  const [changeFile] = (await readdir(join(root, ".skillset/changes"))).filter((path) => path.endsWith(".md"));
  if (changeFile === undefined) throw new Error(`missing change file from ${added.stdout}`);
  const ref = `@${changeFile.slice(0, -".md".length)}`;
  const shortRef = ref.slice(0, 7);

  const file = join(root, ".skillset/changes", changeFile);
  const ledger = join(root, ".skillset/changes/ledger.jsonl");
  const sourceBefore = await readFile(file, "utf8");
  const ledgerBefore = await readFile(ledger, "utf8");

  const preview = await runCli("change", "ignore", ref, "--root", root, "--json");
  expect(preview.exitCode).toBe(0);
  expect(jsonIgnore(preview.stdout)).toMatchObject({
    state: "planned",
    writes: [],
    report: { entry: { path: `.skillset/changes/${ref.slice(1)}.md`, ref } },
  });
  expect(await readFile(file, "utf8")).toBe(sourceBefore);
  expect(await readFile(ledger, "utf8")).toBe(ledgerBefore);

  const applied = await runCli("change", "ignore", ref, "--yes", "--root", root, "--json");
  expect(applied.exitCode).toBe(0);
  expect(jsonIgnore(applied.stdout)).toMatchObject({
    state: "written",
    writes: [".skillset/changes/ledger.jsonl"],
    report: { entry: { path: `.skillset/changes/${ref.slice(1)}.md`, ref } },
  });
  expect(await readFile(file, "utf8")).toBe(sourceBefore);
  const ledgerAfter = await readFile(ledger, "utf8");
  expect((ledgerAfter.match(/"type":"change.ignored"/gu) ?? [])).toHaveLength(1);

  const listed = await runCli("change", "list", "--root", root, "--json");
  expect(listed.exitCode).toBe(0);
  expect(JSON.parse(listed.stdout).data.entries).toEqual(expect.arrayContaining([
    expect.objectContaining({ ignored: true, ref: shortRef }),
  ]));
  expect((await runCli("change", "check", "--root", root, "--since", "HEAD")).exitCode).toBe(0);

  const release = await runCli("release", "plan", "--root", root);
  expect(release.exitCode).toBe(0);
  expect(release.stdout).toContain(`${shortRef} ignored patch skill: demo`);
  expect(release.stdout).not.toContain("skill: demo: 0.1.0 -> 0.1.1");

  const repeated = await runCli("change", "ignore", ref, "--yes", "--root", root, "--json");
  expect(repeated.exitCode).toBe(0);
  expect(jsonIgnore(repeated.stdout)).toMatchObject({ state: "planned", writes: [] });
  expect(await readFile(ledger, "utf8")).toBe(ledgerAfter);

  const appliedRelease = await runCli("release", "apply", "--yes", "--root", root);
  expect(appliedRelease.exitCode).toBe(0);
  const history = await runCli("change", "history", shortRef, "--root", root, "--json");
  expect(history.exitCode).toBe(0);
  expect(JSON.parse(history.stdout).data.entries).toEqual(expect.arrayContaining([
    expect.objectContaining({ ignored: true, ref: shortRef }),
  ]));
  expect(await Bun.file(join(root, ".skillset/skills/demo/CHANGELOG.md")).exists()).toBe(false);
});

test("SET-330 change ignore serializes concurrent confirmed dispositions", async () => {
  const root = await ignoreFixture();
  await writeFile(join(root, ".skillset/skills/demo/SKILL.md"), skill("Concurrent changed body."), "utf8");
  const added = await runCli(
    "change", "add", "--root", root, "--since", "HEAD", "--scope", "skill:demo", "--bump", "patch",
    "--reason", "This pending change proves concurrent intentional ignores append only one durable ledger disposition."
  );
  expect(added.exitCode).toBe(0);
  const [changeFile] = (await readdir(join(root, ".skillset/changes"))).filter((path) => path.endsWith(".md"));
  if (changeFile === undefined) throw new Error("missing change file");
  const ref = `@${changeFile.slice(0, -".md".length)}`;

  const results = await Promise.all(
    Array.from({ length: 8 }, () => runCli("change", "ignore", ref, "--yes", "--root", root, "--json"))
  );
  expect(results.every((result) => result.exitCode === 0)).toBe(true);
  const reports = results.map((result) => jsonIgnore(result.stdout));
  expect(reports.filter((report) => report.writes.length === 1)).toHaveLength(1);
  expect(reports.filter((report) => report.writes.length === 0)).toHaveLength(7);
  const ledger = await readFile(join(root, ".skillset/changes/ledger.jsonl"), "utf8");
  expect((ledger.match(/"type":"change.ignored"/gu) ?? [])).toHaveLength(1);
  expect(await Bun.file(join(root, ".skillset/changes/ledger.jsonl.lock")).exists()).toBe(false);
});

test("SET-330 change ignore records a ledger disposition when only the reason body says ignored", async () => {
  const root = await ignoreFixture();
  await writeFile(join(root, ".skillset/skills/demo/SKILL.md"), skill("Body-directive changed body."), "utf8");
  const added = await runCli(
    "change", "add", "--root", root, "--since", "HEAD", "--scope", "skill:demo", "--bump", "patch",
    "--reason", "This pending change has an authored ignored directive but still requires a durable audit disposition."
  );
  expect(added.exitCode).toBe(0);
  const [changeFile] = (await readdir(join(root, ".skillset/changes"))).filter((path) => path.endsWith(".md"));
  if (changeFile === undefined) throw new Error("missing change file");
  const ref = `@${changeFile.slice(0, -".md".length)}`;
  const file = join(root, ".skillset/changes", changeFile);
  await writeFile(file, `${(await readFile(file, "utf8")).trimEnd()}\nIgnored: true\n`, "utf8");

  const preview = jsonIgnore((await runCli("change", "ignore", ref, "--root", root, "--json")).stdout);
  expect(preview).toMatchObject({ report: { alreadyIgnored: false }, state: "planned", writes: [] });

  const applied = jsonIgnore((await runCli("change", "ignore", ref, "--yes", "--root", root, "--json")).stdout);
  expect(applied).toMatchObject({ report: { alreadyIgnored: false }, state: "written", writes: [".skillset/changes/ledger.jsonl"] });
  const ledger = join(root, ".skillset/changes/ledger.jsonl");
  const after = await readFile(ledger, "utf8");
  expect((after.match(/"type":"change.ignored"/gu) ?? [])).toHaveLength(1);

  const repeated = jsonIgnore((await runCli("change", "ignore", ref, "--yes", "--root", root, "--json")).stdout);
  expect(repeated).toMatchObject({ report: { alreadyIgnored: true }, state: "planned", writes: [] });
  expect(await readFile(ledger, "utf8")).toBe(after);
});

test("SET-330 change ignore replans immediately before append and rejects stale source evidence", async () => {
  const root = await ignoreFixture();
  const skillPath = join(root, ".skillset/skills/demo/SKILL.md");
  await writeFile(skillPath, skill("First race body."), "utf8");
  const added = await runCli(
    "change", "add", "--root", root, "--since", "HEAD", "--scope", "skill:demo", "--bump", "patch",
    "--reason", "This pending change proves ignore revalidates source evidence immediately before appending its disposition."
  );
  expect(added.exitCode).toBe(0);
  const [changeFile] = (await readdir(join(root, ".skillset/changes"))).filter((path) => path.endsWith(".md"));
  if (changeFile === undefined) throw new Error("missing change file");

  await expect(ignorePendingChange(root, {
    beforeOwnershipVerification: async () => writeFile(skillPath, skill("Second race body."), "utf8"),
    ref: `@${changeFile.slice(0, -".md".length)}`,
    since: "HEAD",
    write: true,
  })).rejects.toThrow("change-evidence-stale");
  const ledger = await readFile(join(root, ".skillset/changes/ledger.jsonl"), "utf8");
  expect(ledger).not.toContain('"type":"change.ignored"');
  expect(await Bun.file(join(root, ".skillset/changes/ledger.jsonl.lock")).exists()).toBe(false);
});

test("SET-330 change ignore fails without appending when the pending plan never stabilizes", async () => {
  const root = await ignoreFixture();
  await writeFile(join(root, ".skillset/skills/demo/SKILL.md"), skill("Unstable reason body."), "utf8");
  const added = await runCli(
    "change", "add", "--root", root, "--since", "HEAD", "--scope", "skill:demo", "--bump", "patch",
    "--reason", "This pending change begins with a valid reason before the stability retry regression changes it."
  );
  expect(added.exitCode).toBe(0);
  const [changeFile] = (await readdir(join(root, ".skillset/changes"))).filter((path) => path.endsWith(".md"));
  if (changeFile === undefined) throw new Error("missing change file");
  const file = join(root, ".skillset/changes", changeFile);
  let revision = 0;

  await expect(ignorePendingChange(root, {
    beforeFinalComparison: async () => {
      revision += 1;
      await writeFile(
        file,
        `This pending change remains valid but changes during stability comparison revision ${revision}.\n\nBump: patch\nScope: skill:demo\n`,
        "utf8"
      );
    },
    ref: `@${changeFile.slice(0, -".md".length)}`,
    since: "HEAD",
    write: true,
  })).rejects.toThrow("kept changing while change ignore was applying");
  expect(revision).toBe(3);
  const ledger = await readFile(join(root, ".skillset/changes/ledger.jsonl"), "utf8");
  expect(ledger).not.toContain('"type":"change.ignored"');
  expect(await Bun.file(join(root, ".skillset/changes/ledger.jsonl.lock")).exists()).toBe(false);
});

test("SET-330 change ignore requires an eligible pending reason-only entry", async () => {
  const root = await ignoreFixture();
  const skillPath = join(root, ".skillset/skills/demo/SKILL.md");
  await writeFile(skillPath, skill("Changed body."), "utf8");
  await mkdir(join(root, ".skillset/changes"), { recursive: true });
  await writeFile(
    join(root, ".skillset/changes/abcdef123456.md"),
    "This compatibility entry must migrate before Skillset can record an ignored ledger disposition.\n\nBump: patch\nScope: skill:demo\n",
    "utf8"
  );

  const invalid = await runCli("change", "ignore", "@abcdef", "--yes", "--root", root);
  expect(invalid.exitCode).toBe(1);
  expect(invalid.stderr).toContain("change-evidence-missing");
  expect(await Bun.file(join(root, ".skillset/changes/ledger.jsonl")).exists()).toBe(false);

  const frontmatter = await writeLegacyEntry(root);
  const legacy = await runCli("change", "ignore", "@fedcba", "--yes", "--root", root);
  expect(legacy.exitCode).toBe(1);
  expect(legacy.stderr).toContain("frontmatter pending entries must be migrated before they can be ignored");
  expect(await readFile(frontmatter, "utf8")).toContain("ignored: false");
  expect(await Bun.file(join(root, ".skillset/changes/ledger.jsonl")).exists()).toBe(false);

  const unsupported = await runCli("change", "ignore", "@abcdef", "--since", "HEAD", "--root", root);
  expect(unsupported.exitCode).toBe(1);
  expect(unsupported.stderr).toContain("change ignore only supports @ref, --ref, --yes, --json, and --root");
});

interface IgnoreJsonData {
  readonly report: { readonly entry?: { readonly path: string; readonly ref: string; readonly sourceUnits: readonly unknown[] } };
  readonly state: string;
  readonly writes: readonly string[];
}

function jsonIgnore(stdout: string): IgnoreJsonData {
  return (JSON.parse(stdout) as { readonly data: IgnoreJsonData }).data;
}

async function ignoreFixture(): Promise<string> {
  const disposableRoot = await createTestGitFixtureRoot(
    "skillset-change-ignore-"
  );
  const root = await mkdtemp(join(disposableRoot, "repo-"));
  await mkdir(join(root, ".skillset/skills/demo"), { recursive: true });
  await writeFile(join(root, "skillset.yaml"), "skillset:\n  name: ignore-test\n  version: 0.1.0\nclaude: true\ncodex: false\n", "utf8");
  await writeFile(join(root, ".skillset/skills/demo/SKILL.md"), skill("Baseline body."), "utf8");
  await initializeTestGitRepository(root, { disposableRoot });
  return root;
}

async function writeLegacyEntry(root: string): Promise<string> {
  const path = join(root, ".skillset/changes/fedcba123456.md");
  await writeFile(path, `---
id: fedcba123456
bump: patch
ignored: false
scope: skill:demo
evidence:
  - scope: skill:demo
    sourceHash: sha256:legacy
---

This legacy frontmatter entry must use the existing explicit migration workflow.
`, "utf8");
  return path;
}

function skill(body: string): string {
  return `---\nname: demo\ndescription: Demo.\nversion: 0.1.0\n---\n\n${body}\n`;
}

async function runCli(...args: readonly string[]): Promise<{ readonly exitCode: number; readonly stderr: string; readonly stdout: string }> {
  const proc = Bun.spawn({
    cmd: ["bun", join(import.meta.dir, "..", "cli.ts"), ...args],
    stderr: "pipe",
    stdout: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { exitCode, stderr, stdout };
}
