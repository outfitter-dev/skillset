import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { expect, test } from "bun:test";
import { buildSkillset } from "@skillset/core";

import { createTestFixtureRoot } from "../../../../scripts/test-helpers/fixture-root";

test("SET-660 two concurrent drafts of different skills keep both ledger events", async () => {
  const root = await createTestFixtureRoot("skillset-lifecycle-lock-");
  await writeFixture(root, {
    ".skillset/skills/alpha/SKILL.md": skill("alpha"),
    ".skillset/skills/beta/SKILL.md": skill("beta"),
    "skillset.yaml": "skillset:\n  name: lifecycle-lock\ncompile:\n  targets: [codex]\n",
  });
  await buildSkillset(root);
  const firstAcquired = join(root, "first-acquired");
  const firstRelease = join(root, "first-release");
  const secondContended = join(root, "second-contended");
  const secondAcquired = join(root, "second-acquired");

  const first = spawnDraft(root, ".skillset/skills/alpha", {
    acquired: firstAcquired,
    release: firstRelease,
  });
  await waitForFile(firstAcquired);
  const second = spawnDraft(root, ".skillset/skills/beta", {
    acquired: secondAcquired,
    contended: secondContended,
  });
  await waitForFile(secondContended);
  expect(await Bun.file(secondAcquired).exists()).toBe(false);
  await Bun.write(firstRelease, "release\n");
  for (const proc of [first, second]) {
    const [stderr, exitCode] = await Promise.all([readText(proc.stderr), proc.exited]);
    expect(exitCode, stderr).toBe(0);
  }

  const drafted = (await readFile(join(root, ".skillset/changes/ledger.jsonl"), "utf8"))
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as { readonly payload: { readonly shipped?: string }; readonly type: string })
    .filter((event) => event.type === "source.drafted")
    .map((event) => event.payload.shipped);
  expect(drafted).toEqual(["skill:alpha", "skill:beta"]);
  expect(await Bun.file(join(root, ".skillset/skills/_drafts/alpha/SKILL.md")).exists()).toBe(true);
  expect(await Bun.file(join(root, ".skillset/skills/_drafts/beta/SKILL.md")).exists()).toBe(true);
});

function spawnDraft(
  root: string,
  shippedPath: string,
  options: { readonly acquired: string; readonly contended?: string; readonly release?: string }
): ReturnType<typeof Bun.spawn> {
  return Bun.spawn({
    cmd: [
      "bun",
      "-e",
      [
        'import { runDraftCommand } from "./apps/skillset/src/draft-cli.ts";',
        'import { withLifecycleLedgerLock } from "./apps/skillset/src/lifecycle-ledger-lock.ts";',
        "const marker = async (path) => { if (path) await Bun.write(path, 'ready\\n'); };",
        "const wait = async (path) => { while (!(await Bun.file(path).exists())) await Bun.sleep(1); };",
        "await runDraftCommand(",
        "  { jsonOutput: true, rootPath: process.env.ROOT, shippedPath: process.env.SHIPPED, yes: true },",
        "  {",
        "    ledgerLock: (rootPath, operation) => withLifecycleLedgerLock(rootPath, {",
        "      afterLockAcquired: async () => {",
        "        await marker(process.env.ACQUIRED);",
        "        if (process.env.RELEASE) await wait(process.env.RELEASE);",
        "      },",
        "      onLockContention: process.env.CONTENDED ? async () => marker(process.env.CONTENDED) : undefined,",
        "      timeoutMs: 20_000,",
        "    }, operation),",
        "    write: () => undefined,",
        "  }",
        ");",
      ].join("\n"),
    ],
    cwd: join(import.meta.dir, "../../../.."),
    env: {
      ...process.env,
      ACQUIRED: options.acquired,
      ...(options.contended === undefined ? {} : { CONTENDED: options.contended }),
      ...(options.release === undefined ? {} : { RELEASE: options.release }),
      ROOT: root,
      SHIPPED: shippedPath,
    },
    stderr: "pipe",
    stdout: "pipe",
  });
}

async function writeFixture(root: string, files: Readonly<Record<string, string>>): Promise<void> {
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), content, "utf8");
  }
}

function skill(name: string): string {
  return `---\nname: ${name}\ndescription: ${name} skill.\n---\n\n${name} body.\n`;
}

async function readText(stream: number | ReadableStream<Uint8Array> | undefined): Promise<string> {
  if (stream === undefined || typeof stream === "number") return "";
  return new Response(stream).text();
}

async function waitForFile(path: string): Promise<void> {
  for (let attempt = 0; attempt < 10_000; attempt += 1) {
    if (await Bun.file(path).exists()) return;
    await Bun.sleep(1);
  }
  throw new Error(`timed out waiting for test marker ${path}`);
}
