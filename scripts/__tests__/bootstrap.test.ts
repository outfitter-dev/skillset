import { describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";

import {
  isBunVersionAllowed,
  isCompatibleBunVersion,
  isVersionAtLeast,
  minimumFromEngineRange,
  readPackageManagerBunVersion,
  readPinnedBunVersion,
} from "../bootstrap/bun";
import { loadBootstrapConfig } from "../bootstrap/config";
import { isLinkedWorktree, readRepoHealth } from "../bootstrap/git";
import { detectHost, resolveRepoRoot } from "../bootstrap/host";
import { parseBootstrapArgs } from "../bootstrap/main";
import {
  ensureBunAvailable,
  hasRepoInstallState,
  listWorkspaceGlobs,
  normalizeTrackedCheckoutModes,
} from "../bootstrap/repo";
import { isRepoRoot } from "../bootstrap/shared";
import { resolveCleanupTarget } from "../bootstrap/teardown";
import { collectToolStatus } from "../bootstrap/tools";
import { createTestFixtureRoot } from "../test-helpers/fixture-root";
import {
  createTestGitFixtureRoot,
  initializeTestGitRepository,
  runTestGit,
} from "../test-helpers/git-remote";

const repoRoot = join(import.meta.dir, "..", "..");
const packageJson = JSON.parse(
  await Bun.file(join(repoRoot, "package.json")).text()
) as {
  readonly engines?: {
    readonly bun?: string;
  };
  readonly workspaces?: readonly string[];
};
const expectedWorkspaces = Array.isArray(packageJson.workspaces)
  ? packageJson.workspaces
  : [];

const makeRepoRoot = async (): Promise<string> => {
  const root = await createTestFixtureRoot("skillset-bootstrap-root-");
  mkdirSync(join(root, ".skillset"), { recursive: true });
  mkdirSync(join(root, "apps/skillset/src"), { recursive: true });
  writeFileSync(
    join(root, "package.json"),
    '{"name":"skillset-workspace","packageManager":"bun@1.4.0","engines":{"bun":">=1.4.0"},"workspaces":[]}\n'
  );
  writeFileSync(join(root, ".bun-version"), "1.4.0\n");
  writeFileSync(join(root, "skillset.yaml"), "skillset:\n  name: skillset\n");
  writeFileSync(join(root, "apps/skillset/src/cli.ts"), "");
  return root;
};

const makeShellBootstrapFixture = async (): Promise<{
  root: string;
  home: string;
  fakeBin: string;
  installer: string;
  installLog: string;
}> => {
  const root = await createTestFixtureRoot("skillset-bootstrap-shell-");
  const home = join(root, "home");
  const fakeBin = join(root, "fake-bin");
  const installer = join(root, "installer.sh");
  const installLog = join(root, "install.log");
  await Promise.all([
    mkdir(join(root, "scripts", "bootstrap"), { recursive: true }),
    mkdir(home, { recursive: true }),
    mkdir(fakeBin, { recursive: true }),
    mkdir(join(root, "tmp"), { recursive: true }),
  ]);
  await Promise.all([
    copyFile(
      join(repoRoot, "scripts", "bootstrap.sh"),
      join(root, "scripts", "bootstrap.sh")
    ),
    copyFile(
      join(repoRoot, "scripts", "pinned-bun.ts"),
      join(root, "scripts", "pinned-bun.ts")
    ),
    copyFile(
      join(repoRoot, "scripts", "bootstrap", "resolve-runtime.ts"),
      join(root, "scripts", "bootstrap", "resolve-runtime.ts")
    ),
    writeFile(join(root, ".bun-version"), `${Bun.version}\n`),
    writeFile(
      join(root, "scripts", "bootstrap", "main.ts"),
      'console.log(JSON.stringify({ version: Bun.version, path: process.execPath, which: Bun.which("bun"), args: process.argv.slice(2) }));\n'
    ),
    writeFile(
      installer,
      '#!/bin/sh\nprintf "used\\n" >> "$SKILLSET_TEST_INSTALL_LOG"\nmkdir -p "$BUN_INSTALL/bin"\ncp "$SKILLSET_TEST_BUN_SOURCE" "$BUN_INSTALL/bin/bun"\nchmod +x "$BUN_INSTALL/bin/bun"\ncase "$SHELL" in */zsh) printf "# bun\\n" >> "$HOME/.zshrc";; esac\n'
    ),
    writeFile(join(home, ".zshrc"), "# user shell\n"),
  ]);
  const curl = join(fakeBin, "curl");
  await writeFile(curl, '#!/bin/sh\nexec /bin/cat "$SKILLSET_TEST_INSTALLER"\n');
  await chmod(curl, 0o755);
  return { fakeBin, home, installer, installLog, root };
};

const runShellBootstrapFixture = (
  fixture: Awaited<ReturnType<typeof makeShellBootstrapFixture>>,
  command: string
) =>
  Bun.spawnSync({
    cmd: ["bash", join(fixture.root, "scripts", "bootstrap.sh"), command],
    cwd: fixture.root,
    env: {
      ...process.env,
      BUN_INSTALL: join(fixture.home, ".bun"),
      HOME: fixture.home,
      PATH: `${fixture.fakeBin}:/usr/bin:/bin`,
      SHELL: "/bin/zsh",
      SKILLSET_TEST_BUN_SOURCE: process.execPath,
      SKILLSET_TEST_INSTALLER: fixture.installer,
      SKILLSET_TEST_INSTALL_LOG: fixture.installLog,
      TMPDIR: join(fixture.root, "tmp"),
    },
    stderr: "pipe",
    stdout: "pipe",
  });

describe("bootstrap dispatcher", () => {
  test("keeps legacy flags routed to repo", () => {
    expect(parseBootstrapArgs(["--force"])).toEqual({
      command: "repo",
      force: true,
      provider: undefined,
      update: false,
    });
    expect(parseBootstrapArgs(["--update"])).toEqual({
      command: "repo",
      force: false,
      provider: undefined,
      update: true,
    });
  });

  test("parses explicit subcommands", () => {
    expect(parseBootstrapArgs(["agent", "--update"])).toEqual({
      command: "agent",
      force: false,
      provider: undefined,
      update: true,
    });
    expect(parseBootstrapArgs(["codex"])).toEqual({
      command: "codex",
      force: false,
      provider: "codex",
      update: false,
    });
    expect(parseBootstrapArgs(["claude"])).toEqual({
      command: "claude",
      force: false,
      provider: "claude",
      update: false,
    });
    expect(parseBootstrapArgs(["cursor"])).toEqual({
      command: "cursor",
      force: false,
      provider: "cursor",
      update: false,
    });
    expect(parseBootstrapArgs(["doctor"])).toEqual({
      command: "doctor",
      force: false,
      provider: undefined,
      update: false,
    });
    expect(parseBootstrapArgs(["teardown"])).toEqual({
      command: "teardown",
      force: false,
      provider: undefined,
      update: false,
    });
    expect(parseBootstrapArgs(["sweep"])).toEqual({
      command: "teardown",
      force: false,
      provider: undefined,
      update: false,
    });
  });

  test("shell entrypoint exposes help without mutating setup state", () => {
    const proc = Bun.spawnSync({
      cmd: ["bash", "./scripts/bootstrap.sh", "--help"],
      cwd: repoRoot,
      stderr: "pipe",
      stdout: "pipe",
    });

    expect(proc.exitCode).toBe(0);
    expect(proc.stdout.toString()).toContain(
      "repo|agent|codex|claude|cursor|doctor|teardown"
    );
  });

  test("cold session bootstrap uses a versioned cache without creating global Bun", async () => {
    const fixture = await makeShellBootstrapFixture();
    const result = runShellBootstrapFixture(fixture, "claude");
    expect(result.exitCode).toBe(0);
    const report = JSON.parse(result.stdout.toString()) as {
      version: string;
      path: string;
      args: string[];
    };
    expect(report.version).toBe(Bun.version);
    expect(report.path).toBe(
      join(
        fixture.home,
        ".cache",
        "skillset",
        "bun",
        `${process.platform}-${process.arch}`,
        Bun.version,
        "bin",
        "bun"
      )
    );
    expect(report.args).toEqual(["claude"]);
    expect(await readFile(fixture.installLog, "utf-8")).toBe("used\n");
    expect(
      await Bun.file(join(fixture.home, ".bun", "bin", "bun")).exists()
    ).toBe(false);
    expect(await readFile(join(fixture.home, ".zshrc"), "utf-8")).toBe(
      "# user shell\n"
    );
    for (const command of ["doctor", "teardown"]) {
      const diagnostic = runShellBootstrapFixture(fixture, command);
      expect(diagnostic.exitCode).toBe(0);
      const diagnosticReport = JSON.parse(diagnostic.stdout.toString());
      expect(diagnosticReport.args).toEqual([command]);
      expect(diagnosticReport.which).toBe(report.path);
    }
  });

  test("session bootstrap leaves a different global Bun's bytes and inode time untouched", async () => {
    const fixture = await makeShellBootstrapFixture();
    const globalBin = join(fixture.home, ".bun", "bin");
    const globalBun = join(globalBin, "bun");
    await mkdir(globalBin, { recursive: true });
    await writeFile(
      globalBun,
      `#!/bin/sh\nif [ "$1" = "--version" ]; then printf '1.3.14\\n'; exit 0; fi\nexec "${process.execPath}" "$@"\n`
    );
    await chmod(globalBun, 0o755);
    const before = await stat(globalBun);
    const beforeBytes = await readFile(globalBun);
    const result = runShellBootstrapFixture(fixture, "claude");
    expect(result.exitCode).toBe(0);
    const report = JSON.parse(result.stdout.toString()) as {
      version: string;
      path: string;
    };
    expect(report.version).toBe(Bun.version);
    expect(report.path).toContain(join(fixture.home, ".cache", "skillset", "bun"));
    expect(await readFile(fixture.installLog, "utf-8")).toBe("used\n");
    const after = await stat(globalBun);
    expect(await readFile(globalBun)).toEqual(beforeBytes);
    expect(after.ino).toBe(before.ino);
    expect(after.ctimeMs).toBe(before.ctimeMs);
  });

  test("TypeScript repair installs into the owned cache without rewriting global Bun", async () => {
    const fixture = await makeShellBootstrapFixture();
    const globalBin = join(fixture.home, ".bun", "bin");
    const globalBun = join(globalBin, "bun");
    await mkdir(globalBin, { recursive: true });
    await writeFile(globalBun, '#!/bin/sh\nprintf "1.3.14\\n"\n');
    await chmod(globalBun, 0o755);
    const before = await stat(globalBun);
    const beforeBytes = await readFile(globalBun);
    const repairModule = join(repoRoot, "scripts", "bootstrap", "bun.ts");
    const script = [
      `import { installPinnedBun } from ${JSON.stringify(repairModule)};`,
      `await installPinnedBun(${JSON.stringify(fixture.root)});`,
      'console.log(process.env.PATH?.split(":")[0]);',
    ].join("\n");
    const result = Bun.spawnSync({
      cmd: [process.execPath, "-e", script],
      cwd: fixture.root,
      env: {
        ...process.env,
        BUN_INSTALL: join(fixture.home, ".bun"),
        HOME: fixture.home,
        PATH: `${globalBin}:/usr/bin:/bin`,
      },
      stderr: "pipe",
      stdout: "pipe",
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString().trim()).toBe(
      join(
        fixture.home,
        ".cache",
        "skillset",
        "bun",
        `${process.platform}-${process.arch}`,
        Bun.version,
        "bin"
      )
    );
    const after = await stat(globalBun);
    expect(await readFile(globalBun)).toEqual(beforeBytes);
    expect(after.ino).toBe(before.ino);
    expect(after.ctimeMs).toBe(before.ctimeMs);
  });
});

describe("bootstrap repo policy", () => {
  test("workspace globs stay aligned with root package.json", async () => {
    await expect(listWorkspaceGlobs(repoRoot)).resolves.toEqual(
      expectedWorkspaces
    );
  });

  test("Bun pin stays aligned across repo metadata", () => {
    expect(readPinnedBunVersion(repoRoot)).toBe("1.4.0");
    expect(readPackageManagerBunVersion(repoRoot)).toBe("1.4.0");
    expect(minimumFromEngineRange(packageJson.engines?.bun)).toBe("1.4.0");
  });

  test("Bun checks distinguish package floors from repo pins", () => {
    expect(minimumFromEngineRange(">=1.4.0")).toBe("1.4.0");
    expect(isVersionAtLeast("1.4.0", "1.4.0")).toBe(true);
    expect(isVersionAtLeast("1.4.1", "1.4.0")).toBe(true);
    expect(isVersionAtLeast("1.5.0", "1.4.0")).toBe(true);
    expect(isVersionAtLeast("1.3.14", "1.4.0")).toBe(false);
    expect(isCompatibleBunVersion("1.4.1", "1.4.0")).toBe(true);
    expect(isCompatibleBunVersion("1.5.0", "1.4.0")).toBe(false);
    expect(isBunVersionAllowed("1.4.0", "1.4.0", "strict")).toBe(true);
    expect(isBunVersionAllowed("1.4.1", "1.4.0", "strict")).toBe(false);
  });

  test("Bun checks tolerate prerelease builds like the shell gate does", () => {
    expect(isVersionAtLeast("1.4.1-canary.20+abc123", "1.4.0")).toBe(true);
    expect(isVersionAtLeast("1.3.14-canary.2", "1.4.0")).toBe(false);
    expect(isCompatibleBunVersion("1.4.1-canary.20+abc123", "1.4.0")).toBe(
      true
    );
    expect(isCompatibleBunVersion("1.5.0-canary.1", "1.4.0")).toBe(false);
    expect(isBunVersionAllowed("1.4.0-canary.1", "1.4.0", "strict")).toBe(
      false
    );
  });

  test("repo root detection accepts current and migration workspace markers", async () => {
    const ordinaryRoot = await makeRepoRoot();
    const legacyRoot = await makeRepoRoot();
    const dedicatedRoot = await makeRepoRoot();
    expect(isRepoRoot(ordinaryRoot)).toBe(true);

    rmSync(join(legacyRoot, "skillset.yaml"), { force: true });
    writeFileSync(
      join(legacyRoot, "skillset.yaml"),
      "skillset:\n  name: legacy\n"
    );
    expect(isRepoRoot(legacyRoot)).toBe(true);

    rmSync(join(dedicatedRoot, "skillset.yaml"), { force: true });
    writeFileSync(
      join(dedicatedRoot, "skillset.yaml"),
      "skillset:\n  name: dedicated\n"
    );
    mkdirSync(join(dedicatedRoot, "skillset"), { recursive: true });
    expect(isRepoRoot(dedicatedRoot)).toBe(true);
  });

  test("stale Bun is repaired before policy enforcement fails", async () => {
    const root = await makeRepoRoot();
    const installs: string[] = [];
    let checks = 0;
    await ensureBunAvailable(
      {
        config: loadBootstrapConfig(),
        force: false,
        host: {
          bunPolicy: "compatible",
          provider: "generic",
          remote: false,
        },
        repoRoot: root,
        update: false,
      },
      {
        checkBunVersion: (_repoRoot, policy) => {
          checks += 1;
          return checks === 1
            ? {
                actual: "1.3.14",
                ok: false,
                pinned: "1.4.0",
                policy,
                reason:
                  "Expected Bun 1.4.0 or newer compatible patch, found 1.3.14",
              }
            : {
                actual: "1.4.0",
                ok: true,
                pinned: "1.4.0",
                policy,
              };
        },
        installPinnedBun: async (installRoot, versionFile) => {
          installs.push(`${installRoot}:${versionFile ?? ""}`);
        },
      }
    );

    expect(checks).toBe(2);
    expect(installs).toEqual([`${root}:.bun-version`]);
  });

  test("dependency state allows workspace packages without dependencies", async () => {
    const root = await createTestFixtureRoot("skillset-install-state-");
    writeFileSync(
      join(root, "package.json"),
      '{"name":"root","workspaces":["packages/*"]}\n'
    );
    mkdirSync(join(root, "node_modules"), { recursive: true });
    mkdirSync(join(root, "packages/no-deps"), { recursive: true });
    writeFileSync(
      join(root, "packages/no-deps/package.json"),
      '{"name":"no-deps"}\n'
    );
    mkdirSync(join(root, "packages/with-deps/node_modules"), {
      recursive: true,
    });
    writeFileSync(
      join(root, "packages/with-deps/package.json"),
      '{"name":"with-deps","dependencies":{"yaml":"^2.8.1"}}\n'
    );

    await expect(hasRepoInstallState(root)).resolves.toBe(true);

    rmSync(join(root, "packages/with-deps/node_modules"), {
      force: true,
      recursive: true,
    });
    await expect(hasRepoInstallState(root)).resolves.toBe(false);
  });

  test("bootstrap normalizes tracked checkout modes without touching untracked files or symlinks", async () => {
    if (process.platform === "win32") {
      return;
    }
    const root = await createTestGitFixtureRoot("skillset-bootstrap-modes-");
    const work = await mkdtemp(join(root, "work-"));
    const regular = join(work, "regular.txt");
    const executable = join(work, "run.sh");
    const link = join(work, "regular-link");
    const untracked = join(work, "private.txt");
    await writeFile(regular, "regular\n");
    await writeFile(executable, "#!/bin/sh\n");
    await chmod(executable, 0o755);
    await symlink("regular.txt", link);
    await initializeTestGitRepository(work, { disposableRoot: root });
    await chmod(regular, 0o600);
    await chmod(executable, 0o700);
    await writeFile(untracked, "private\n", { mode: 0o600 });

    await expect(normalizeTrackedCheckoutModes(work)).resolves.toEqual({
      executable: 1,
      regular: 1,
    });
    const [regularEntry, executableEntry, untrackedEntry, linkEntry] =
      await Promise.all([
        lstat(regular),
        lstat(executable),
        lstat(untracked),
        lstat(link),
      ]);
    expect(regularEntry.mode % 0o1000).toBe(0o644);
    expect(executableEntry.mode % 0o1000).toBe(0o755);
    expect(untrackedEntry.mode % 0o1000).toBe(0o600);
    expect(linkEntry.isSymbolicLink()).toBe(true);
    await expect(normalizeTrackedCheckoutModes(work)).resolves.toEqual({
      executable: 0,
      regular: 0,
    });
  });

  test("bootstrap rejects checkout mode normalization when Git cannot list tracked files", async () => {
    if (process.platform === "win32") {
      return;
    }
    const root = await createTestGitFixtureRoot(
      "skillset-bootstrap-mode-failure-"
    );
    const work = await mkdtemp(join(root, "work-"));
    await expect(normalizeTrackedCheckoutModes(work)).rejects.toThrow();
  });

  test("bootstrap leaves unmerged checkout modes untouched", async () => {
    if (process.platform === "win32") {
      return;
    }
    const root = await createTestGitFixtureRoot(
      "skillset-bootstrap-unmerged-modes-"
    );
    const work = await mkdtemp(join(root, "work-"));
    const conflicted = join(work, "conflicted.txt");
    await writeFile(conflicted, "base\n");
    await initializeTestGitRepository(work, { disposableRoot: root });
    await runTestGit(work, "switch", "-c", "executable-change");
    await writeFile(conflicted, "branch\n");
    await chmod(conflicted, 0o755);
    await runTestGit(work, "add", "conflicted.txt");
    await runTestGit(work, "commit", "-m", "executable change");
    await runTestGit(work, "switch", "main");
    await writeFile(conflicted, "main\n");
    await runTestGit(work, "add", "conflicted.txt");
    await runTestGit(work, "commit", "-m", "main change");
    await expect(
      runTestGit(work, "merge", "executable-change")
    ).rejects.toThrow();
    await chmod(conflicted, 0o600);

    await expect(normalizeTrackedCheckoutModes(work)).resolves.toEqual({
      executable: 0,
      regular: 0,
    });
    expect((await lstat(conflicted)).mode % 0o1000).toBe(0o600);
  });

  test("root resolution prefers provider env vars before cwd", async () => {
    const config = loadBootstrapConfig();
    const codexRoot = await makeRepoRoot();
    const claudeRoot = await makeRepoRoot();
    expect(
      resolveRepoRoot(
        claudeRoot,
        {
          CLAUDE_PROJECT_DIR: claudeRoot,
          CODEX_WORKTREE_PATH: codexRoot,
        } as NodeJS.ProcessEnv,
        config
      )
    ).toBe(codexRoot);
  });

  test("provider-specific root resolution prefers the requested provider", async () => {
    const config = loadBootstrapConfig();
    const codexRoot = await makeRepoRoot();
    const claudeRoot = await makeRepoRoot();
    const nonRepoRoot = await createTestFixtureRoot("skillset-bootstrap-nonrepo-");
    expect(isRepoRoot(nonRepoRoot)).toBe(false);
    expect(
      resolveRepoRoot(
        nonRepoRoot,
        {
          CLAUDE_PROJECT_DIR: claudeRoot,
          CODEX_WORKTREE_PATH: codexRoot,
        } as NodeJS.ProcessEnv,
        config,
        "claude"
      )
    ).toBe(claudeRoot);
  });

  test("Claude sentinel env does not act as a repo root", async () => {
    const config = loadBootstrapConfig();
    const sentinelRoot = await makeRepoRoot();
    const cwdRoot = await makeRepoRoot();
    expect(
      resolveRepoRoot(
        cwdRoot,
        {
          CLAUDECODE: sentinelRoot,
        } as NodeJS.ProcessEnv,
        config,
        "claude"
      )
    ).toBe(cwdRoot);
  });

  test("host detection honors explicit provider and remote overrides", () => {
    expect(
      detectHost(
        {
          SKILLSET_AGENT_ENV_PROVIDER: "codex",
          SKILLSET_AGENT_ENV_REMOTE: "true",
        } as NodeJS.ProcessEnv,
        loadBootstrapConfig()
      )
    ).toMatchObject({
      bunPolicy: "strict",
      provider: "codex",
      remote: true,
    });
  });

  test("host detection recognizes the Cursor agent env", () => {
    expect(
      detectHost(
        { CURSOR_AGENT: "1" } as NodeJS.ProcessEnv,
        loadBootstrapConfig()
      )
    ).toMatchObject({ provider: "cursor" });
  });

  test("Cursor root resolution falls back to cwd without a provider env var", async () => {
    const config = loadBootstrapConfig();
    const cwdRoot = await makeRepoRoot();
    expect(
      resolveRepoRoot(
        cwdRoot,
        { CURSOR_AGENT: "1" } as NodeJS.ProcessEnv,
        config,
        "cursor"
      )
    ).toBe(cwdRoot);
  });

  test("linked worktree detection compares git dir and common dir", () => {
    expect(isLinkedWorktree(".git/worktrees/branch", ".git")).toBe(true);
    expect(isLinkedWorktree(".git", ".git")).toBe(false);
  });

  test("optional tool absence is reported without throwing", () => {
    expect(collectToolStatus(["definitely-not-a-real-tool"], repoRoot)).toEqual(
      [{ name: "definitely-not-a-real-tool", present: false }]
    );
  });

  test("teardown rejects cleanup targets outside the repo", () => {
    expect(() => resolveCleanupTarget(repoRoot, "../outside")).toThrow(
      "outside repo"
    );
  });

  test("teardown cleanup includes current generated state paths", () => {
    const config = loadBootstrapConfig();
    expect(config.cleanup.directories).toContain("dist");
    expect(config.cleanup.directories).not.toContain(".skillset/cache");
    expect(config.cleanup.directories).not.toContain(".skillset/snapshots");
  });
});

describe("readRepoHealth", () => {
  const initRepo = async (): Promise<string> => {
    const disposableRoot = await createTestGitFixtureRoot(
      "skillset-repo-health-"
    );
    const root = await mkdtemp(join(disposableRoot, "repo-"));
    writeFileSync(join(root, "file.txt"), "x\n");
    await initializeTestGitRepository(root, { disposableRoot });
    return root;
  };

  test("reports a healthy repo", async () => {
    const root = await initRepo();
    const health = readRepoHealth(root);
    expect(health.coreBare).toBe(false);
    expect(health.staleWorktrees).toEqual([]);
  });

  test("flags core.bare corruption", async () => {
    const root = await initRepo();
    await runTestGit(root, "config", "core.bare", "true");
    expect(readRepoHealth(root).coreBare).toBe(true);
  });

  test("flags worktrees locked by dead processes and keeps live locks", async () => {
    const root = await initRepo();
    const deadPath = join(root, "wt-dead");
    const livePath = join(root, "wt-live");
    await runTestGit(root, "worktree", "add", "-q", deadPath);
    await runTestGit(root, "worktree", "add", "-q", livePath);
    await runTestGit(
      root,
      "worktree",
      "lock",
      "--reason",
      "agent x (pid 999999999 start now)",
      deadPath
    );
    await runTestGit(
      root,
      "worktree",
      "lock",
      "--reason",
      `agent y (pid ${process.pid} start now)`,
      livePath
    );

    const health = readRepoHealth(root);
    // git reports realpath; macOS tmpdir is a symlink, so compare suffixes.
    expect(
      health.staleWorktrees.map((worktree) =>
        worktree.path.endsWith("/wt-dead")
      )
    ).toEqual([true]);
  });
});
