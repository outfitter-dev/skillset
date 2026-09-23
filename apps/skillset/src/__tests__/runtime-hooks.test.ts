import { chmod, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, test } from "bun:test";
import type { SkillsetVerifyResult } from "@skillset/core";

import {
  createTestGitFixtureRoot,
  initializeTestGitRepository,
  runTestGit,
} from "../../../../scripts/test-helpers/git-remote";
import {
  MISSING_SKILLSET_RUNNER,
  hasHookRelevantSourceChanges,
  hookRelevantSourcePaths,
  parseSkillsetHookCommand,
  resolveSkillsetCommand,
  runHookEvent,
  runSkillsetCommand,
  skillsetHookSpawnArgv,
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

  await writeFile(join(root, ".skillset/_claude/settings.json"), "{}\n");
  expect(await hasHookRelevantSourceChanges(root)).toBe(true);

  await runTestGit(root, "checkout", "--", ".skillset/_claude/settings.json");
  await mkdir(join(root, ".skillset/plugins/demo"), { recursive: true });
  await writeFile(join(root, ".skillset/plugins/demo/skillset.yaml"), "skillset:\n  name: demo\n");

  expect(await hasHookRelevantSourceChanges(root)).toBe(true);
});

test("runtime hook source paths include source, shared, and pending change entries", () => {
  expect(hookRelevantSourcePaths()).toEqual([
    "skillset.yaml",
    ".skillset",
    "skillset",
  ]);
});

test("runtime hook command resolver honors overrides and local compiler checkout", async () => {
  const root = await gitFixture();

  expect(await resolveSkillsetCommand(root, { SKILLSET_HOOK_COMMAND: "custom skillset" })).toEqual({
    argv: ["custom", "skillset"],
    kind: "argv",
  });
  expect(await resolveSkillsetCommand(root, {
    SKILLSET_HOOK_COMMAND: '"/tmp/custom skillset"',
  })).toEqual({
    argv: ["/tmp/custom skillset"],
    kind: "argv",
  });
  expect(await resolveSkillsetCommand(root, {
    SKILLSET_HOOK_COMMAND: "custom && skillset",
  })).toEqual({
    argv: ["custom && skillset"],
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

test("runtime hook command resolver falls back to stable package runners", async () => {
  await expect(resolveWithPath(["skillset"])).resolves.toEqual({
    argv: ["skillset"],
    kind: "argv",
  });
  await expect(resolveWithPath(["bunx"])).resolves.toEqual({
    argv: ["bunx", "skillset"],
    kind: "argv",
  });
  await expect(resolveWithPath(["bun"])).resolves.toEqual({
    argv: ["bun", "x", "skillset"],
    kind: "argv",
  });
  await expect(resolveWithPath(["npx"])).resolves.toEqual({
    argv: ["npx", "--yes", "skillset"],
    kind: "argv",
  });
});

test("runtime hook command resolver probes only the supplied PATH", async () => {
  await expect(resolveWithPath([])).rejects.toThrow(MISSING_SKILLSET_RUNNER);

  const hidden = await isolatedBins({ hidden: ["skillset"] });
  await expect(resolveSkillsetCommand(hidden.root, { PATH: hidden.visibleBin })).rejects.toThrow(
    MISSING_SKILLSET_RUNNER
  );

  const shadowed = await isolatedBins({ hidden: ["skillset"], visible: ["bunx"] });
  await expect(resolveSkillsetCommand(shadowed.root, { PATH: shadowed.visibleBin })).resolves.toEqual({
    argv: ["bunx", "skillset"],
    kind: "argv",
  });
});

test("runtime hook override parser treats argv and shell syntax distinctly", () => {
  expect(parseSkillsetHookCommand("npx --yes skillset")).toEqual({
    argv: ["npx", "--yes", "skillset"],
    kind: "argv",
  });
  expect(parseSkillsetHookCommand("C:\\Program Files\\skillset.exe")).toEqual({
    argv: ["C:\\Program", "Files\\skillset.exe"],
    kind: "argv",
  });
  expect(parseSkillsetHookCommand('"C:\\Program Files\\skillset.exe"')).toEqual({
    argv: ["C:\\Program Files\\skillset.exe"],
    kind: "argv",
  });
  expect(parseSkillsetHookCommand('test -z "$GIT_DIR"')).toEqual({
    argv: ['test -z "$GIT_DIR"'],
    kind: "shell",
  });
  expect(parseSkillsetHookCommand("echo invoked>marker&rem")).toEqual({
    argv: ["echo invoked>marker&rem"],
    kind: "shell",
  });
});

test("runtime hook spawn uses argv, POSIX sh, or Windows ComSpec by contract", () => {
  const posix = {
    cwd: "/tmp/repo",
    env: { PATH: "/tmp/bin" },
    platform: "linux" as const,
  };
  expect(skillsetHookSpawnArgv(
    { argv: ["skillset"], kind: "argv" },
    ["change", "status", "--root", "."],
    posix
  )).toEqual(["skillset", "change", "status", "--root", "."]);
  expect(skillsetHookSpawnArgv(
    { argv: ['test -z "$GIT_DIR"'], kind: "shell" },
    [],
    posix
  )).toEqual(["/bin/sh", "-lc", 'test -z "$GIT_DIR"']);

  const windows = {
    cwd: "C:\\repo",
    env: { ComSpec: "C:\\Windows\\System32\\cmd.exe", PATH: "C:\\tools" },
    platform: "win32" as const,
  };
  expect(skillsetHookSpawnArgv(
    { argv: ["npx.cmd", "--yes", "skillset"], kind: "argv" },
    ["change", "status"],
    windows
  )).toEqual([
    "C:\\Windows\\System32\\cmd.exe",
    "/d",
    "/s",
    "/c",
    "npx.cmd --yes skillset change status",
  ]);
  expect(skillsetHookSpawnArgv(
    { argv: ["C:\\Program Files\\nodejs\\npx.cmd"], kind: "argv" },
    ["--yes", "skillset"],
    windows
  )).toEqual([
    "C:\\Windows\\System32\\cmd.exe",
    "/d",
    "/s",
    "/c",
    '"C:\\Program Files\\nodejs\\npx.cmd" --yes skillset',
  ]);
  expect(skillsetHookSpawnArgv(
    { argv: ["echo invoked>marker&rem"], kind: "shell" },
    ["change", "status", "--root", "."],
    windows
  )).toEqual([
    "C:\\Windows\\System32\\cmd.exe",
    "/d",
    "/s",
    "/c",
    "echo invoked>marker&rem change status --root .",
  ]);
});

test("runtime hook command runner executes argv overrides without a shell", async () => {
  const root = await gitFixture();
  const marker = join(root, "invoked");
  const bin = join(root, process.platform === "win32" ? "hook-skillset.cmd" : "hook-skillset");
  if (process.platform === "win32") {
    await writeFile(bin, `@echo off\r\n>"${marker}" echo %*\r\nexit /b 0\r\n`);
  } else {
    await writeFile(bin, `#!/bin/sh\nprintf '%s\\n' "$@" > '${marker}'\nexit 0\n`);
    await chmod(bin, 0o755);
  }

  await expect(runSkillsetCommand(["change", "status", "--root", "."], {
    allowFailure: false,
    env: { SKILLSET_HOOK_COMMAND: bin },
    rootPath: root,
  })).resolves.toBe(0);
  expect(await readFile(marker, "utf8")).toContain("change");
  expect(await readFile(marker, "utf8")).toContain("status");
});

test("runtime hook command runner strips inherited Git repository environment", async () => {
  const root = await gitFixture();
  const previousGitDir = process.env.GIT_DIR;
  process.env.GIT_DIR = ".git";
  try {
    await expect(runSkillsetCommand([], {
      allowFailure: false,
      env: {
        SKILLSET_HOOK_COMMAND: process.platform === "win32"
          ? "if not defined GIT_DIR (exit 0) else (exit 1)"
          : 'test -z "$GIT_DIR"',
      },
      rootPath: root,
    })).resolves.toBe(0);
  } finally {
    if (previousGitDir === undefined) delete process.env.GIT_DIR;
    else process.env.GIT_DIR = previousGitDir;
  }
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
  expect(runner.calls[0]?.options.suppressWorkspaceRegistration).toBeUndefined();
});

test("stop hook runs change coverage then comprehensive check and propagates failures", async () => {
  const changeFails = commandRunner([9]);
  const failed = await runHookEvent("stop", {
    commandRunner: changeFails.run,
    rootPath: "/tmp/repo",
    sourceGate: async () => sourceGate(true),
  });
  expect(failed.exitCode).toBe(9);
  expect(failed.ranCommands).toEqual(["change check --root ."]);

  const checkFails = commandRunner([0, 7]);
  const checkFailed = await runHookEvent("stop", {
    commandRunner: checkFails.run,
    rootPath: "/tmp/repo",
    sourceGate: async () => sourceGate(true),
  });
  expect(checkFailed.exitCode).toBe(7);
  expect(checkFailed.ranCommands).toEqual(["change check --root .", "check --root ."]);

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
  expect(
    passes.calls.map((call) => call.options.suppressWorkspaceRegistration)
  ).toEqual([true, true]);
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

test("session-start verifies outputs without the source gate or command runner", async () => {
  let verifierCalls = 0;
  const current = await runHookEvent("session-start", {
    commandRunner: async () => {
      throw new Error("command runner must not be called");
    },
    env: { SKILLSET_PROVIDER: "claude" },
    rootPath: "/tmp/repo",
    sourceGate: async () => {
      throw new Error("source gate must not be called");
    },
    verifier: async (rootPath) => {
      verifierCalls += 1;
      expect(rootPath).toBe("/tmp/repo");
      return verification(true);
    },
  });

  expect(verifierCalls).toBe(1);
  expect(current).toMatchObject({
    exitCode: 0,
    output: "",
    ranCommands: [],
    sourceChanged: false,
    sourceGateOk: true,
    writes: {
      deletedPaths: [],
      mode: "read",
      paths: [],
      writtenPaths: [],
    },
  });
});

test("session-start emits provider-native stale output for Claude and Codex", async () => {
  for (const provider of ["claude", "codex"] as const) {
    const stale = await runHookEvent("session-start", {
      env: { SKILLSET_PROVIDER: provider },
      rootPath: "/tmp/repo",
      verifier: async () => verification(false, ["plugins/demo/output.json"]),
    });

    expect(stale.exitCode).toBe(0);
    expect(stale.output.endsWith("\n")).toBe(true);
    expect(JSON.parse(stale.output)).toEqual({
      hookSpecificOutput: {
        additionalContext: [
          "Skillset generated output is stale.",
          "",
          "Stale paths:",
          "- plugins/demo/output.json",
          "",
          "Run: npx skillset build",
          "skillset-help",
        ].join("\n"),
        hookEventName: "SessionStart",
      },
    });
  }
});

test("session-start stays silent for fulfilled blocked verification", async () => {
  const blocked = verification(false);
  const result = await runHookEvent("session-start", {
    env: { SKILLSET_PROVIDER: "claude" },
    rootPath: "/tmp/repo",
    verifier: async () => ({
      ...blocked,
      diagnostics: [{
        code: "unmanaged-output-collision",
        message: "unmanaged output blocks verification",
        outputPath: "plugins/demo/output.json",
        severity: "error",
      }],
      outputState: {
        ...blocked.outputState,
        blockers: [{ code: "unmanaged-output-collision", path: "plugins/demo/output.json" }],
        state: "blocked",
      },
    }),
  });

  expect(result).toMatchObject({ exitCode: 0, output: "", ranCommands: [] });
});

test("session-start lists only error-level generated-output drift paths", async () => {
  const stale = verification(false, ["plugins/demo/stale.json"]);
  const result = await runHookEvent("session-start", {
    env: { SKILLSET_PROVIDER: "codex" },
    rootPath: "/tmp/repo",
    verifier: async () => ({
      ...stale,
      diagnostics: [
        ...stale.diagnostics,
        {
          code: "codex-agents-size",
          message: "AGENTS.md is large",
          outputPath: "current/AGENTS.md",
          severity: "warning",
        },
      ],
    }),
  });

  expect(result.output).toContain("- plugins/demo/stale.json");
  expect(result.output).not.toContain("current/AGENTS.md");
});

test("session-start bounds unique stale paths and additional context", async () => {
  const paths = Array.from(
    { length: 30 },
    (_, index) => `plugins/${String(index).padStart(2, "0")}/${"x".repeat(500)}.json`
  );
  const stale = await runHookEvent("session-start", {
    env: { SKILLSET_PROVIDER: "codex" },
    rootPath: "/tmp/repo",
    verifier: async () => verification(false, [paths[0]!, ...paths, paths[0]!]),
  });
  const output = JSON.parse(stale.output) as {
    hookSpecificOutput: { additionalContext: string; hookEventName: string };
  };
  const context = output.hookSpecificOutput.additionalContext;
  const listedPaths = context
    .split("\n")
    .filter((line) => line.startsWith("- "));

  expect(listedPaths.length).toBeLessThanOrEqual(20);
  expect(new Set(listedPaths).size).toBe(listedPaths.length);
  expect(context).toContain(`... and ${paths.length - listedPaths.length} more.`);
  expect(context.length).toBeLessThanOrEqual(8_000);
  expect(context.endsWith("Run: npx skillset build\nskillset-help")).toBe(true);
});

test("session-start bounds JSON-escaped hook output", async () => {
  const paths = Array.from(
    { length: 20 },
    (_, index) => `plugins/demo/resources/p${index}/${"\\".repeat(240)}.txt`
  );
  const stale = await runHookEvent("session-start", {
    env: { SKILLSET_PROVIDER: "claude" },
    rootPath: "/tmp/repo",
    verifier: async () => verification(false, paths),
  });
  const output = JSON.parse(stale.output) as {
    hookSpecificOutput: { additionalContext: string; hookEventName: string };
  };
  const context = output.hookSpecificOutput.additionalContext;
  const listedPaths = context.split("\n").filter((line) => line.startsWith("- "));

  expect(stale.output.length).toBeLessThanOrEqual(9_000);
  expect(listedPaths.length).toBeLessThan(paths.length);
  expect(context).toContain(`... and ${paths.length - listedPaths.length} more.`);
  expect(context.endsWith("Run: npx skillset build\nskillset-help")).toBe(true);
});

test("session-start exits zero when verification throws and stays silent for unsupported providers", async () => {
  const failed = await runHookEvent("session-start", {
    env: { SKILLSET_PROVIDER: "claude" },
    rootPath: "/tmp/repo",
    verifier: async () => {
      throw new Error("verification failed");
    },
  });
  expect(failed).toMatchObject({ exitCode: 0, output: "", ranCommands: [] });

  for (const env of [{ SKILLSET_PROVIDER: "cursor" }, {}]) {
    const unsupported = await runHookEvent("session-start", {
      env,
      rootPath: "/tmp/repo",
      verifier: async () => verification(false, ["plugins/demo/output.json"]),
    });
    expect(unsupported).toMatchObject({ exitCode: 0, output: "", ranCommands: [] });
  }
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
    stdout: changed ? " M skillset.yaml\n" : "",
    ...overrides,
  };
}

function verification(
  ok: boolean,
  paths: readonly string[] = []
): SkillsetVerifyResult {
  return {
    data: {
      checkedFiles: paths.length,
      failures: paths.map((path) => `stale generated file: ${path}`),
    },
    diagnostics: paths.map((path) => ({
      code: "generated-output-changed",
      message: `stale generated file: ${path}`,
      outputPath: path,
      severity: "error" as const,
    })),
    ok,
    operation: "verify",
    outputState: {
      blockers: [],
      hasBaseline: true,
      outputChanges: paths,
      sourceChanges: [],
      state: ok ? "current" : "output-diverged",
    },
    renderResults: [],
    writes: {
      deletedPaths: [],
      mode: "read",
      paths: [],
      writtenPaths: [],
    },
  };
}

async function gitFixture(): Promise<string> {
  const disposableRoot = await createTestGitFixtureRoot(
    "skillset-hooks-run-"
  );
  const root = await mkdtemp(join(disposableRoot, "repo-"));
  await mkdir(join(root, ".skillset/_claude"), { recursive: true });
  await mkdir(join(root, ".skillset/changes"), { recursive: true });
  await writeFile(join(root, "skillset.yaml"), "skillset:\n  schema: 1\n");
  await writeFile(join(root, ".skillset/_claude/settings.json"), "{\"hooks\":{}}\n");
  await writeFile(join(root, "README.md"), "initial\n");
  await initializeTestGitRepository(root, { disposableRoot });
  return root;
}

async function resolveWithPath(commands: readonly string[]) {
  const bins = await isolatedBins({ visible: commands });
  return resolveSkillsetCommand(bins.root, { PATH: bins.visibleBin });
}

async function isolatedBins(options: {
  readonly hidden?: readonly string[];
  readonly visible?: readonly string[];
}): Promise<{
  readonly hiddenBin: string;
  readonly root: string;
  readonly visibleBin: string;
}> {
  const root = await mkdtemp(join(tmpdir(), "skillset-hooks-path-"));
  const hiddenBin = join(root, "hidden-bin");
  const visibleBin = join(root, "visible-bin");
  await mkdir(hiddenBin, { recursive: true });
  await mkdir(visibleBin, { recursive: true });
  await writeBins(hiddenBin, options.hidden ?? []);
  await writeBins(visibleBin, options.visible ?? []);
  return { hiddenBin, root, visibleBin };
}

async function writeBins(binDir: string, commands: readonly string[]): Promise<void> {
  for (const command of commands) {
    if (process.platform === "win32") {
      await writeFile(join(binDir, `${command}.cmd`), "@echo off\r\nexit /b 0\r\n");
      continue;
    }
    const binPath = join(binDir, command);
    await writeFile(binPath, "#!/bin/sh\nexit 0\n");
    await chmod(binPath, 0o755);
  }
}
