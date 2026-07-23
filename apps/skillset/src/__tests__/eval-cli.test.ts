import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { expect, test } from "bun:test";

test("SET-386: eval list reports the resolved portable case-target matrix in text and JSON", async () => {
  const root = await fixture({
    "skillset.yaml": "skillset:\n  name: eval-cli\ncompile:\n  targets: [claude, codex]\n",
    ".skillset/skills/demo/SKILL.md": "---\nname: demo\ndescription: Demo.\n---\n\nUse this skill.\n",
    ".skillset/skills/demo/evals/evals.json": JSON.stringify({
      skill_name: "demo",
      evals: [{
        expected_output: "A summary.",
        id: 1,
        prompt: "Summarize the guidance.",
        skillset: { targets: ["codex"] },
      }],
    }),
  });

  const human = await runSkillsetCli("eval", "list", "--root", root);
  expect(human).toMatchObject({ exitCode: 0, stderr: "" });
  expect(human.stdout).toContain("demo #1 [codex]");
  expect(human.stdout).toContain("listed 1 eval case-target entry");

  const json = await runSkillsetCli("eval", "list", "--root", root, "--json");
  expect(json).toMatchObject({ exitCode: 0, stderr: "" });
  expect(JSON.parse(json.stdout)).toMatchObject({
    command: "eval list",
    data: { entries: [expect.objectContaining({ evalId: 1, skill: "demo", target: "codex" })] },
  });
});

async function fixture(files: Readonly<Record<string, string>>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "skillset-eval-cli-"));
  for (const [path, content] of Object.entries(files)) {
    const target = join(root, path);
    await mkdir(dirname(target), { recursive: true });
    await Bun.write(target, content);
  }
  return root;
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
