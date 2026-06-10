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

const parseVersionPart = (part: string): number => {
  const numeric = part.match(/^\d+/)?.[0] ?? "0";
  return Number(numeric);
};

const parseVersion = (version: string): readonly [number, number, number] => {
  const [major = "0", minor = "0", patch = "0"] = version.split(".");
  return [
    parseVersionPart(major),
    parseVersionPart(minor),
    parseVersionPart(patch),
  ];
};

export const minimumFromEngineRange = (
  range: string | undefined
): string | undefined => range?.match(/(\d+\.\d+\.\d+)/)?.[1];

export const isVersionAtLeast = (actual: string, minimum: string): boolean => {
  const actualParts = parseVersion(actual);
  const minimumParts = parseVersion(minimum);
  for (let index = 0; index < minimumParts.length; index += 1) {
    const actualPart = actualParts[index] ?? 0;
    const minimumPart = minimumParts[index] ?? 0;
    if (actualPart > minimumPart) return true;
    if (actualPart < minimumPart) return false;
  }
  return true;
};

export const isCompatibleBunVersion = (
  actual: string,
  pinned: string
): boolean => {
  const [actualMajor, actualMinor, actualPatch] = parseVersion(actual);
  const [pinnedMajor, pinnedMinor, pinnedPatch] = parseVersion(pinned);
  return (
    actualMajor === pinnedMajor &&
    actualMinor === pinnedMinor &&
    actualPatch >= pinnedPatch
  );
};

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
