import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { createTestGitFixtureRoot } from "../../../../scripts/test-helpers/git-remote";
import { normalizeSkillsetFixtureFiles } from "../../../../scripts/test-helpers/skillset-config";

export async function contractFixture(
  files: Record<string, string>
): Promise<string> {
  const disposableRoot = await createTestGitFixtureRoot("skillset-contract-");
  const root = await mkdtemp(join(disposableRoot, "repo-"));
  for (const [path, content] of Object.entries(
    normalizeSkillsetFixtureFiles(files)
  )) {
    await Bun.write(join(root, path), `${content.trim()}\n`);
  }
  return root;
}

export async function writeHistory(
  root: string,
  entries: readonly Record<string, unknown>[]
): Promise<void> {
  const changesPath = join(root, ".skillset/changes");
  await mkdir(changesPath, { recursive: true });
  await writeFile(
    join(changesPath, "history.jsonl"),
    `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`,
    "utf8"
  );
}

export async function runSkillsetCli(...args: readonly string[]): Promise<{
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
