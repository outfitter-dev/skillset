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

const numeric = String.raw`0|[1-9]\d*`;
const wildcard = String.raw`[xX*]`;
const identifiers = String.raw`[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*`;
/** `MAJOR[.MINOR[.PATCH]]`, wildcards allowed, plus prerelease and build. */
const partialVersion = String.raw`(?:${numeric}|${wildcard})(?:\.(?:${numeric}|${wildcard})){0,2}(?:-${identifiers})?(?:\+${identifiers})?`;
const comparatorPattern = new RegExp(
  String.raw`^(?:<=|>=|<|>|=|\^|~)?${partialVersion}$`,
  "u"
);
const hyphenRangePattern = new RegExp(
  String.raw`^${partialVersion}\s+-\s+${partialVersion}$`,
  "u"
);

/**
 * The first token of `range` outside the strict semver range grammar: `||`
 * separates comparator sets, each a hyphen range `A - B` or whitespace-
 * separated comparators. `""` names an empty comparator set; `undefined`
 * means the whole range is valid.
 */
const invalidRangeToken = (range: string): string | undefined => {
  for (const set of range.split("||").map((part) => part.trim())) {
    if (set.length === 0) return "";
    if (hyphenRangePattern.test(set)) continue;
    const bad = set.split(/\s+/u).find((token) => !comparatorPattern.test(token));
    if (bad !== undefined) return bad;
  }
  return undefined;
};

/**
 * Why `range` cannot serve as the supported Bun range (`engines.bun`), or
 * `undefined` when it can.
 *
 * `Bun.semver.satisfies` has no parse error: it skips what it cannot read, so
 * `garbage` matches every version and `>=1.4.0 || garbage >0.0.0` admits
 * 1.2.0. Every token must therefore match the strict range grammar, and the
 * range must not admit `0.0.0`, since a range without a floor would accept
 * any runtime.
 */
export const supportedBunRangeProblem = (
  range: unknown
): string | undefined => {
  if (typeof range !== "string" || range.length === 0) {
    return "must declare a supported Bun range";
  }
  const token = invalidRangeToken(range);
  if (token !== undefined) {
    return `${JSON.stringify(range)} is not a valid semver range: unexpected ${token.length === 0 ? "empty comparator set" : `token ${JSON.stringify(token)}`}`;
  }
  return Bun.semver.satisfies("0.0.0", range)
    ? `${JSON.stringify(range)} must set a lower bound: it admits 0.0.0`
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
