import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  expectedHomebrewAssets,
  renderHomebrewFormula,
  renderHomebrewFormulaFromAssets,
  validatePublishedRelease,
} from "../homebrew";

const version = "1.2.3";
const assets = expectedHomebrewAssets(version).map((name) => ({ name }));

describe("SET-422 Homebrew release handoff", () => {
  test("requires a published release with one of every expected asset", () => {
    expect(
      validatePublishedRelease(
        { assets, draft: false, tag_name: `v${version}` },
        version
      ).assets
    ).toEqual(assets);

    expect(() =>
      validatePublishedRelease(
        { assets, draft: true, tag_name: `v${version}` },
        version
      )
    ).toThrow("must be published, not draft");
    expect(() =>
      validatePublishedRelease(
        { assets: assets.slice(1), draft: false, tag_name: `v${version}` },
        version
      )
    ).toThrow(`is missing ${assets[0]?.name}`);
    expect(() =>
      validatePublishedRelease(
        {
          assets: [...assets, assets[0]],
          draft: false,
          tag_name: `v${version}`,
        },
        version
      )
    ).toThrow(`contains 2 assets named ${assets[0]?.name}`);
    for (const malformed of ["banana", "1.2.3-01"]) {
      expect(() =>
        validatePublishedRelease(
          { assets, draft: false, tag_name: `v${malformed}` },
          malformed
        )
      ).toThrow("must be valid SemVer");
    }
  });

  test("renders platform URLs, supplied checksums, installation, and read-only tests", () => {
    const checksums = Object.fromEntries(
      assets.map(({ name }, index) => [name, `${index}`.repeat(64)])
    );
    const formula = renderHomebrewFormula({ checksums, version });

    for (const [name, digest] of Object.entries(checksums)) {
      expect(formula).toContain(
        `https://github.com/outfitter-dev/skillset/releases/download/v${version}/${name}`
      );
      expect(formula).toContain(`sha256 "${digest}"`);
    }
    expect(formula).toContain('bin.install "skillset"');
    expect(formula).toContain("skillset --version");
    expect(formula).toContain("skillset lookup workspace --json");
  });

  test("computes formula checksums from downloaded release bytes", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "skillset-homebrew-test-"));
    try {
      await Promise.all(
        assets.map(({ name }, index) =>
          writeFile(path.join(root, name), `asset-${index}`)
        )
      );
      const output = path.join(root, "skillset.rb");
      await renderHomebrewFormulaFromAssets({
        assetsDir: root,
        output,
        version,
      });
      const formula = await readFile(output, "utf-8");
      expect(formula).toContain(
        'sha256 "cfbb55051399525e165377a834ba1af07a9a08f836356c61c64c24fa4621b823"'
      );
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
});
