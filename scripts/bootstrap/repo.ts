import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import type { BunCheck } from "./bun";
import { checkBunVersion, installPinnedBun } from "./bun";
import type { BootstrapConfig } from "./config";
import { readWorktreeInfo } from "./git";
import type { HostInfo } from "./host";
import { info, runInherit, success, warn } from "./shared";
import { collectToolStatus, printToolStatuses } from "./tools";

export interface RepoBootstrapOptions {
  readonly config: BootstrapConfig;
  readonly force: boolean;
  readonly host: HostInfo;
  readonly repoRoot: string;
  readonly update: boolean;
}

export interface BunDeps {
  readonly checkBunVersion?: (
    repoRoot: string,
    policy: HostInfo["bunPolicy"],
    versionFile?: string
  ) => BunCheck;
  readonly installPinnedBun?: (
    repoRoot: string,
    versionFile?: string
  ) => Promise<void>;
}

export const listWorkspaceGlobs = async (
  repoRoot: string
): Promise<readonly string[]> => {
  const packageJson = (await Bun.file(join(repoRoot, "package.json")).json()) as {
    readonly workspaces?: readonly string[];
  };
  return Array.isArray(packageJson.workspaces) ? packageJson.workspaces : [];
};

const expandWorkspaceGlob = (
  repoRoot: string,
  workspaceGlob: string
): readonly string[] => {
  if (!workspaceGlob.endsWith("/*")) {
    return [join(repoRoot, workspaceGlob)];
  }
  const base = join(repoRoot, workspaceGlob.slice(0, -2));
  if (!existsSync(base)) {
    return [];
  }
  return readdirSync(base)
    .map((entry) => join(base, entry))
    .filter((entry) => statSync(entry).isDirectory());
};

export const hasRepoInstallState = async (
  repoRoot: string
): Promise<boolean> => {
  if (!existsSync(join(repoRoot, "node_modules"))) {
    return false;
  }
  for (const workspaceGlob of await listWorkspaceGlobs(repoRoot)) {
    for (const dir of expandWorkspaceGlob(repoRoot, workspaceGlob)) {
      if (
        existsSync(join(dir, "package.json")) &&
        !existsSync(join(dir, "node_modules"))
      ) {
        return false;
      }
    }
  }
  return true;
};

export const ensureBunAvailable = async (
  options: RepoBootstrapOptions,
  deps: BunDeps = {}
): Promise<void> => {
  const readCheck = deps.checkBunVersion ?? checkBunVersion;
  const repairBun = deps.installPinnedBun ?? installPinnedBun;
  let check = readCheck(
    options.repoRoot,
    options.host.bunPolicy,
    options.config.bun.versionFile
  );
  if (!check.ok) {
    warn(check.reason ?? "Bun version check failed");
    info(`Repairing Bun runtime to pinned ${check.pinned}`);
    await repairBun(options.repoRoot, options.config.bun.versionFile);
    check = readCheck(
      options.repoRoot,
      options.host.bunPolicy,
      options.config.bun.versionFile
    );
    if (!check.ok) {
      throw new Error(check.reason ?? "Bun version check failed");
    }
  }
  success(
    `Bun ready (${check.actual}, ${check.policy} policy; pinned ${check.pinned})`
  );
};

const installDependencies = async (
  repoRoot: string,
  update: boolean
): Promise<void> => {
  info(
    update
      ? "Refreshing project dependencies with Bun"
      : "Installing project dependencies with Bun (frozen lockfile)"
  );
  const code = await runInherit(
    update ? ["bun", "install"] : ["bun", "install", "--frozen-lockfile"],
    repoRoot
  );
  if (code !== 0) {
    throw new Error(`bun install failed with exit code ${String(code)}`);
  }
  success("Dependencies installed");
};

export const runRepoBootstrap = async (
  options: RepoBootstrapOptions
): Promise<void> => {
  await ensureBunAvailable(options);

  const installStateReady = await hasRepoInstallState(options.repoRoot);
  if (!options.force && !options.update && installStateReady) {
    success("Dependencies already available");
  } else {
    const worktree = readWorktreeInfo(options.repoRoot);
    if (worktree.linked) {
      info(
        "Linked worktree detected; installing dependencies locally for this checkout"
      );
    }
    await installDependencies(options.repoRoot, options.update);
  }

  if (options.config.checks.optionalTools.length > 0) {
    const statuses = collectToolStatus(
      options.config.checks.optionalTools,
      options.repoRoot
    );
    console.error("");
    printToolStatuses("Optional capabilities", statuses, true);
    if (statuses.some((status) => !status.present)) {
      warn("Missing optional capabilities do not block bootstrap.");
    }
  }
};
