import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { REQUIRED_NATIVE_TARGETS } from "./native-targets";

const repository = "outfitter-dev/skillset";

export const HOMEBREW_TARGETS = REQUIRED_NATIVE_TARGETS.filter(
  (target) => target.os === "darwin" || target.os === "linux"
);

interface GitHubReleaseAsset {
  readonly name: string;
}

interface GitHubRelease {
  readonly assets: readonly GitHubReleaseAsset[];
  readonly draft: boolean;
  readonly tag_name: string;
}

interface HomebrewFormulaInput {
  readonly checksums: Readonly<Record<string, string>>;
  readonly version: string;
}

interface ParsedArgs {
  readonly assetsDir: string | undefined;
  readonly command: string;
  readonly output: string | undefined;
  readonly releaseJson: string | undefined;
  readonly version: string;
}

const SEMVER_PATTERN =
  /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u;

const validateVersion = (version: string): void => {
  if (!SEMVER_PATTERN.test(version)) {
    throw new Error(`Skillset version must be valid SemVer: ${version}`);
  }
};

export const homebrewAssetName = (version: string, suffix: string): string =>
  `skillset-v${version}-${suffix}.tar.gz`;

export const expectedHomebrewAssets = (version: string): readonly string[] =>
  HOMEBREW_TARGETS.map((target) => homebrewAssetName(version, target.suffix));

const parseReleaseAsset = (
  value: unknown,
  index: number
): GitHubReleaseAsset => {
  if (!value || typeof value !== "object") {
    throw new Error(`Release asset ${index} must be an object`);
  }
  const { name } = value as { readonly name?: unknown };
  if (typeof name !== "string" || name.length === 0) {
    throw new Error(`Release asset ${index} must have a name`);
  }
  return { name };
};

export const validatePublishedRelease = (
  value: unknown,
  version: string
): GitHubRelease => {
  validateVersion(version);
  if (!value || typeof value !== "object") {
    throw new Error("GitHub release metadata must be an object");
  }
  const candidate = value as {
    readonly assets?: unknown;
    readonly draft?: unknown;
    readonly tag_name?: unknown;
  };
  if (candidate.draft !== false) {
    throw new Error(`GitHub release v${version} must be published, not draft`);
  }
  if (candidate.tag_name !== `v${version}`) {
    throw new Error(
      `GitHub release tag ${String(candidate.tag_name)} does not match v${version}`
    );
  }
  if (!Array.isArray(candidate.assets)) {
    throw new TypeError(`GitHub release v${version} must list its assets`);
  }

  const assets = candidate.assets.map(parseReleaseAsset);
  const counts = new Map<string, number>();
  for (const asset of assets) {
    counts.set(asset.name, (counts.get(asset.name) ?? 0) + 1);
  }
  for (const expected of expectedHomebrewAssets(version)) {
    const count = counts.get(expected) ?? 0;
    if (count === 0) {
      throw new Error(`GitHub release v${version} is missing ${expected}`);
    }
    if (count > 1) {
      throw new Error(
        `GitHub release v${version} contains ${count} assets named ${expected}`
      );
    }
  }
  return { assets, draft: false, tag_name: `v${version}` };
};

const checksum = (bytes: Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex");

const url = (version: string, suffix: string): string => {
  const asset = homebrewAssetName(version, suffix);
  return `https://github.com/${repository}/releases/download/v${version}/${asset}`;
};

const targetBlock = (
  version: string,
  checksums: Readonly<Record<string, string>>,
  suffix: string,
  indent: string
): string[] => {
  const asset = homebrewAssetName(version, suffix);
  const digest = checksums[asset];
  if (!digest) {
    throw new Error(`Missing checksum for ${asset}`);
  }
  return [
    `${indent}url "${url(version, suffix)}"`,
    `${indent}sha256 "${digest}"`,
  ];
};

export const renderHomebrewFormula = (input: HomebrewFormulaInput): string => {
  const { checksums, version } = input;
  validateVersion(version);
  const lines = [
    "class Skillset < Formula",
    '  desc "Source-first compiler for provider-native agent loadouts"',
    `  homepage "https://github.com/${repository}"`,
    `  version "${version}"`,
    '  license "MIT"',
    "",
    "  on_macos do",
    "    if Hardware::CPU.arm?",
    ...targetBlock(version, checksums, "darwin-arm64", "      "),
    "    else",
    ...targetBlock(version, checksums, "darwin-x64", "      "),
    "    end",
    "  end",
    "",
    "  on_linux do",
    "    if Hardware::CPU.arm?",
    ...targetBlock(version, checksums, "linux-arm64-glibc", "      "),
    "    else",
    ...targetBlock(version, checksums, "linux-x64-glibc", "      "),
    "    end",
    "  end",
    "",
    "  def install",
    '    bin.install "skillset"',
    "  end",
    "",
    "  test do",
    '    assert_equal version.to_s, shell_output("#{bin}/skillset --version").strip',
    '    output = shell_output("#{bin}/skillset lookup workspace --json")',
    '    assert_match "\\\"command\\\":\\\"lookup\\\"", output',
    '    assert_match "\\\"ok\\\":true", output',
    "  end",
    "end",
  ];
  return `${lines.join("\n")}\n`;
};

export const renderHomebrewFormulaFromAssets = async (options: {
  readonly assetsDir: string;
  readonly output: string;
  readonly version: string;
}): Promise<void> => {
  const checksums = Object.fromEntries(
    await Promise.all(
      expectedHomebrewAssets(options.version).map(async (asset) => [
        asset,
        checksum(
          new Uint8Array(await readFile(path.join(options.assetsDir, asset)))
        ),
      ])
    )
  );
  await writeFile(
    options.output,
    renderHomebrewFormula({ checksums, version: options.version })
  );
};

const readValue = (
  args: readonly string[],
  index: number,
  flag: string
): string => {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
};

export const parseHomebrewArgs = (args: readonly string[]): ParsedArgs => {
  const command = args[0] ?? "";
  let assetsDir: string | undefined;
  let output: string | undefined;
  let releaseJson: string | undefined;
  let version = "";
  for (let index = 1; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg) {
      throw new Error(`Missing Homebrew argument at index ${index}`);
    }
    const value = readValue(args, index, arg);
    index += 1;
    switch (arg) {
      case "--assets-dir": {
        assetsDir = value;
        break;
      }
      case "--output": {
        output = value;
        break;
      }
      case "--release-json": {
        releaseJson = value;
        break;
      }
      case "--version": {
        version = value;
        break;
      }
      default: {
        throw new Error(`Unknown Homebrew argument: ${arg}`);
      }
    }
  }
  if (!version) {
    throw new Error("--version is required");
  }
  return { assetsDir, command, output, releaseJson, version };
};

const main = async (): Promise<void> => {
  const args = parseHomebrewArgs(process.argv.slice(2));
  if (args.command === "validate-release") {
    if (!args.releaseJson || args.assetsDir || args.output) {
      throw new Error(
        "validate-release requires only --release-json and --version"
      );
    }
    validatePublishedRelease(
      JSON.parse(await readFile(args.releaseJson, "utf-8")),
      args.version
    );
    console.error(`skillset: validated published release v${args.version}`);
    return;
  }
  if (args.command === "render") {
    if (!args.assetsDir || !args.output || args.releaseJson) {
      throw new Error("render requires --assets-dir, --output, and --version");
    }
    await renderHomebrewFormulaFromAssets({
      assetsDir: args.assetsDir,
      output: args.output,
      version: args.version,
    });
    console.error(`skillset: rendered Homebrew formula for v${args.version}`);
    return;
  }
  throw new Error("Expected Homebrew command validate-release or render");
};

if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    console.error(`skillset: ${(error as Error).message}`);
    process.exit(1);
  }
}
