import { readFileSync } from "node:fs";

import { prependExecutablePath, resolvePinnedBun } from "../pinned-bun";
import { repoFile, run } from "./shared";
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
}

// Bun canary and other prerelease builds report versions like
// `1.4.1-canary.20`, and semver ranges never match prereleases. Compare on
// the numeric base version so those builds pass, matching the shell gate in
// scripts/bootstrap.sh.
export const baseVersion = (version: string): string =>
  version.match(/^\d+\.\d+\.\d+/)?.[0] ?? version;

/**
 * Why `range` cannot serve as the supported Bun range (`engines.bun`), or
 * `undefined` when it can.
 *
 * `Bun.semver.satisfies` has no parse error: an unparseable range such as
 * `garbage` matches every version. A range that admits `0.0.0` is therefore
 * either malformed or sets no floor, and both would accept any runtime.
 */
export const supportedBunRangeProblem = (
  range: unknown
): string | undefined => {
  if (typeof range !== "string" || range.length === 0) {
    return "must declare a supported Bun range";
  }
  return Bun.semver.satisfies("0.0.0", range)
    ? `${JSON.stringify(range)} must set a lower bound: it admits 0.0.0, and Bun.semver matches an unparseable range against every version`
    : undefined;
};

/** Whether a Bun version, compared on its numeric base, is in `range`. */
export const satisfiesSupportedBunRange = (
  version: string,
  range: string
): boolean => Bun.semver.satisfies(baseVersion(version), range);

export const isCompatibleBunVersion = (
  actual: string,
  pinned: string
): boolean => Bun.semver.satisfies(baseVersion(actual), `~${pinned}`);

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

export const installPinnedBun = async (repoRoot: string): Promise<void> => {
  const runtime = await resolvePinnedBun(repoRoot);
  process.env.PATH = prependExecutablePath(runtime.binDir, process.env.PATH);
};
