import { readFileSync } from "node:fs";

import { repoFile, run, runInherit } from "./shared";
import type { BunPolicy } from "./config";

export interface BunCheck {
  readonly actual: string | undefined;
  readonly ok: boolean;
  readonly pinned: string;
  readonly policy: BunPolicy;
  readonly reason?: string | undefined;
}

interface PackageJson {
  readonly packageManager?: string;
  readonly engines?: {
    readonly bun?: string;
  };
}

export const minimumFromEngineRange = (
  range: string | undefined
): string | undefined => range?.match(/(\d+\.\d+\.\d+)/)?.[1];

export const isVersionAtLeast = (actual: string, minimum: string): boolean =>
  Bun.semver.satisfies(actual, `>=${minimum}`);

export const isCompatibleBunVersion = (
  actual: string,
  pinned: string
): boolean => Bun.semver.satisfies(actual, `~${pinned}`);

export const isBunVersionAllowed = (
  actual: string,
  pinned: string,
  policy: BunPolicy
): boolean =>
  policy === "strict"
    ? actual === pinned
    : isCompatibleBunVersion(actual, pinned);

export const readPinnedBunVersion = (
  repoRoot: string,
  versionFile = ".bun-version"
): string => readFileSync(repoFile(repoRoot, versionFile), "utf8").trim();

const readPackageJson = (repoRoot: string): PackageJson =>
  JSON.parse(
    readFileSync(repoFile(repoRoot, "package.json"), "utf8")
  ) as PackageJson;

export const readPackageManagerBunVersion = (
  repoRoot: string
): string | undefined => {
  const packageManager = readPackageJson(repoRoot).packageManager;
  return packageManager?.match(/^bun@(.+)$/)?.[1];
};

export const readMinimumBunVersion = (repoRoot: string): string | undefined => {
  const packageJson = JSON.parse(
    readFileSync(repoFile(repoRoot, "package.json"), "utf8")
  ) as PackageJson;
  return minimumFromEngineRange(packageJson.engines?.bun);
};

export const checkBunVersion = (
  repoRoot: string,
  policy: BunPolicy,
  versionFile?: string
): BunCheck => {
  const pinned = readPinnedBunVersion(repoRoot, versionFile);
  const result = run(["bun", "--version"], repoRoot);
  const actual = result.exitCode === 0 ? result.stdout.trim() : undefined;

  if (actual === undefined || actual.length === 0) {
    return {
      actual,
      ok: false,
      pinned,
      policy,
      reason: "Bun is not available on PATH",
    };
  }

  const ok = isBunVersionAllowed(actual, pinned, policy);
  return {
    actual,
    ok,
    pinned,
    policy,
    ...(ok
      ? {}
      : {
          reason:
            policy === "strict"
              ? `Expected Bun ${pinned}, found ${actual}`
              : `Expected Bun ${pinned} or newer compatible patch, found ${actual}`,
        }),
  };
};

export const installPinnedBun = async (
  repoRoot: string,
  versionFile?: string
): Promise<void> => {
  const pinned = readPinnedBunVersion(repoRoot, versionFile);
  const code = await runInherit(
    [
      "bash",
      "-lc",
      'curl -fsSL https://bun.sh/install | bash -s -- "$1"',
      "bash",
      `bun-v${pinned}`,
    ],
    repoRoot
  );
  if (code !== 0) {
    throw new Error(`Bun install failed with exit code ${String(code)}`);
  }
};
