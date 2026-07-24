import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  createTestGitFixtureRoot,
  initializeTestGitRepository,
} from "../../../../scripts/test-helpers/git-remote";

const EXPECT = "/usr/bin/expect";
const CLI = path.join(import.meta.dir, "..", "cli.ts");

test("SET-388: PTY children preserve runner-owned XDG roots", () => {
  const inherited = {
    SKILLSET_TEST_SANDBOX: "/tmp/skillset-test-owned/descriptor.json",
    XDG_CACHE_HOME: "/tmp/skillset-test-owned/xdg/cache",
    XDG_CONFIG_HOME: "/tmp/skillset-test-owned/xdg/config",
    XDG_DATA_HOME: "/tmp/skillset-test-owned/xdg/data",
    XDG_STATE_HOME: "/tmp/skillset-test-owned/xdg/state",
  };

  expect(ptyChildEnv("/tmp/legacy-config", inherited)).toMatchObject(inherited);
  expect(
    ptyChildEnv("/tmp/legacy-config", {}).XDG_CONFIG_HOME
  ).toBe("/tmp/legacy-config");
});

test.skipIf(!existsSync(EXPECT))(
  "SET-298: controlled source-creation PTYs preserve default-No and cancellation before a checked write",
  async () => {
    const parent = await mkdtemp(path.join(tmpdir(), "skillset-create-pty-"));
    const xdgRoot = await mkdtemp(
      path.join(tmpdir(), "skillset-create-pty-xdg-")
    );
    try {
      const declined = await runExpect(
        parent,
        xdgRoot,
        "declined",
        40,
        ['expect "Proceed?"', 'send -- "\\r"', "expect eof"]
      );
      expect(declined.exitCode).toBe(0);
      expect(await readdir(parent)).toEqual([]);

      const cancelled = await runExpect(
        parent,
        xdgRoot,
        "cancelled",
        40,
        ['expect "Proceed?"', 'send -- "\\003"', "expect eof"]
      );
      expect(cancelled.exitCode).toBe(130);
      expect(await readdir(parent)).toEqual([]);

      const confirmed = await runExpect(
        parent,
        xdgRoot,
        "confirmed",
        80,
        ['expect "Proceed?"', 'send -- "y\\r"', "expect eof"]
      );
      expect(confirmed.exitCode).toBe(0);
      expect(confirmed.stdout).toContain(
        "skillset: create 19 to create, 0 already present (written)"
      );
      await expect(
        Bun.file(path.join(parent, "confirmed/skillset.yaml")).exists()
      ).resolves.toBe(true);
      await expect(
        Bun.file(path.join(parent, "confirmed/.git/HEAD")).exists()
      ).resolves.toBe(true);

      const built = await runCli(
        xdgRoot,
        "build",
        "--yes",
        "--root",
        path.join(parent, "confirmed")
      );
      expect(built).toMatchObject({ exitCode: 0, stderr: "" });
      const checked = await runCli(
        xdgRoot,
        "check",
        "--root",
        path.join(parent, "confirmed")
      );
      expect(checked).toMatchObject({ exitCode: 0, stderr: "" });
      expect(checked.stdout).toContain("skillset: check passed");

      const machine = await runCli(
        xdgRoot,
        "create",
        "machine-preview",
        "--root",
        parent,
        "--targets",
        "codex",
        "--include",
        "ci",
        "--json"
      );
      expect(machine).toMatchObject({ exitCode: 0, stderr: "" });
      expect(machine.stdout).not.toContain("Proceed?");
      expect(JSON.parse(machine.stdout)).toMatchObject({
        command: "create",
        data: { state: "planned", writes: [] },
      });
      expect(await readdir(parent)).toEqual(["confirmed"]);
    } finally {
      await rm(parent, { force: true, recursive: true });
      await rm(xdgRoot, { force: true, recursive: true });
    }
  },
  30_000
);

test.skipIf(!existsSync(EXPECT))(
  "SET-298: controlled route PTYs prove navigation, empty search, and disabled reasons",
  async () => {
    const surfaceRoot = await createTestGitFixtureRoot(
      "skillset-surface-pty-"
    );
    const xdgRoot = await mkdtemp(
      path.join(tmpdir(), "skillset-surface-pty-xdg-")
    );
    try {
      const initRoot = path.join(surfaceRoot, "init");
      await mkdir(initRoot);
      await Bun.write(path.join(initRoot, "AGENTS.md"), "# Existing guidance\n");
      await initializeTestGitRepository(initRoot, {
        disposableRoot: surfaceRoot,
      });
      const initialized = await runSurfaceExpect(
        initRoot,
        xdgRoot,
        80,
        "init --root $env(WORKSPACE_ROOT)",
        [
          'expect "How should Skillset start?"',
          'send -- "\\033\\[B\\033\\[B\\r"',
          'expect "Generate for:"',
          'send -- "\\003"',
          "expect eof",
        ]
      );
      expect(initialized.exitCode).toBe(130);
      expect(initialized.stdout).toContain("Start empty");
      expect(initialized.stdout).toContain("skillset: interactive prompt cancelled");
      await expect(
        Bun.file(path.join(initRoot, "skillset.yaml")).exists()
      ).resolves.toBe(false);

      const newRoot = path.join(surfaceRoot, "new");
      await mkdir(newRoot);
      await Bun.write(
        path.join(newRoot, "skillset.yaml"),
        "skillset:\n  name: terminal-new\n"
      );
      const created = await runSurfaceExpect(
        newRoot,
        xdgRoot,
        40,
        "new --root $env(WORKSPACE_ROOT)",
        [
          'expect "Create a new:"',
          'send -- "\\033\\[B\\r"',
          'expect "Name:"',
          'send -- "\\003"',
          "expect eof",
        ]
      );
      expect(created.exitCode).toBe(130);
      expect(created.stdout).toContain("Project agent");
      expect(created.stdout).toContain("skillset: interactive prompt cancelled");
      await expect(
        Bun.file(path.join(newRoot, ".skillset/agents")).exists()
      ).resolves.toBe(false);

      const testRoot = path.join(surfaceRoot, "test");
      await mkdir(path.join(testRoot, ".skillset/skills/demo"), {
        recursive: true,
      });
      await Bun.write(
        path.join(testRoot, "skillset.yaml"),
        "skillset:\n  name: terminal-test\n"
      );
      await Bun.write(
        path.join(testRoot, ".skillset/skills/demo/SKILL.md"),
        "---\nname: demo\ndescription: Terminal test skill.\n---\n\n# Demo\n"
      );
      await Bun.write(
        path.join(testRoot, ".skillset/tests.yaml"),
        Array.from(
          { length: 8 },
          (_, index) => `test-${index}:
  select:
    skills:
      primary: ["demo"]
  checks:
    projection: true
`
        ).join("")
      );
      const tested = await runSurfaceExpect(
        testRoot,
        xdgRoot,
        80,
        "test --root $env(WORKSPACE_ROOT)",
        ['expect "Run:"', 'send -- "\\003"', "expect eof"]
      );
      expect(tested.exitCode).toBe(130);
      expect(tested.stdout).toContain("All tests");
      expect(tested.stdout).toContain("skillset: interactive prompt cancelled");

      const searched = await runSurfaceExpect(
        testRoot,
        xdgRoot,
        80,
        "lookup",
        [
          'expect "Look up:"',
          'send -- "no-such-subject"',
          'expect "No matches found"',
          'send -- "\\003"',
          "expect eof",
        ]
      );
      expect(searched.exitCode).toBe(130);
      expect(searched.stdout).toContain("No matches found");
      expect(searched.stdout).toContain(
        "skillset: interactive prompt cancelled"
      );

      const reconcileRoot = path.join(surfaceRoot, "reconcile");
      await mkdir(path.join(reconcileRoot, ".skillset/skills/demo"), {
        recursive: true,
      });
      await Bun.write(
        path.join(reconcileRoot, "skillset.yaml"),
        "skillset:\n  name: terminal-reconcile\nclaude: true\ncodex: false\ncursor: false\n"
      );
      await Bun.write(
        path.join(reconcileRoot, ".skillset/skills/demo/SKILL.md"),
        "---\nname: demo\ndescription: Terminal reconcile skill.\n---\n\n# Demo\n"
      );
      const built = await runCli(
        xdgRoot,
        "build",
        "--yes",
        "--root",
        reconcileRoot
      );
      expect(built.exitCode).toBe(0);
      await rm(path.join(reconcileRoot, ".claude/skills/demo/SKILL.md"));
      const reconciled = await runSurfaceExpect(
        reconcileRoot,
        xdgRoot,
        80,
        "reconcile .claude/skills/demo/SKILL.md --root $env(WORKSPACE_ROOT)",
        [
          'expect "Resolution:"',
          'expect "Generated output is missing"',
          'send -- "\\003"',
          "expect eof",
        ]
      );
      expect(reconciled.exitCode).toBe(130);
      expect(reconciled.stdout).toContain("Output wins");
      expect(
        Bun.stripANSI(reconciled.stdout).replace(/\s+/gu, " ")
      ).toContain(
        "Generated output is missing; output cannot win."
      );
      expect(reconciled.stdout).toContain(
        "skillset: interactive prompt cancelled"
      );
    } finally {
      await rm(surfaceRoot, { force: true, recursive: true });
      await rm(xdgRoot, { force: true, recursive: true });
    }
  },
  30_000
);

async function runExpect(
  parent: string,
  xdgRoot: string,
  name: string,
  columns: number,
  interactions: readonly string[]
): Promise<{
  readonly exitCode: number;
  readonly stderr: string;
  readonly stdout: string;
}> {
  const childEnv = ptyChildEnv(xdgRoot);
  const script = [
    "set timeout 15",
    `spawn -noecho /bin/sh -c "stty columns ${columns} rows 24; exec env CI=false NO_COLOR=1 TERM=xterm XDG_CONFIG_HOME=$env(XDG_ROOT) bun $env(SKILLSET_CLI) create $env(CREATE_NAME) --root $env(PARENT_ROOT) --targets codex --include ci"`,
    ...interactions,
    "catch wait result",
    "exit [lindex $result 3]",
  ].join("\n");
  const proc = Bun.spawn([EXPECT, "-c", script], {
    env: {
      ...childEnv,
      CREATE_NAME: name,
      PARENT_ROOT: parent,
      SKILLSET_CLI: CLI,
      XDG_ROOT: childEnv.XDG_CONFIG_HOME ?? xdgRoot,
    },
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

async function runSurfaceExpect(
  root: string,
  xdgRoot: string,
  columns: number,
  cliArguments: string,
  interactions: readonly string[]
): Promise<{
  readonly exitCode: number;
  readonly stderr: string;
  readonly stdout: string;
}> {
  const childEnv = ptyChildEnv(xdgRoot);
  const script = [
    "set timeout 15",
    `spawn -noecho /bin/sh -c "stty columns ${columns} rows 24; exec env CI=false NO_COLOR=1 TERM=xterm XDG_CONFIG_HOME=$env(XDG_ROOT) bun $env(SKILLSET_CLI) ${cliArguments}"`,
    ...interactions,
    "catch wait result",
    "exit [lindex $result 3]",
  ].join("\n");
  const proc = Bun.spawn([EXPECT, "-c", script], {
    env: {
      ...childEnv,
      SKILLSET_CLI: CLI,
      WORKSPACE_ROOT: root,
      XDG_ROOT: childEnv.XDG_CONFIG_HOME ?? xdgRoot,
    },
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

async function runCli(
  xdgRoot: string,
  ...args: readonly string[]
): Promise<{
  readonly exitCode: number;
  readonly stderr: string;
  readonly stdout: string;
}> {
  const proc = Bun.spawn(["bun", CLI, ...args], {
    env: ptyChildEnv(xdgRoot),
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

function ptyChildEnv(
  fallbackConfigHome: string,
  env: Record<string, string | undefined> = process.env
): Record<string, string | undefined> {
  if (env.SKILLSET_TEST_SANDBOX?.trim()) return { ...env };
  return { ...env, XDG_CONFIG_HOME: fallbackConfigHome };
}
