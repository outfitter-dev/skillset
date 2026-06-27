import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
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
import { gitSafeEnv } from "../../apps/skillset/src/git-env";
import { isLinkedWorktree, readRepoHealth } from "../bootstrap/git";
import { detectHost, resolveRepoRoot } from "../bootstrap/host";
import { parseBootstrapArgs } from "../bootstrap/main";
import {
  ensureBunAvailable,
  hasRepoInstallState,
  listWorkspaceGlobs,
} from "../bootstrap/repo";
import { isRepoRoot } from "../bootstrap/shared";
import { resolveCleanupTarget } from "../bootstrap/teardown";
import { collectToolStatus } from "../bootstrap/tools";

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

const makeRepoRoot = (): string => {
  const root = mkdtempSync(join(tmpdir(), "skillset-bootstrap-root-"));
  mkdirSync(join(root, ".skillset"), { recursive: true });
  mkdirSync(join(root, "apps/skillset/src"), { recursive: true });
  writeFileSync(
    join(root, "package.json"),
    '{"name":"skillset-workspace","packageManager":"bun@1.3.14","engines":{"bun":">=1.3.14"},"workspaces":[]}\n'
  );
  writeFileSync(join(root, ".bun-version"), "1.3.14\n");
  writeFileSync(
    join(root, "skillset.yaml"),
    "skillset:\n  name: skillset\n"
  );
  writeFileSync(join(root, "apps/skillset/src/cli.ts"), "");
  return root;
};

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
      "repo|agent|codex|claude|doctor|teardown"
    );
  });
});

describe("bootstrap repo policy", () => {
  test("workspace globs stay aligned with root package.json", async () => {
    await expect(listWorkspaceGlobs(repoRoot)).resolves.toEqual(
      expectedWorkspaces
    );
  });

  test("Bun pin stays aligned across repo metadata", () => {
    expect(readPinnedBunVersion(repoRoot)).toBe("1.3.14");
    expect(readPackageManagerBunVersion(repoRoot)).toBe("1.3.14");
    expect(minimumFromEngineRange(packageJson.engines?.bun)).toBe("1.3.14");
  });

  test("Bun checks distinguish package floors from repo pins", () => {
    expect(minimumFromEngineRange(">=1.3.14")).toBe("1.3.14");
    expect(isVersionAtLeast("1.3.14", "1.3.14")).toBe(true);
    expect(isVersionAtLeast("1.3.15", "1.3.14")).toBe(true);
    expect(isVersionAtLeast("1.4.0", "1.3.14")).toBe(true);
    expect(isVersionAtLeast("1.3.13", "1.3.14")).toBe(false);
    expect(isCompatibleBunVersion("1.3.15", "1.3.14")).toBe(true);
    expect(isCompatibleBunVersion("1.4.0", "1.3.14")).toBe(false);
    expect(isBunVersionAllowed("1.3.14", "1.3.14", "strict")).toBe(true);
    expect(isBunVersionAllowed("1.3.15", "1.3.14", "strict")).toBe(false);
  });

  test("repo root detection accepts current and migration workspace markers", () => {
    const ordinaryRoot = makeRepoRoot();
    const legacyRoot = makeRepoRoot();
    const dedicatedRoot = makeRepoRoot();
    try {
      expect(isRepoRoot(ordinaryRoot)).toBe(true);

      rmSync(join(legacyRoot, "skillset.yaml"), { force: true });
      writeFileSync(join(legacyRoot, "skillset.yaml"), "skillset:\n  name: legacy\n");
      expect(isRepoRoot(legacyRoot)).toBe(true);

      rmSync(join(dedicatedRoot, "skillset.yaml"), { force: true });
      writeFileSync(join(dedicatedRoot, "skillset.yaml"), "skillset:\n  name: dedicated\n");
      mkdirSync(join(dedicatedRoot, "skillset"), { recursive: true });
      expect(isRepoRoot(dedicatedRoot)).toBe(true);
    } finally {
      rmSync(ordinaryRoot, { force: true, recursive: true });
      rmSync(legacyRoot, { force: true, recursive: true });
      rmSync(dedicatedRoot, { force: true, recursive: true });
    }
  });

  test("stale Bun is repaired before policy enforcement fails", async () => {
    const root = makeRepoRoot();
    const installs: string[] = [];
    let checks = 0;
    try {
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
                  actual: "1.3.13",
                  ok: false,
                  pinned: "1.3.14",
                  policy,
                  reason:
                    "Expected Bun 1.3.14 or newer compatible patch, found 1.3.13",
                }
              : {
                  actual: "1.3.14",
                  ok: true,
                  pinned: "1.3.14",
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
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  test("dependency state allows workspace packages without dependencies", async () => {
    const root = mkdtempSync(join(tmpdir(), "skillset-install-state-"));
    try {
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
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  test("root resolution prefers provider env vars before cwd", () => {
    const config = loadBootstrapConfig();
    const codexRoot = makeRepoRoot();
    const claudeRoot = makeRepoRoot();
    try {
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
    } finally {
      rmSync(codexRoot, { force: true, recursive: true });
      rmSync(claudeRoot, { force: true, recursive: true });
    }
  });

  test("provider-specific root resolution prefers the requested provider", () => {
    const config = loadBootstrapConfig();
    const codexRoot = makeRepoRoot();
    const claudeRoot = makeRepoRoot();
    try {
      expect(
        resolveRepoRoot(
          tmpdir(),
          {
            CLAUDE_PROJECT_DIR: claudeRoot,
            CODEX_WORKTREE_PATH: codexRoot,
          } as NodeJS.ProcessEnv,
          config,
          "claude"
        )
      ).toBe(claudeRoot);
    } finally {
      rmSync(codexRoot, { force: true, recursive: true });
      rmSync(claudeRoot, { force: true, recursive: true });
    }
  });

  test("Claude sentinel env does not act as a repo root", () => {
    const config = loadBootstrapConfig();
    const sentinelRoot = makeRepoRoot();
    const cwdRoot = makeRepoRoot();
    try {
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
    } finally {
      rmSync(sentinelRoot, { force: true, recursive: true });
      rmSync(cwdRoot, { force: true, recursive: true });
    }
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
    expect(config.cleanup.directories).toContain(".skillset/cache");
    expect(config.cleanup.directories).not.toContain(".skillset/snapshots");
  });
});

describe("readRepoHealth", () => {
  const git = (root: string, ...args: string[]): void => {
    Bun.spawnSync({ cmd: ["git", ...args], cwd: root, env: gitSafeEnv() });
  };

  const initRepo = (): string => {
    const root = mkdtempSync(join(tmpdir(), "skillset-repo-health-"));
    git(root, "init", "-q");
    return root;
  };

  test("reports a healthy repo", () => {
    const root = initRepo();
    const health = readRepoHealth(root);
    expect(health.coreBare).toBe(false);
    expect(health.staleWorktrees).toEqual([]);
    rmSync(root, { force: true, recursive: true });
  });

  test("flags core.bare corruption", () => {
    const root = initRepo();
    git(root, "config", "core.bare", "true");
    expect(readRepoHealth(root).coreBare).toBe(true);
    rmSync(root, { force: true, recursive: true });
  });

  test("flags worktrees locked by dead processes and keeps live locks", () => {
    const root = initRepo();
    git(root, "config", "user.email", "t@example.com");
    git(root, "config", "user.name", "t");
    writeFileSync(join(root, "file.txt"), "x\n");
    git(root, "add", ".");
    git(root, "commit", "-qm", "init");

    const deadPath = join(root, "wt-dead");
    const livePath = join(root, "wt-live");
    git(root, "worktree", "add", "-q", deadPath);
    git(root, "worktree", "add", "-q", livePath);
    git(root, "worktree", "lock", "--reason", "agent x (pid 999999999 start now)", deadPath);
    git(root, "worktree", "lock", "--reason", `agent y (pid ${process.pid} start now)`, livePath);

    const health = readRepoHealth(root);
    // git reports realpath; macOS tmpdir is a symlink, so compare suffixes.
    expect(
      health.staleWorktrees.map((worktree) =>
        worktree.path.endsWith("/wt-dead")
      )
    ).toEqual([true]);
    rmSync(root, { force: true, recursive: true });
  });
});
