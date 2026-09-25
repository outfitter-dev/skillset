import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { expect, test } from "bun:test";

import { addChangeEntry } from "../change-workflow";
import { applyRelease } from "../release";
import {
  createTestGitFixtureRoot,
  initializeTestGitRepository,
} from "../../../../scripts/test-helpers/git-remote";

test("SET-636 two concurrent successful adds preserve both ledger record sets", async () => {
  const root = await mutationFixture();
  await commitFixture(root);
  const firstAcquired = join(root, "first-acquired");
  const firstRelease = join(root, "first-release");
  const secondContended = join(root, "second-contended");
  const first = spawnAdd(root, {
    acquired: firstAcquired,
    reason: "First concurrent add records an independently auditable pending reason.",
    release: firstRelease,
  });
  await waitForFile(firstAcquired);
  const secondAcquired = join(root, "second-acquired");
  const second = spawnAdd(root, {
    acquired: secondAcquired,
    contended: secondContended,
    reason: "Second concurrent add records a stacked independently auditable pending reason.",
  });
  await waitForFile(secondContended);
  expect(await Bun.file(secondAcquired).exists()).toBe(false);
  await Bun.write(firstRelease, "release\n");
  for (const proc of [first, second]) {
    const [stderr, exitCode] = await Promise.all([readSpawnText(proc.stderr), proc.exited]);
    expect(exitCode, stderr).toBe(0);
  }

  const events = ledgerEvents(await readFile(join(root, ".skillset/changes/ledger.jsonl"), "utf8"));
  const reasons = events.filter((event) => event.type === "reason.created").map((event) => event.payload.reason);
  expect(reasons).toEqual([
    "First concurrent add records an independently auditable pending reason.",
    "Second concurrent add records a stacked independently auditable pending reason.",
  ]);
  expect(events.filter((event) => event.type === "change.covered")).toHaveLength(2);
});

test("SET-636 a failed release keeps a concurrent add that waited on the lock", async () => {
  const root = await mutationFixture();
  await writeFile(join(root, ".skillset/skills/demo/SKILL.md"), skill("Changed before a racing release."), "utf8");
  await commitFixture(root);
  await addChangeEntry(root, {
    bump: "patch",
    reason: {
      kind: "inline",
      value: "Pending change that a failed release must not apply after rollback.",
    },
    scopes: ["skill:demo"],
  });
  const ledgerBefore = await readFile(join(root, ".skillset/changes/ledger.jsonl"), "utf8");
  const releaseAcquired = join(root, "release-acquired");
  const releaseFail = join(root, "release-fail");
  const addContended = join(root, "add-contended");
  const addAcquired = join(root, "add-acquired");
  const release = spawnRelease(root, {
    acquired: releaseAcquired,
    fail: releaseFail,
  });
  await waitForFile(releaseAcquired);
  const add = spawnAdd(root, {
    acquired: addAcquired,
    contended: addContended,
    reason: "Unrelated add that must survive a failed concurrent release rollback.",
  });
  await waitForFile(addContended);
  expect(await Bun.file(addAcquired).exists()).toBe(false);
  await Bun.write(releaseFail, "fail\n");
  const [releaseStderr, releaseExit] = await Promise.all([
    readSpawnText(release.stderr),
    release.exited,
  ]);
  expect(releaseExit, releaseStderr).not.toBe(0);
  expect(releaseStderr).toContain("test: release failed after append");
  const [addStderr, addExit] = await Promise.all([readSpawnText(add.stderr), add.exited]);
  expect(addExit, addStderr).toBe(0);

  const ledger = await readFile(join(root, ".skillset/changes/ledger.jsonl"), "utf8");
  expect(ledger.startsWith(ledgerBefore)).toBe(true);
  const events = ledgerEvents(ledger);
  expect(events.some((event) => event.type === "release.applied")).toBe(false);
  expect(events.some((event) => event.payload.reason === "Unrelated add that must survive a failed concurrent release rollback.")).toBe(true);
  expect(await Bun.file(join(root, ".skillset/changes/history.jsonl")).exists()).toBe(false);
  expect(await Bun.file(join(root, ".skillset/changes/releases.jsonl")).exists()).toBe(false);
});

test("SET-636 release stamps JSONL with a timestamp that does not invert a newer tail", async () => {
  const root = await mutationFixture();
  await writeFile(join(root, ".skillset/skills/demo/SKILL.md"), skill("Changed before a future-dated ledger tail."), "utf8");
  await commitFixture(root);
  await addChangeEntry(root, {
    bump: "patch",
    reason: {
      kind: "inline",
      value: "Pending change used to prove release timestamps follow the current tail.",
    },
    scopes: ["skill:demo"],
  });
  const ledgerPath = join(root, ".skillset/changes/ledger.jsonl");
  await writeFile(
    join(root, ".skillset/changes/history.jsonl"),
    `${JSON.stringify({
      appliedAt: "2099-01-01T00:00:00.000Z",
      bump: "patch",
      id: "future-history-tail",
      reason: "Future-dated history tail that live writers must not invert.",
      scopes: ["skill:demo"],
    })}\n`,
    "utf8"
  );

  let stamped: string | undefined;
  await expect(applyRelease(root, {
    afterAppend: async () => {
      const applied = ledgerEvents(await readFile(ledgerPath, "utf8")).find((event) => event.type === "release.applied");
      stamped = applied?.createdAt;
    },
    beforeBuild: async () => {
      throw new Error("test: stop after timestamp check");
    },
  })).rejects.toThrow("test: stop after timestamp check");

  expect(stamped).toBeDefined();
  expect(Date.parse(stamped ?? "")).toBeGreaterThanOrEqual(Date.parse("2099-01-01T00:00:00.000Z"));
});

test("SET-636 failed release rollback removes only transaction-owned JSONL records", async () => {
  const root = await mutationFixture();
  await writeFile(join(root, ".skillset/skills/demo/SKILL.md"), skill("Changed before an injected foreign append."), "utf8");
  await commitFixture(root);
  const added = await addChangeEntry(root, {
    bump: "patch",
    reason: {
      kind: "inline",
      value: "Pending change used to prove release rollback is record-owned.",
    },
    scopes: ["skill:demo"],
  });
  const foreign = JSON.stringify({
    createdAt: "2026-09-22T21:00:00.000Z",
    id: "evt-foreign-concurrent-append",
    payload: { reason: "Foreign append after the release snapshot.", reasonId: "foreign" },
    schemaVersion: 1,
    type: "reason.created",
  });

  await expect(applyRelease(root, {
    afterAppend: async () => {
      await writeFile(
        join(root, ".skillset/changes/ledger.jsonl"),
        `${await readFile(join(root, ".skillset/changes/ledger.jsonl"), "utf8")}${foreign}\n`,
        "utf8"
      );
    },
    beforeBuild: async () => {
      throw new Error("test: release failed after a foreign ledger append");
    },
  })).rejects.toThrow("test: release failed after a foreign ledger append");

  const ledger = await readFile(join(root, ".skillset/changes/ledger.jsonl"), "utf8");
  expect(ledger).toContain(foreign);
  expect(ledger).toContain(added.entry.id);
  expect(ledgerEvents(ledger).some((event) => event.type === "release.applied")).toBe(false);
  expect(await Bun.file(join(root, added.entry.path)).exists()).toBe(true);
  expect(await Bun.file(join(root, ".skillset/changes/history.jsonl")).exists()).toBe(false);
});

function spawnAdd(
  root: string,
  options: {
    readonly acquired?: string;
    readonly contended?: string;
    readonly reason: string;
    readonly release?: string;
  }
): ReturnType<typeof Bun.spawn> {
  return Bun.spawn({
    cmd: [
      "bun",
      "-e",
      [
        'import { addChangeEntry } from "./apps/skillset/src/change-workflow.ts";',
        "const marker = async (path) => { if (path) await Bun.write(path, 'ready\\n'); };",
        "const wait = async (path) => { while (!(await Bun.file(path).exists())) await Bun.sleep(1); };",
        "await addChangeEntry(process.env.ROOT, {",
        "  bump: 'patch',",
        "  lock: {",
        "    afterLockAcquired: async () => {",
        "      await marker(process.env.ACQUIRED);",
        "      if (process.env.RELEASE) await wait(process.env.RELEASE);",
        "    },",
        "    onLockContention: process.env.CONTENDED ? async () => marker(process.env.CONTENDED) : undefined,",
        "    timeoutMs: 10_000,",
        "  },",
        "  reason: { kind: 'inline', value: process.env.REASON },",
        "  scopes: ['skill:demo'],",
        "});",
      ].join("\n"),
    ],
    cwd: join(import.meta.dir, "../../../.."),
    env: {
      ...process.env,
      ...(options.acquired === undefined ? {} : { ACQUIRED: options.acquired }),
      ...(options.contended === undefined ? {} : { CONTENDED: options.contended }),
      REASON: options.reason,
      ...(options.release === undefined ? {} : { RELEASE: options.release }),
      ROOT: root,
    },
    stderr: "pipe",
    stdout: "pipe",
  });
}

function spawnRelease(
  root: string,
  options: {
    readonly acquired: string;
    readonly fail: string;
  }
): ReturnType<typeof Bun.spawn> {
  return Bun.spawn({
    cmd: [
      "bun",
      "-e",
      [
        'import { applyRelease } from "./apps/skillset/src/release.ts";',
        "const marker = async (path) => { await Bun.write(path, 'ready\\n'); };",
        "const wait = async (path) => { while (!(await Bun.file(path).exists())) await Bun.sleep(1); };",
        "try {",
        "  await applyRelease(process.env.ROOT, {",
        "    beforeBuild: async () => {",
        "      await wait(process.env.FAIL);",
        "      throw new Error('test: release failed after append');",
        "    },",
        "    lock: {",
        "      afterLockAcquired: async () => marker(process.env.ACQUIRED),",
        "      timeoutMs: 10_000,",
        "    },",
        "  });",
        "} catch (error) {",
        "  console.error(error instanceof Error ? error.message : String(error));",
        "  process.exit(1);",
        "}",
      ].join("\n"),
    ],
    cwd: join(import.meta.dir, "../../../.."),
    env: {
      ...process.env,
      ACQUIRED: options.acquired,
      FAIL: options.fail,
      ROOT: root,
    },
    stderr: "pipe",
    stdout: "pipe",
  });
}

async function mutationFixture(): Promise<string> {
  const disposableRoot = await createTestGitFixtureRoot("skillset-ledger-mutation-");
  const root = await mkdtemp(join(disposableRoot, "repo-"));
  await mkdir(join(root, ".skillset/skills/demo"), { recursive: true });
  await writeFile(join(root, "skillset.yaml"), "skillset:\n  name: ledger-mutation\nclaude: true\ncodex: false\n", "utf8");
  await writeFile(join(root, ".skillset/skills/demo/SKILL.md"), skill("Baseline body."), "utf8");
  return root;
}

async function commitFixture(root: string): Promise<void> {
  await initializeTestGitRepository(root, { disposableRoot: join(root, "..") });
}

function ledgerEvents(ledger: string): readonly {
  readonly createdAt?: string;
  readonly payload: { readonly reason?: string };
  readonly type: string;
}[] {
  return ledger
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as {
      readonly createdAt?: string;
      readonly payload: { readonly reason?: string };
      readonly type: string;
    });
}

async function readSpawnText(stream: number | ReadableStream<Uint8Array> | undefined): Promise<string> {
  if (stream === undefined || typeof stream === "number") return "";
  return new Response(stream).text();
}

async function waitForFile(path: string): Promise<void> {
  for (let attempt = 0; attempt < 5_000; attempt += 1) {
    if (await Bun.file(path).exists()) return;
    await Bun.sleep(1);
  }
  throw new Error(`timed out waiting for test marker ${path}`);
}

function skill(body: string, name = "demo"): string {
  return `---\nname: ${name}\ndescription: Demo.\n---\n\n${body}\n`;
}
