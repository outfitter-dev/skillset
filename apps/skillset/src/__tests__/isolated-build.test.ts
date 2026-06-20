import { expect, test } from "bun:test";
import { normalizeSkillsetFixtureFiles } from "../../../../scripts/test-helpers/skillset-config";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildSkillset, buildSkillsetResult, verifySkillset, diffSkillset, ISOLATED_OUT_ROOT } from "../build";

const DEMO_FIXTURE: Record<string, string> = {
  ".skillset/config.yaml": `
skillset:
  name: isolated-root
claude: true
codex: true
`,
  ".skillset/src/skills/demo/SKILL.md": `
---
name: demo
description: Demo.
---

Body.
`,
  ".skillset/src/rules/guide.md": `
---
name: guide
description: Guide.
---

Guidance body.
`,
};

const LIVE_SKILL = ".claude/skills/demo/SKILL.md";
const MIRROR_SKILL = join(ISOLATED_OUT_ROOT, LIVE_SKILL);

test("isolated build writes the full projection under the mirror only", async () => {
  const root = await fixture(DEMO_FIXTURE);

  const rendered = await buildSkillset(root, { isolated: true });

  expect(rendered.length).toBeGreaterThan(0);
  for (const file of rendered) {
    expect(file.path).toStartWith(`${ISOLATED_OUT_ROOT}/`);
  }
  expect(await exists(join(root, LIVE_SKILL))).toBe(false);
  expect(await exists(join(root, "AGENTS.md"))).toBe(false);
  expect(await exists(join(root, ".skillset.lock"))).toBe(false);
  expect(await exists(join(root, MIRROR_SKILL))).toBe(true);
  expect(await exists(join(root, ISOLATED_OUT_ROOT, "AGENTS.md"))).toBe(true);
  expect(await exists(join(root, ISOLATED_OUT_ROOT, ".skillset.lock"))).toBe(true);
  expect(await exists(join(root, ISOLATED_OUT_ROOT, ".claude/skills/.skillset.lock"))).toBe(true);
});

test("isolated build leaves a previous live build byte-unchanged", async () => {
  const root = await fixture(DEMO_FIXTURE);
  const liveRendered = await buildSkillset(root);
  const before = await hashPaths(root, liveRendered.map((file) => file.path));

  await buildSkillset(root, { isolated: true });

  const after = await hashPaths(root, liveRendered.map((file) => file.path));
  expect(after).toEqual(before);
});

test("isolated verify tracks the mirror while live generated-output verification tracks live output", async () => {
  const root = await fixture(DEMO_FIXTURE);
  await buildSkillset(root);
  await buildSkillset(root, { isolated: true });

  expect((await verifySkillset(root, { isolated: true })).checkedFiles).toBeGreaterThan(0);

  const mirrorPath = join(root, MIRROR_SKILL);
  await writeFile(mirrorPath, `${await readFile(mirrorPath, "utf8")}\nhand edit\n`);

  await expect(verifySkillset(root, { isolated: true })).rejects.toThrow(MIRROR_SKILL);
  expect((await verifySkillset(root)).checkedFiles).toBeGreaterThan(0);
});

test("isolated diff reports drift against the mirror only", async () => {
  const root = await fixture(DEMO_FIXTURE);
  await buildSkillset(root);
  await buildSkillset(root, { isolated: true });

  const mirrorPath = join(root, MIRROR_SKILL);
  await writeFile(mirrorPath, `${await readFile(mirrorPath, "utf8")}\nhand edit\n`);

  const isolatedDiff = await diffSkillset(root, { isolated: true });
  expect(isolatedDiff.changed).toEqual([MIRROR_SKILL]);
  expect(isolatedDiff.added).toEqual([]);
  expect(isolatedDiff.missing).toEqual([]);
  expect(isolatedDiff.removed).toEqual([]);

  const liveDiff = await diffSkillset(root);
  expect(liveDiff).toEqual({ added: [], changed: [], missing: [], removed: [] });
});

test("isolated rebuild is idempotent", async () => {
  const root = await fixture(DEMO_FIXTURE);
  await buildSkillset(root, { isolated: true });
  const before = await mirrorTreeHashes(root);

  await buildSkillset(root, { isolated: true });

  expect(await mirrorTreeHashes(root)).toEqual(before);
});

test("isolated build backs up unmanaged files planted inside the mirror", async () => {
  const root = await fixture(DEMO_FIXTURE);
  await Bun.write(join(root, ISOLATED_OUT_ROOT, "AGENTS.md"), "user file\n");

  const result = await buildSkillsetResult(root, { isolated: true });
  expect(result.diagnostics).toContainEqual(expect.objectContaining({
    code: "unmanaged-output-collision",
    outputPath: join(ISOLATED_OUT_ROOT, "AGENTS.md"),
  }));
  expect(result.writes.backupRunId).toBeDefined();
});

test("CLI accepts --isolated for build and rejects it elsewhere", async () => {
  const root = await fixture(DEMO_FIXTURE);

  const build = await runSkillsetCli("build", "--isolated", "--yes", "--root", root);
  expect(build.exitCode).toBe(0);
  expect(await exists(join(root, MIRROR_SKILL))).toBe(true);
  expect(await exists(join(root, LIVE_SKILL))).toBe(false);

  const verify = await runSkillsetCli("verify", "--isolated", "--root", root);
  expect(verify.exitCode).toBe(0);

  const lint = await runSkillsetCli("lint", "--isolated", "--root", root);
  expect(lint.exitCode).toBe(1);
  expect(lint.stderr).toContain("--isolated is only supported with build, diff, or verify");
});

async function fixture(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "skillset-isolated-"));
  for (const [path, content] of Object.entries(normalizeSkillsetFixtureFiles(files))) {
    await Bun.write(join(root, path), `${content.trim()}\n`);
  }
  return root;
}

async function exists(path: string): Promise<boolean> {
  return Bun.file(path).exists();
}

async function hashPaths(
  root: string,
  paths: readonly string[]
): Promise<ReadonlyMap<string, string>> {
  const hashes = new Map<string, string>();
  for (const path of [...paths].sort()) {
    hashes.set(path, createHash("sha256").update(await readFile(join(root, path))).digest("hex"));
  }
  return hashes;
}

async function mirrorTreeHashes(root: string): Promise<ReadonlyMap<string, string>> {
  const mirrorRoot = join(root, ISOLATED_OUT_ROOT);
  const files = await Array.fromAsync(
    new Bun.Glob("**/*").scan({ cwd: mirrorRoot, dot: true, onlyFiles: true })
  );
  const hashes = new Map<string, string>();
  for (const file of files.sort()) {
    hashes.set(file, createHash("sha256").update(await readFile(join(mirrorRoot, file))).digest("hex"));
  }
  return hashes;
}

async function runSkillsetCli(...args: readonly string[]): Promise<{
  readonly exitCode: number;
  readonly stderr: string;
  readonly stdout: string;
}> {
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
