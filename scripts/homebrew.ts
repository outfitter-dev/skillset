import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { nativeManifestName, parseNativeManifest } from "./native-artifacts";
import { REQUIRED_NATIVE_TARGETS, nativeArchiveName } from "./native-targets";
import { expectedReleaseAssetNames } from "./release-assets";

const repository = "outfitter-dev/skillset";

export const HOMEBREW_TARGETS = REQUIRED_NATIVE_TARGETS.filter(
  (target) => target.os === "darwin"
);

interface GitHubReleaseAsset {
  readonly name: string;
}

interface GitHubRelease {
  readonly assets: readonly GitHubReleaseAsset[];
  readonly draft: boolean;
  readonly prerelease: boolean;
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
  readonly readme: string | undefined;
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

const validateStableVersion = (version: string): void => {
  validateVersion(version);
  if (version.split("+")[0]?.includes("-")) {
    throw new Error(`Skillset Homebrew version must be stable: ${version}`);
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
  validateStableVersion(version);
  if (!value || typeof value !== "object") {
    throw new Error("GitHub release metadata must be an object");
  }
  const candidate = value as {
    readonly assets?: unknown;
    readonly draft?: unknown;
    readonly prerelease?: unknown;
    readonly tag_name?: unknown;
  };
  if (candidate.draft !== false) {
    throw new Error(`GitHub release v${version} must be published, not draft`);
  }
  if (candidate.prerelease !== false) {
    throw new Error(
      `GitHub release v${version} must be stable, not a prerelease`
    );
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
  const actualNames = assets.map((asset) => asset.name).toSorted();
  const expectedNames = expectedReleaseAssetNames(version).toSorted();
  if (JSON.stringify(actualNames) !== JSON.stringify(expectedNames)) {
    throw new Error(
      `GitHub release v${version} assets must be exactly ${expectedNames.join(", ")}`
    );
  }
  return {
    assets,
    draft: false,
    prerelease: false,
    tag_name: `v${version}`,
  };
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
  validateStableVersion(version);
  const lines = [
    "class Skillset < Formula",
    '  desc "Source-first compiler for provider-native agent loadouts"',
    `  homepage "https://github.com/${repository}"`,
    ...targetBlock(version, checksums, "darwin-arm64", "  "),
    '  license "MIT"',
    "  depends_on :macos",
    "",
    "  on_macos do",
    "    on_intel do",
    ...targetBlock(version, checksums, "darwin-x64", "      "),
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

const parseReleaseChecksums = (
  contents: string,
  version: string
): Readonly<Record<string, string>> => {
  const checksums: Record<string, string> = {};
  for (const line of contents.trim().split("\n")) {
    const match = line.match(/^(?<digest>[a-f0-9]{64}) {2}(?<name>.+)$/u);
    if (!match) {
      throw new Error(`Invalid release checksum line: ${line}`);
    }
    const { digest, name } = match.groups ?? {};
    if (!digest || !name || checksums[name]) {
      throw new Error(`Duplicate or invalid release checksum entry: ${line}`);
    }
    checksums[name] = digest;
  }
  const checksumName = `skillset-v${version}-SHA256SUMS`;
  const expected = expectedReleaseAssetNames(version)
    .filter((name) => name !== checksumName)
    .toSorted();
  if (
    JSON.stringify(Object.keys(checksums).toSorted()) !==
    JSON.stringify(expected)
  ) {
    throw new Error(
      `Release checksums must cover exactly ${expected.join(", ")}`
    );
  }
  return checksums;
};

export const verifyHomebrewReleaseAssets = async (
  assetsDir: string,
  version: string
): Promise<Readonly<Record<string, string>>> => {
  const checksumName = `skillset-v${version}-SHA256SUMS`;
  const checksums = parseReleaseChecksums(
    await readFile(path.join(assetsDir, checksumName), "utf-8"),
    version
  );
  await Promise.all(
    Object.entries(checksums).map(async ([name, expected]) => {
      const actual = checksum(
        new Uint8Array(await readFile(path.join(assetsDir, name)))
      );
      if (actual !== expected) {
        throw new Error(`${name} does not match the verified release checksum`);
      }
    })
  );
  const manifest = parseNativeManifest(
    JSON.parse(
      await readFile(path.join(assetsDir, nativeManifestName(version)), "utf-8")
    )
  );
  if (manifest.version !== version) {
    throw new Error(
      `Native manifest version ${manifest.version} does not match ${version}`
    );
  }
  const expectedSuffixes = REQUIRED_NATIVE_TARGETS.map(
    (target) => target.suffix
  ).toSorted();
  const actualSuffixes = manifest.artifacts
    .map((artifact) => artifact.suffix)
    .toSorted();
  if (JSON.stringify(actualSuffixes) !== JSON.stringify(expectedSuffixes)) {
    throw new Error(
      `Native manifest must contain exactly ${expectedSuffixes.join(", ")}`
    );
  }
  for (const target of REQUIRED_NATIVE_TARGETS) {
    const artifact = manifest.artifacts.find(
      (candidate) => candidate.suffix === target.suffix
    );
    const archive = nativeArchiveName(version, target);
    if (
      !artifact ||
      artifact.archive !== archive ||
      artifact.npmPackage !== target.npmPackage ||
      artifact.required !== true ||
      artifact.target !== target.bunTarget ||
      artifact.sha256 !== checksums[archive]
    ) {
      throw new Error(`Native manifest metadata drift for ${target.suffix}`);
    }
  }
  return checksums;
};

export const renderHomebrewFormulaFromAssets = async (options: {
  readonly assetsDir: string;
  readonly output: string;
  readonly version: string;
}): Promise<void> => {
  const checksums = await verifyHomebrewReleaseAssets(
    options.assetsDir,
    options.version
  );
  await writeFile(
    options.output,
    renderHomebrewFormula({ checksums, version: options.version })
  );
};

export const HOMEBREW_README_SECTION = `## Skillset

Skillset is available as a native CLI for Apple Silicon and Intel macOS.

\`\`\`sh
brew install outfitter-dev/tap/skillset
\`\`\`

Upgrade or uninstall it with \`brew upgrade skillset\` or \`brew uninstall skillset\`.

Formula updates arrive through a tested pull request and are merged only after tap CI passes.
`;

const LEGACY_TAP_INTRO =
  "This tap distributes [Blaze](https://github.com/outfitter-dev/blz) as the [`blz`](Formula/blz.rb) formula.";
const TAP_INTRO =
  "This tap distributes Outfitter command-line tools as Homebrew formulae.";

export const updateHomebrewTapReadme = (contents: string): string => {
  const normalized = contents.replace(LEGACY_TAP_INTRO, TAP_INTRO);
  if (normalized.includes(HOMEBREW_README_SECTION)) {
    return normalized;
  }
  if (/^## Skillset$/mu.test(normalized)) {
    throw new Error("Homebrew tap README has an unmanaged Skillset section");
  }
  return `${normalized.trimEnd()}\n\n${HOMEBREW_README_SECTION}`;
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
  let readme: string | undefined;
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
      case "--readme": {
        readme = value;
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
  return { assetsDir, command, output, readme, releaseJson, version };
};

const main = async (): Promise<void> => {
  const args = parseHomebrewArgs(process.argv.slice(2));
  if (args.command === "validate-release") {
    if (
      !args.releaseJson ||
      !args.version ||
      args.assetsDir ||
      args.output ||
      args.readme
    ) {
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
    if (
      !args.assetsDir ||
      !args.output ||
      !args.version ||
      args.releaseJson ||
      args.readme
    ) {
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
  if (args.command === "update-readme") {
    if (
      !args.readme ||
      args.assetsDir ||
      args.output ||
      args.releaseJson ||
      args.version
    ) {
      throw new Error("update-readme requires only --readme");
    }
    await writeFile(
      args.readme,
      updateHomebrewTapReadme(await readFile(args.readme, "utf-8"))
    );
    console.error("skillset: updated Homebrew tap README for Skillset");
    return;
  }
  throw new Error(
    "Expected Homebrew command validate-release, render, or update-readme"
  );
};

if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    console.error(`skillset: ${(error as Error).message}`);
    process.exit(1);
  }
}
