import { has, run } from "./shared";

export interface WorktreeInfo {
  readonly branch: string | undefined;
  readonly commonDir: string | undefined;
  readonly gitDir: string | undefined;
  readonly linked: boolean;
}

export const isLinkedWorktree = (
  gitDir: string | undefined,
  commonDir: string | undefined
): boolean =>
  gitDir !== undefined &&
  commonDir !== undefined &&
  gitDir.length > 0 &&
  commonDir.length > 0 &&
  gitDir !== commonDir;

export const readWorktreeInfo = (repoRoot: string): WorktreeInfo => {
  const gitDir = run(["git", "rev-parse", "--git-dir"], repoRoot);
  const commonDir = run(["git", "rev-parse", "--git-common-dir"], repoRoot);
  const branch = run(["git", "branch", "--show-current"], repoRoot);
  const resolvedGitDir =
    gitDir.exitCode === 0 ? gitDir.stdout.trim() : undefined;
  const resolvedCommonDir =
    commonDir.exitCode === 0 ? commonDir.stdout.trim() : undefined;
  const resolvedBranch =
    branch.exitCode === 0 && branch.stdout.trim().length > 0
      ? branch.stdout.trim()
      : undefined;

  return {
    branch: resolvedBranch,
    commonDir: resolvedCommonDir,
    gitDir: resolvedGitDir,
    linked: isLinkedWorktree(resolvedGitDir, resolvedCommonDir),
  };
};

export const printAgentGitDiagnostics = (
  repoRoot: string,
  maxGraphiteLines: number
): void => {
  const info = readWorktreeInfo(repoRoot);
  if (!info.linked) {
    return;
  }

  console.error("");
  console.error("Linked worktree detected");
  console.error(`  branch: ${info.branch ?? "detached HEAD"}`);
  if (info.branch === undefined) {
    console.error(
      "  Create or switch to a real branch before committing from this worktree."
    );
  }
  console.error(
    "  Graphite branches and metadata are shared with the main checkout."
  );
  console.error(
    "  Lifecycle hooks should avoid mutating Graphite stacks or deleting branches."
  );

  if (!has("gt")) {
    console.error("  gt: missing (Graphite stack inspection disabled)");
    return;
  }

  const log = run(["gt", "log", "--no-interactive"], repoRoot);
  if (log.exitCode !== 0) {
    console.error("  gt log unavailable");
    return;
  }

  console.error("");
  console.error(`Graphite stack (first ${String(maxGraphiteLines)} lines)`);
  for (const line of log.stdout.split("\n").slice(0, maxGraphiteLines)) {
    if (line.length > 0) {
      console.error(line);
    }
  }
};

export interface RepoHealth {
  readonly coreBare: boolean;
  readonly staleWorktrees: readonly StaleWorktree[];
}

export interface StaleWorktree {
  readonly path: string;
  readonly reason: string;
}

/**
 * Shared-repo health: `core.bare` must stay false for a repo with working
 * trees (a concurrent tool once flipped it and broke every checkout), and
 * worktrees whose agent lock points at a dead process are stale leftovers.
 */
export const readRepoHealth = (repoRoot: string): RepoHealth => {
  const bare = run(["git", "config", "core.bare"], repoRoot);
  const coreBare = bare.exitCode === 0 && bare.stdout.trim() === "true";

  const staleWorktrees: StaleWorktree[] = [];
  const list = run(["git", "worktree", "list", "--porcelain"], repoRoot);
  if (list.exitCode === 0) {
    let path: string | undefined;
    for (const line of list.stdout.split("\n")) {
      if (line.startsWith("worktree ")) {path = line.slice("worktree ".length);}
      if (line.startsWith("locked") && path !== undefined) {
        const match = /pid (\d+)/.exec(line);
        if (match?.[1] !== undefined && !isProcessAlive(Number(match[1]))) {
          staleWorktrees.push({
            path,
            reason: `lock holder pid ${match[1]} is not running`,
          });
        }
      }
    }
  }

  return { coreBare, staleWorktrees };
};

const isProcessAlive = (pid: number): boolean => {
  if (!Number.isInteger(pid) || pid <= 0) {return false;}
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "EPERM"
    );
  }
};
