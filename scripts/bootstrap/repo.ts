import { existsSync, readdirSync, statSync } from "node:fs";
import { chmod, lstat } from "node:fs/promises";
import { join } from "node:path";

import type { BunCheck } from "./bun";
import { checkBunVersion, installPinnedBun } from "./bun";
import type { BootstrapConfig } from "./config";
import { readWorktreeInfo } from "./git";
import type { HostInfo } from "./host";
import { has, info, run, runInherit, success, warn } from "./shared";
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

export interface CheckoutModeNormalization {
  readonly executable: number;
  readonly regular: number;
}

export const normalizeTrackedCheckoutModes = async (
  repoRoot: string,
  platform: NodeJS.Platform = process.platform
): Promise<CheckoutModeNormalization> => {
  if (platform === "win32") {
    return { executable: 0, regular: 0 };
  }

  const tracked = run(["git", "ls-files", "--stage", "-z"], repoRoot);
  if (tracked.exitCode !== 0) {
    throw new Error(
      tracked.stderr.trim() ||
        "git ls-files failed while normalizing checkout modes"
    );
  }

  const normalized = await Promise.all(
    tracked.stdout.split("\0").map(async (record) => {
      const separator = record.indexOf("\t");
      const [mode, , stage] = record.slice(0, separator).split(" ");
      if (
        record.length === 0 ||
        separator === -1 ||
        stage !== "0" ||
        (mode !== "100644" && mode !== "100755")
      ) {
        return undefined;
      }
      const path = join(repoRoot, record.slice(separator + 1));
      const entry = await lstat(path).catch(() => null);
      if (entry === null || !entry.isFile()) {
        return undefined;
      }
      const expected = mode === "100755" ? 0o755 : 0o644;
      if (entry.mode % 0o1000 === expected) {
        return undefined;
      }
      await chmod(path, expected);
      return expected;
    })
  );
  return {
    executable: normalized.filter((mode) => mode === 0o755).length,
    regular: normalized.filter((mode) => mode === 0o644).length,
  };
};

export const listWorkspaceGlobs = async (
  repoRoot: string
): Promise<readonly string[]> => {
  const packageJson = (await Bun.file(
    join(repoRoot, "package.json")
  ).json()) as {
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
      if (!(await workspaceNeedsNodeModules(dir))) {
        continue;
      }
      if (!existsSync(join(dir, "node_modules"))) {
        return false;
      }
    }
  }
  return true;
};

const DEPENDENCY_FIELDS = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
] as const;

const workspaceNeedsNodeModules = async (dir: string): Promise<boolean> => {
  const packageJsonPath = join(dir, "package.json");
  if (!existsSync(packageJsonPath)) {
    return false;
  }
  const packageJson = (await Bun.file(packageJsonPath).json()) as Record<
    string,
    unknown
  >;
  return DEPENDENCY_FIELDS.some((field) => {
    const dependencies = packageJson[field];
    return (
      typeof dependencies === "object" &&
      dependencies !== null &&
      Object.keys(dependencies).length > 0
    );
  });
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

  if (has("git")) {
    try {
      const normalized = await normalizeTrackedCheckoutModes(options.repoRoot);
      const total = normalized.executable + normalized.regular;
      success(
        total === 0
          ? "Tracked checkout modes already portable"
          : `Normalized ${String(total)} tracked checkout modes (${String(normalized.regular)} regular, ${String(normalized.executable)} executable)`
      );
    } catch (error) {
      warn(
        error instanceof Error
          ? `${error.message}; checkout modes were not normalized.`
          : "Could not normalize tracked checkout modes."
      );
    }
  } else {
    warn("Git is unavailable; tracked checkout modes were not normalized.");
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
