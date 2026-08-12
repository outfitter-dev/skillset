import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  expectedHomebrewAssets,
  HOMEBREW_README_SECTION,
  renderHomebrewFormula,
  renderHomebrewFormulaFromAssets,
  updateHomebrewTapReadme,
  validatePublishedRelease,
} from "../homebrew";
import {
  nativeManifestName,
  renderNativeChecksums,
  renderNativeManifest,
} from "../native-artifacts";
import { REQUIRED_NATIVE_TARGETS, nativeArchiveName } from "../native-targets";
import { expectedReleaseAssetNames } from "../release-assets";

const version = "1.2.3";
const homebrewAssets = expectedHomebrewAssets(version);
const releaseAssetNames = expectedReleaseAssetNames(version);
const assets = releaseAssetNames.map((name) => ({ name }));

describe("SET-422 Homebrew release handoff", () => {
  test("requires an exact published stable release inventory", () => {
    expect(
      validatePublishedRelease(
        { assets, draft: false, prerelease: false, tag_name: `v${version}` },
        version
      ).assets
    ).toEqual(assets);

    expect(() =>
      validatePublishedRelease(
        { assets, draft: true, prerelease: false, tag_name: `v${version}` },
        version
      )
    ).toThrow("must be published, not draft");
    expect(() =>
      validatePublishedRelease(
        {
          assets: assets.slice(1),
          draft: false,
          prerelease: false,
          tag_name: `v${version}`,
        },
        version
      )
    ).toThrow("assets must be exactly");
    expect(() =>
      validatePublishedRelease(
        {
          assets: [...assets, assets[0]],
          draft: false,
          prerelease: false,
          tag_name: `v${version}`,
        },
        version
      )
    ).toThrow("assets must be exactly");
    expect(() =>
      validatePublishedRelease(
        { assets, draft: false, prerelease: true, tag_name: `v${version}` },
        version
      )
    ).toThrow("must be stable, not a prerelease");
    expect(() =>
      validatePublishedRelease(
        {
          assets,
          draft: false,
          prerelease: false,
          tag_name: "v1.2.3-beta.1",
        },
        "1.2.3-beta.1"
      )
    ).toThrow("Homebrew version must be stable");
    for (const malformed of ["banana", "1.2.3-01"]) {
      expect(() =>
        validatePublishedRelease(
          {
            assets,
            draft: false,
            prerelease: false,
            tag_name: `v${malformed}`,
          },
          malformed
        )
      ).toThrow("must be valid SemVer");
    }
  });

  test("renders a strict macOS formula without a redundant version stanza", () => {
    const checksums = Object.fromEntries(
      homebrewAssets.map((name, index) => [name, `${index}`.repeat(64)])
    );
    const formula = renderHomebrewFormula({ checksums, version });

    for (const [name, digest] of Object.entries(checksums)) {
      expect(formula).toContain(
        `https://github.com/outfitter-dev/skillset/releases/download/v${version}/${name}`
      );
      expect(formula).toContain(`sha256 "${digest}"`);
    }
    expect(formula).not.toContain(`version "${version}"`);
    expect(formula).toContain("depends_on :macos");
    expect(formula).toContain("on_arm do");
    expect(formula).toContain("on_intel do");
    expect(formula).not.toContain("on_linux");
    expect(formula).toContain('bin.install "skillset"');
    expect(formula).toContain("skillset --version");
    expect(formula).toContain("skillset lookup workspace --json");
  });

  test("verifies the release manifest and checksums before rendering", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "skillset-homebrew-test-"));
    try {
      const checksumName = `skillset-v${version}-SHA256SUMS`;
      const archives = REQUIRED_NATIVE_TARGETS.map((target, index) => {
        const bytes = `archive-${index}`;
        return {
          bytes,
          name: nativeArchiveName(version, target),
          sha256: createHash("sha256").update(bytes).digest("hex"),
          target,
        };
      });
      await Promise.all(
        archives.map(({ bytes, name }) =>
          writeFile(path.join(root, name), bytes)
        )
      );
      const manifestName = nativeManifestName(version);
      const manifest = renderNativeManifest({
        artifacts: archives
          .map(({ bytes, name, sha256, target }) => ({
            archive: name,
            archiveSize: Buffer.byteLength(bytes),
            npmPackage: target.npmPackage,
            rawSize: 1,
            required: true,
            sha256,
            suffix: target.suffix,
            target: target.bunTarget,
          }))
          .toSorted((left, right) => left.suffix.localeCompare(right.suffix)),
        bunVersion: Bun.version,
        cliContractSha256: "a".repeat(64),
        commit: "b".repeat(40),
        schemaVersion: 1,
        version,
      });
      await writeFile(path.join(root, manifestName), manifest);
      await writeFile(
        path.join(root, checksumName),
        renderNativeChecksums([
          ...archives.map(({ name, sha256 }) => ({ name, sha256 })),
          {
            name: manifestName,
            sha256: createHash("sha256").update(manifest).digest("hex"),
          },
        ])
      );

      const output = path.join(root, "skillset.rb");
      await renderHomebrewFormulaFromAssets({
        assetsDir: root,
        output,
        version,
      });
      const formula = await readFile(output, "utf-8");
      expect(formula).toContain(`sha256 "${archives[0]?.sha256}"`);

      const tamperedArchive = archives.at(0);
      if (!tamperedArchive) {
        throw new Error("Expected at least one native archive");
      }
      await writeFile(path.join(root, tamperedArchive.name), "tampered");
      await expect(
        renderHomebrewFormulaFromAssets({
          assetsDir: root,
          output,
          version,
        })
      ).rejects.toThrow("does not match the verified release checksum");

      await writeFile(
        path.join(root, tamperedArchive.name),
        tamperedArchive.bytes
      );
      const driftedManifest = JSON.parse(manifest) as {
        artifacts: { npmPackage: string }[];
      };
      const firstArtifact = driftedManifest.artifacts.at(0);
      if (!firstArtifact) {
        throw new Error("Expected at least one native manifest artifact");
      }
      firstArtifact.npmPackage = "@skillset/native-wrong";
      const driftedManifestText = `${JSON.stringify(driftedManifest, null, 2)}\n`;
      await writeFile(path.join(root, manifestName), driftedManifestText);
      await writeFile(
        path.join(root, checksumName),
        renderNativeChecksums([
          ...archives.map(({ name, sha256 }) => ({ name, sha256 })),
          {
            name: manifestName,
            sha256: createHash("sha256")
              .update(driftedManifestText)
              .digest("hex"),
          },
        ])
      );
      await expect(
        renderHomebrewFormulaFromAssets({
          assetsDir: root,
          output,
          version,
        })
      ).rejects.toThrow("Native manifest metadata drift");
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  test("adds an idempotent managed section to the tap README", () => {
    const initial =
      "# Homebrew Tap\n\nThis tap distributes [Blaze](https://github.com/outfitter-dev/blz) as the [`blz`](Formula/blz.rb) formula.\n";
    const updated = updateHomebrewTapReadme(initial);

    expect(updated).toContain(
      "This tap distributes Outfitter command-line tools as Homebrew formulae."
    );
    expect(updated).not.toContain("This tap distributes [Blaze]");
    expect(updated).toContain("brew install outfitter-dev/tap/skillset");
    expect(updated).toContain("brew upgrade skillset");
    expect(updated).toContain("brew uninstall skillset");
    expect(updated).toContain("merged only after tap CI passes");
    expect(updated).toContain(HOMEBREW_README_SECTION);
    expect(updateHomebrewTapReadme(updated)).toBe(updated);
    expect(() =>
      updateHomebrewTapReadme("# Tap\n\n## Skillset\nCustom\n")
    ).toThrow("unmanaged Skillset section");
  });
});
