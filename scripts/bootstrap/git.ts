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
  maxStackLines: number
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
    "  Branches and gh stack state are shared with the main checkout."
  );
  console.error(
    "  Lifecycle hooks should avoid mutating stacks or deleting branches."
  );

  if (!has("gh")) {
    console.error("  gh: missing (stack inspection disabled)");
    return;
  }

  // `gh` does not include `gh stack`. A missing extension, auth failure, or
  // disambiguation error must not be reported as an empty stack.
  const extensions = run(["gh", "extension", "list"], repoRoot);
  if (!extensionListIncludesGhStack(extensions.stdout)) {
    console.error("  gh stack: missing (stack inspection disabled)");
    return;
  }

  const view = run(["gh", "stack", "view", "--short"], repoRoot);
  if (view.exitCode !== 0) {
    console.error(describeGhStackViewFailure(view.exitCode));
    return;
  }

  console.error("");
  console.error(`gh stack (first ${String(maxStackLines)} lines)`);
  for (const line of view.stdout.split("\n").slice(0, maxStackLines)) {
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

const GH_STACK_EXTENSION_REPO = "github/gh-stack";
// github/gh-stack: 2 = branch is not in a stack, 4 = auth or API failure,
// 6 = branch belongs to more than one stack.
const GH_STACK_EXIT_NOT_IN_STACK = 2;
const GH_STACK_EXIT_AUTH_OR_API = 4;
const GH_STACK_EXIT_AMBIGUOUS = 6;

export const extensionListIncludesGhStack = (stdout: string): boolean =>
  stdout.split("\n").some((line) => {
    const fields = line.trim().split(/\s+/);
    return (
      fields.includes(GH_STACK_EXTENSION_REPO) ||
      (fields[0] === "gh" && fields[1] === "stack")
    );
  });

export const describeGhStackViewFailure = (exitCode: number): string => {
  switch (exitCode) {
    case GH_STACK_EXIT_NOT_IN_STACK: {
      return "  gh stack: no stack for this branch";
    }
    case GH_STACK_EXIT_AUTH_OR_API: {
      return "  gh stack: GitHub auth or API failure (stack inspection disabled)";
    }
    case GH_STACK_EXIT_AMBIGUOUS: {
      return "  gh stack: branch belongs to multiple stacks";
    }
    default: {
      return "  gh stack: unavailable (stack inspection disabled)";
    }
  }
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
