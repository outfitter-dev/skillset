import { chmod, mkdir, mkdtemp, readFile } from "node:fs/promises";
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

test("SET-387: eval run reports completed execution without quality pass/fail language", async () => {
  const root = await fixture({
    "skillset.yaml": "skillset:\n  name: eval-cli\ncompile:\n  targets: [codex]\n",
    ".skillset/skills/demo/SKILL.md": "---\nname: demo\ndescription: Demo.\n---\n\nUse this skill.\n",
    ".skillset/skills/demo/evals/evals.json": JSON.stringify({
      skill_name: "demo",
      evals: [{ expected_output: "Ungraded.", id: 1, prompt: "Run the eval." }],
    }),
  });
  const bin = join(root, "fake-codex");
  await Bun.write(bin, "#!/bin/sh\nlast=\"\"\nprev=\"\"\nfor arg in \"$@\"; do\n  if [ \"$prev\" = \"--output-last-message\" ]; then last=\"$arg\"; fi\n  prev=\"$arg\"\ndone\ncat >/dev/null\nprintf 'final\\n' > \"$last\"\nprintf '{}\\n'\n");
  await chmod(bin, 0o755);

  const result = await runSkillsetCliWithEnv({
    ...process.env,
    SKILLSET_TEST_CODEX_BIN: bin,
    XDG_CACHE_HOME: join(root, "xdg-cache"),
  }, "eval", "run", "--root", root);

  expect(result).toMatchObject({ exitCode: 0, stderr: "" });
  expect(result.stdout).toContain("skillset: eval completed");
  expect(result.stdout).toContain("demo #1 [codex] completed");
  expect(result.stdout).not.toMatch(/\b(?:pass|fail)\b/iu);
});

test("SET-387: eval JSON data contains classification rather than verdict booleans", async () => {
  const root = await fixture({
    "skillset.yaml": "skillset:\n  name: eval-cli\ncompile:\n  targets: [codex]\n",
    ".skillset/skills/demo/SKILL.md": "---\nname: demo\ndescription: Demo.\n---\n\nUse this skill.\n",
    ".skillset/skills/demo/evals/evals.json": JSON.stringify({
      skill_name: "demo",
      evals: [{ expected_output: "Ungraded.", id: 1, prompt: "Run the eval." }],
    }),
  });
  const bin = join(root, "fake-codex");
  await Bun.write(bin, "#!/bin/sh\nlast=\"\"\nprev=\"\"\nfor arg in \"$@\"; do\n  if [ \"$prev\" = \"--output-last-message\" ]; then last=\"$arg\"; fi\n  prev=\"$arg\"\ndone\ncat >/dev/null\nprintf 'final\\n' > \"$last\"\nprintf '{}\\n'\n");
  await chmod(bin, 0o755);

  const json = await runSkillsetCliWithEnv({
    ...process.env,
    SKILLSET_TEST_CODEX_BIN: bin,
    XDG_CACHE_HOME: join(root, "xdg-cache"),
  }, "eval", "run", "--json", "--root", root);
  const data = (JSON.parse(json.stdout) as { data: Record<string, unknown> }).data;
  expect(data).toMatchObject({ state: "completed" });
  expect(data).not.toHaveProperty("ok");
  expect(data.trials).toEqual([expect.objectContaining({ classification: "completed" })]);
  expect((data.trials as readonly Record<string, unknown>[]).every((trial) => !("ok" in trial))).toBe(true);
  expect(JSON.stringify(data)).not.toMatch(/\b(?:pass|fail)\b/iu);
});

test("SET-387: SIGINT cancels an eval provider process tree before the CLI exits", async () => {
  const root = await fixture({
    "skillset.yaml": "skillset:\n  name: eval-signal\ncompile:\n  targets: [codex]\n",
    ".skillset/skills/demo/SKILL.md": "---\nname: demo\ndescription: Signal cleanup fixture.\n---\n\nUse this skill.\n",
    ".skillset/skills/demo/evals/evals.json": JSON.stringify({
      skill_name: "demo",
      evals: [{ expected_output: "Ungraded.", id: 1, prompt: "Wait." }],
    }),
  });
  const marker = join(root, "provider-pids");
  const bin = join(root, "signal-codex");
  await Bun.write(
    bin,
    "#!/bin/sh\nsleep 30 &\nchild=$!\nprintf '%s %s\\n' \"$$\" \"$child\" > \"$PROVIDER_PID_MARKER\"\ncat >/dev/null\nwait \"$child\"\n"
  );
  await chmod(bin, 0o755);
  const proc = Bun.spawn({
    cmd: ["bun", join(import.meta.dir, "..", "cli.ts"), "eval", "run", "--root", root],
    env: {
      ...process.env,
      PROVIDER_PID_MARKER: marker,
      SKILLSET_TEST_CODEX_BIN: bin,
      XDG_CACHE_HOME: join(root, "xdg-cache"),
    },
    stderr: "pipe",
    stdout: "pipe",
  });
  const deadline = Date.now() + 2_000;
  while (!await Bun.file(marker).exists() && Date.now() < deadline) {
    await Bun.sleep(10);
  }
  expect(await Bun.file(marker).exists()).toBe(true);
  const providerPids = (await readFile(marker, "utf8"))
    .trim()
    .split(/\s+/u)
    .map(Number);

  process.kill(proc.pid, "SIGINT");
  const [exitCode] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);

  expect(exitCode).not.toBe(0);
  for (const pid of providerPids) {
    expect(() => process.kill(pid, 0)).toThrow();
  }
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
  return runSkillsetCliWithEnv(process.env, ...args);
}

async function runSkillsetCliWithEnv(env: Record<string, string | undefined>, ...args: readonly string[]): Promise<{
  readonly exitCode: number;
  readonly stderr: string;
  readonly stdout: string;
}> {
  const proc = Bun.spawn({
    cmd: ["bun", join(import.meta.dir, "..", "cli.ts"), ...args],
    env,
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
