import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { expect, test } from "bun:test";

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
