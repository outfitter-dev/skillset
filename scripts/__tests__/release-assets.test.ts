import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  expectedReleaseAssetNames,
  reconcileReleaseAssets,
} from "../release-assets";
import { resolveMacosSigningPolicy } from "../release-signing";

describe("coordinated release assets", () => {
  test("declares the exact five archives, manifest, and checksum inventory", () => {
    expect(expectedReleaseAssetNames("0.23.0")).toEqual([
      "skillset-v0.23.0-SHA256SUMS",
      "skillset-v0.23.0-darwin-arm64.tar.gz",
      "skillset-v0.23.0-darwin-x64.tar.gz",
      "skillset-v0.23.0-linux-arm64-glibc.tar.gz",
      "skillset-v0.23.0-linux-x64-glibc.tar.gz",
      "skillset-v0.23.0-manifest.json",
      "skillset-v0.23.0-windows-x64.zip",
    ]);
  });

  test("allows only explicit unsigned policy until protected signing exists", () => {
    expect(resolveMacosSigningPolicy("unsigned")).toBe("unsigned");
    expect(() => resolveMacosSigningPolicy(undefined)).toThrow(
      "must be explicitly set to unsigned"
    );
    expect(() => resolveMacosSigningPolicy("required")).toThrow(
      "no protected signing and notarization implementation is configured"
    );
  });

  test("backfills missing matching assets and blocks mismatched bytes", async () => {
    const root = await mkdtemp(join(tmpdir(), "skillset-release-assets-"));
    const localDir = join(root, "local");
    const remoteDir = join(root, "remote");
    const missingOutput = join(root, "missing.txt");
    await Promise.all([mkdir(localDir), mkdir(remoteDir)]);
    const names = expectedReleaseAssetNames("0.23.0");
    for (const name of names) await writeFile(join(localDir, name), name);
    await writeFile(join(remoteDir, names[0]!), names[0]!);

    expect(
      await reconcileReleaseAssets({
        localDir,
        missingOutput,
        remoteDir,
        version: "0.23.0",
      })
    ).toEqual(names.slice(1));

    await writeFile(join(remoteDir, names[0]!), "mismatch");
    await expect(
      reconcileReleaseAssets({
        localDir,
        missingOutput,
        remoteDir,
        version: "0.23.0",
      })
    ).rejects.toThrow("does not match the verified local artifact");
  });
});
