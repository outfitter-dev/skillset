import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, test } from "bun:test";

import { gitSafeEnv } from "../git-env";
import {
  hasHookRelevantSourceChanges,
  hookRelevantSourcePaths,
  readHookRuntimeContext,
  resolveSkillsetCommand,
  runHookEvent,
  runSkillsetCommand,
  type HookSourceGateResult,
  type RunSkillsetCommandOptions,
} from "../runtime-hooks";

test("runtime hook source gate ignores unrelated edits", async () => {
  const root = await gitFixture();

  await writeFile(join(root, "README.md"), "changed\n");

  expect(await hasHookRelevantSourceChanges(root)).toBe(false);
});

test("runtime hook source gate catches tracked and untracked Skillset edits", async () => {
  const root = await gitFixture();

  await writeFile(join(root, ".skillset/src/claude/settings.json"), "{}\n");
  expect(await hasHookRelevantSourceChanges(root)).toBe(true);

  await runGit(root, "checkout", "--", ".skillset/src/claude/settings.json");
  await mkdir(join(root, ".skillset/plugins/demo"), { recursive: true });
  await writeFile(join(root, ".skillset/plugins/demo/skillset.yaml"), "skillset:\n  name: demo\n");

  expect(await hasHookRelevantSourceChanges(root)).toBe(true);
});

test("runtime hook source paths include source, shared, and pending change entries", () => {
  expect(hookRelevantSourcePaths()).toEqual([
    ".skillset/config.yaml",
    ".skillset/instructions",
    ".skillset/skills",
    ".skillset/plugins",
    ".skillset/shared",
    ".skillset/src",
    ".skillset/changes/pending",
  ]);
});

test("runtime hook command resolver honors overrides and local compiler checkout", async () => {
  const root = await gitFixture();

  expect(await resolveSkillsetCommand(root, { SKILLSET_HOOK_COMMAND: "custom skillset" })).toEqual({
    argv: ["custom skillset"],
    kind: "shell",
  });

  await mkdir(join(root, "apps/skillset/src"), { recursive: true });
  await writeFile(join(root, "package.json"), JSON.stringify({ name: "skillset-workspace" }));
  await writeFile(join(root, "apps/skillset/src/cli.ts"), "console.log('local skillset');\n");

  expect(await resolveSkillsetCommand(root, {})).toEqual({
    argv: ["bun", "./apps/skillset/src/cli.ts"],
    kind: "argv",
  });
});

test("runtime hook command runner strips inherited Git repository environment", async () => {
  const root = await gitFixture();
  const previousGitDir = process.env.GIT_DIR;
  process.env.GIT_DIR = ".git";
  try {
    await expect(runSkillsetCommand([], {
      allowFailure: false,
      env: { SKILLSET_HOOK_COMMAND: 'test -z "$GIT_DIR"' },
      rootPath: root,
    })).resolves.toBe(0);
  } finally {
    if (previousGitDir === undefined) delete process.env.GIT_DIR;
    else process.env.GIT_DIR = previousGitDir;
  }
});

test("runtime hook context parser accepts unknown, Claude, Codex, and stdin payload shapes", async () => {
  const unknown = await readHookRuntimeContext({
    cwd: "/tmp/repo",
    env: {},
    event: "post-tool-use",
    rootPath: "/tmp/repo",
  });
  expect(unknown.provider).toBe("unknown");
  expect(unknown.repoRoot).toBe("/tmp/repo");

  const claude = await readHookRuntimeContext({
    cwd: "/tmp/repo",
    env: { CLAUDE_PROJECT_DIR: "/tmp/claude", CLAUDE_SESSION_ID: "session-1" },
    event: "post-tool-use",
    stdinText: "{\"tool\":\"Write\"}",
  });
  expect(claude.provider).toBe("claude");
  expect(claude.repoRoot).toBe("/tmp/claude");
  expect(claude.payload).toEqual({ tool: "Write" });
  expect(claude.rawEnv).toEqual({
    CLAUDE_PROJECT_DIR: "/tmp/claude",
    CLAUDE_SESSION_ID: "session-1",
  });

  const codex = await readHookRuntimeContext({
    cwd: "/tmp/repo",
    env: { CODEX_REPO_ROOT: "/tmp/codex", CODEX_SESSION_ID: "session-2" },
    event: "stop",
    stdinText: "{not json",
  });
  expect(codex.provider).toBe("codex");
  expect(codex.repoRoot).toBe("/tmp/codex");
  expect(codex.payload).toBeUndefined();
  expect(codex.payloadError).toContain("JSON");
});

test("post-tool-use is advisory and only runs status when Skillset source changed", async () => {
  const clean = await runHookEvent("post-tool-use", {
    commandRunner: commandRunner().run,
    rootPath: "/tmp/repo",
    sourceGate: async () => sourceGate(false),
  });
  expect(clean.exitCode).toBe(0);
  expect(clean.ranCommands).toEqual([]);

  const runner = commandRunner([7]);
  const changed = await runHookEvent("post-tool-use", {
    commandRunner: runner.run,
    rootPath: "/tmp/repo",
    sourceGate: async () => sourceGate(true),
  });
  expect(changed.exitCode).toBe(0);
  expect(changed.ranCommands).toEqual(["change status --root ."]);
  expect(runner.calls.map((call) => call.args)).toEqual([["change", "status", "--root", "."]]);
});

test("stop hook runs change check then check and propagates blocking failures", async () => {
  const changeFails = commandRunner([9]);
  const failed = await runHookEvent("stop", {
    commandRunner: changeFails.run,
    rootPath: "/tmp/repo",
    sourceGate: async () => sourceGate(true),
  });
  expect(failed.exitCode).toBe(9);
  expect(failed.ranCommands).toEqual(["change check --root ."]);

  const passes = commandRunner([0, 0]);
  const ok = await runHookEvent("stop", {
    commandRunner: passes.run,
    rootPath: "/tmp/repo",
    sourceGate: async () => sourceGate(true),
  });
  expect(ok.exitCode).toBe(0);
  expect(ok.ranCommands).toEqual(["change check --root .", "check --root ."]);
  expect(passes.calls.map((call) => call.args)).toEqual([
    ["change", "check", "--root", "."],
    ["check", "--root", "."],
  ]);
});

test("source gate failures are soft for post-tool-use and blocking for stop", async () => {
  const post = await runHookEvent("post-tool-use", {
    rootPath: "/tmp/repo",
    sourceGate: async () => sourceGate(false, { exitCode: 128, ok: false }),
  });
  expect(post.exitCode).toBe(0);

  const stop = await runHookEvent("stop", {
    rootPath: "/tmp/repo",
    sourceGate: async () => sourceGate(false, { exitCode: 128, ok: false }),
    stderr: { write: () => true },
  });
  expect(stop.exitCode).toBe(128);
});

function commandRunner(exitCodes: readonly number[] = [0]): {
  readonly calls: Array<{
    readonly args: readonly string[];
    readonly options: RunSkillsetCommandOptions;
  }>;
  readonly run: (args: readonly string[], options: RunSkillsetCommandOptions) => Promise<number>;
} {
  const calls: Array<{
    readonly args: readonly string[];
    readonly options: RunSkillsetCommandOptions;
  }> = [];
  return {
    calls,
    run: async (args, options) => {
      calls.push({ args, options });
      return exitCodes[calls.length - 1] ?? 0;
    },
  };
}

function sourceGate(
  changed: boolean,
  overrides: Partial<HookSourceGateResult> = {}
): HookSourceGateResult {
  return {
    changed,
    exitCode: 0,
    ok: true,
    paths: hookRelevantSourcePaths(),
    stdout: changed ? " M .skillset/config.yaml\n" : "",
    ...overrides,
  };
}

async function gitFixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "skillset-hooks-run-"));
  await mkdir(join(root, ".skillset/src/claude"), { recursive: true });
  await mkdir(join(root, ".skillset/changes/pending"), { recursive: true });
  await writeFile(join(root, ".skillset/config.yaml"), "skillset:\n  schema: 1\n");
  await writeFile(join(root, ".skillset/src/claude/settings.json"), "{\"hooks\":{}}\n");
  await writeFile(join(root, "README.md"), "initial\n");
  await runGit(root, "init", "-q");
  await runGit(root, "config", "user.email", "skillset@example.com");
  await runGit(root, "config", "user.name", "Skillset Tests");
  await runGit(root, "add", ".");
  await runGit(root, "commit", "-m", "initial", "-q");
  return root;
}

async function runGit(root: string, ...args: readonly string[]): Promise<void> {
  const proc = Bun.spawn({
    cmd: ["git", ...args],
    cwd: root,
    env: gitSafeEnv(),
    stderr: "pipe",
    stdout: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed (${exitCode})\n${stdout}${stderr}`);
  }
}
