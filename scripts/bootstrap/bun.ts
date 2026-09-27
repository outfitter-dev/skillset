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

type Release = readonly [number, number, number];

const releasePattern = String.raw`(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)`;
const prereleaseIdentifier = String.raw`(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)`;
const buildIdentifier = String.raw`[0-9A-Za-z-]+`;
/** A whole SemVer version: release, strict prerelease, optional build. */
const versionPattern = new RegExp(
  String.raw`^${releasePattern}(-${prereleaseIdentifier}(?:\.${prereleaseIdentifier})*)?(?:\+${buildIdentifier}(?:\.${buildIdentifier})*)?$`,
  "u"
);
const lowerBoundPattern = new RegExp(String.raw`^>=${releasePattern}$`, "u");
const upperBoundPattern = new RegExp(String.raw`^<${releasePattern}$`, "u");

const release = (match: RegExpMatchArray): Release => [
  Number(match[1]),
  Number(match[2]),
  Number(match[3]),
];

const compareReleases = (left: Release, right: Release): number =>
  left[0] - right[0] || left[1] - right[1] || left[2] - right[2];

/** Whether `version` is a whole strict SemVer version, never a prefix. */
export const isStrictBunVersion = (version: string): boolean =>
  versionPattern.test(version);

/** The only `engines.bun` shape this repo supports. */
const SUPPORTED_RANGE_FORM = ">=X.Y.Z [<X.Y.Z]";

interface SupportedBunRange {
  readonly lower: Release;
  readonly upper?: Release;
}

type ParsedRange =
  | { readonly range: SupportedBunRange }
  | { readonly problem: string };

/**
 * Parse `>=X.Y.Z [<X.Y.Z]`.
 *
 * `Bun.semver` has no parse error: it skips tokens it cannot read and widens
 * ones it half-reads (`1.x.2` as `1.x`, `>=1.4.0-01` as `>=1.4.0`), so any
 * wider grammar lets a range admit versions below its intended floor. This
 * repo needs one floor and at most one exclusive ceiling, so everything else
 * is rejected, naming the first token outside that shape.
 */
const parseSupportedBunRange = (range: unknown): ParsedRange => {
  if (typeof range !== "string" || range.trim().length === 0) {
    return { problem: "must declare a supported Bun range" };
  }
  const [first = "", second, ...rest] = range.trim().split(/\s+/u);
  const lower = first.match(lowerBoundPattern);
  const upper = second === undefined ? null : second.match(upperBoundPattern);
  const offender =
    lower === null
      ? first
      : second !== undefined && upper === null
        ? second
        : rest[0];
  if (lower === null || offender !== undefined) {
    return {
      problem: `${JSON.stringify(range)} must have the form ${SUPPORTED_RANGE_FORM}: unexpected token ${JSON.stringify(offender)}`,
    };
  }
  const bounds: SupportedBunRange =
    upper === null
      ? { lower: release(lower) }
      : { lower: release(lower), upper: release(upper) };
  if (compareReleases(bounds.lower, [0, 0, 0]) === 0) {
    return {
      problem: `${JSON.stringify(range)} must set a lower bound: it admits 0.0.0`,
    };
  }
  if (
    bounds.upper !== undefined &&
    compareReleases(bounds.upper, bounds.lower) <= 0
  ) {
    return {
      problem: `${JSON.stringify(range)} admits no version: the upper bound must exceed the lower bound`,
    };
  }
  return { range: bounds };
};

/**
 * Why `range` cannot serve as the supported Bun range (`engines.bun`), or
 * `undefined` when it can. See `parseSupportedBunRange` for the shape.
 */
export const supportedBunRangeProblem = (
  range: unknown
): string | undefined => {
  const parsed = parseSupportedBunRange(range);
  return "problem" in parsed ? parsed.problem : undefined;
};

/**
 * Whether a Bun version is in `range`. The version must be a whole strict
 * SemVer version. A prerelease is admitted only when the release it previews
 * is in range and it does not precede the floor: `1.4.1-canary.20` passes
 * `>=1.4.0`, while `1.4.0-canary.1` (before 1.4.0) and `1.5.0-canary.1`
 * against `<1.5.0` do not. An invalid range admits nothing.
 */
export const satisfiesSupportedBunRange = (
  version: string,
  range: string
): boolean => {
  const parsed = parseSupportedBunRange(range);
  const match = version.match(versionPattern);
  if ("problem" in parsed || match === null) return false;
  const candidate = release(match);
  const isPrerelease = match[4] !== undefined;
  const floor = compareReleases(candidate, parsed.range.lower);
  if (floor < 0 || (floor === 0 && isPrerelease)) return false;
  return (
    parsed.range.upper === undefined ||
    compareReleases(candidate, parsed.range.upper) < 0
  );
};

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
