import { describe, expect, test } from "bun:test";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  assertSupportedBunEvidenceVersion,
  assertSupportedBunRuntimeVersion,
} from "../bun-runtime-evidence";
import { parseNativeArgs } from "../native";
import { createNativeArchive, extractNativeArchive } from "../native-archive";
import {
  buildNativeArtifacts,
  cliContractSha256,
  nativeManifestName,
  parseNativeSizeBaseline,
  renderNativeManifest,
  renderNativeChecksums,
  selectNativeTargets,
  verifyNativeArtifacts,
} from "../native-artifacts";
import { smokeNativeExecutable } from "../native-smoke";
import {
  NATIVE_TARGETS,
  REQUIRED_NATIVE_TARGETS,
  getNativeTarget,
  nativeArchiveName,
} from "../native-targets";
import { createTestFixtureRoot } from "../test-helpers/fixture-root";

async function temporaryRoot(): Promise<string> {
  return createTestFixtureRoot("skillset-native-test-");
}

function currentHostTarget() {
  if (process.platform === "darwin") {
    return getNativeTarget(
      process.arch === "arm64" ? "darwin-arm64" : "darwin-x64"
    );
  }
  if (process.platform === "linux") {
    return getNativeTarget(
      process.arch === "arm64" ? "linux-arm64-glibc" : "linux-x64-glibc"
    );
  }
  return getNativeTarget("windows-x64");
}

describe("SET-419 native target and artifact contract", () => {
  test("declares five required release targets and two reserved musl targets", () => {
    expect(REQUIRED_NATIVE_TARGETS.map((target) => target.suffix)).toEqual([
      "darwin-arm64",
      "darwin-x64",
      "linux-arm64-glibc",
      "linux-x64-glibc",
      "windows-x64",
    ]);
    expect(
      NATIVE_TARGETS.filter((target) => !target.required).map(
        (target) => target.suffix
      )
    ).toEqual(["linux-arm64-musl", "linux-x64-musl"]);
    expect(nativeArchiveName("1.2.3", getNativeTarget("windows-x64"))).toBe(
      "skillset-v1.2.3-windows-x64.zip"
    );
    expect(() => getNativeTarget("windows-arm64")).toThrow(
      'Unsupported native target "windows-arm64"'
    );
  });

  test("creates deterministic single-executable tar.gz and zip archives", () => {
    const executable = new TextEncoder().encode("#!/bin/sh\necho skillset\n");
    for (const kind of ["tar.gz", "zip"] as const) {
      const name = kind === "zip" ? "skillset.exe" : "skillset";
      const first = createNativeArchive(kind, name, executable);
      const second = createNativeArchive(kind, name, executable);
      expect(first).toEqual(second);
      expect(extractNativeArchive(kind, first)).toEqual({
        bytes: executable,
        mode: 0o755,
        name,
      });
    }
  });

  test("renders a sorted exact checksum inventory and stable CLI contract digest", () => {
    expect(
      renderNativeChecksums([
        { name: "z.zip", sha256: "b".repeat(64) },
        { name: "a.tar.gz", sha256: "a".repeat(64) },
      ])
    ).toBe(`${"a".repeat(64)}  a.tar.gz\n${"b".repeat(64)}  z.zip\n`);
    expect(cliContractSha256()).toMatch(/^[a-f0-9]{64}$/);
    expect(cliContractSha256()).toBe(cliContractSha256());
  });

  test("validates size policy fields without requiring reserved targets", () => {
    const requiredArtifacts = REQUIRED_NATIVE_TARGETS.map((target) => ({
      archiveSize: 1,
      rawSize: 1,
      suffix: target.suffix,
    }));
    expect(
      parseNativeSizeBaseline({
        artifacts: requiredArtifacts,
        bunVersion: Bun.version,
        observedVersion: "0.22.1",
        policy: { minimumAllowanceBytes: 1, percent: 10 },
        schemaVersion: 1,
      }).artifacts
    ).toEqual(requiredArtifacts);
    expect(
      parseNativeSizeBaseline({
        artifacts: requiredArtifacts,
        bunVersion: "1.4.2",
        observedVersion: "0.22.1",
        policy: { minimumAllowanceBytes: 1, percent: 10 },
        schemaVersion: 1,
      }).bunVersion
    ).toBe("1.4.2");
    const unsupportedBaseline = () =>
      parseNativeSizeBaseline({
        artifacts: requiredArtifacts,
        bunVersion: "1.3.14",
        observedVersion: "0.22.1",
        policy: { minimumAllowanceBytes: 1, percent: 10 },
        schemaVersion: 1,
      });
    expect(unsupportedBaseline).toThrow(/supported range >=1\.4\.0.*pin 1\.4\.0/);
    expect(unsupportedBaseline).toThrow(`observed ${Bun.version}`);
    expect(() =>
      parseNativeSizeBaseline({
        artifacts: requiredArtifacts.map((entry) => ({
          ...entry,
          rawSize: undefined,
        })),
        bunVersion: Bun.version,
        observedVersion: "0.22.1",
        policy: { minimumAllowanceBytes: 1, percent: 10 },
        schemaVersion: 1,
      })
    ).toThrow("invalid artifact");
    expect(() =>
      parseNativeSizeBaseline({
        artifacts: requiredArtifacts,
        bunVersion: Bun.version,
        observedVersion: "0.22.1",
        policy: { minimumAllowanceBytes: 1 },
        schemaVersion: 1,
      })
    ).toThrow("positive growth policy");
  });

  test("accepts supported Bun evidence but fails closed outside the range", () => {
    expect(() => assertSupportedBunRuntimeVersion("1.4.2")).not.toThrow();
    expect(() =>
      assertSupportedBunEvidenceVersion("Native manifest", "1.4.2", "1.4.0")
    ).not.toThrow();
    expect(() =>
      assertSupportedBunEvidenceVersion("Native size baseline", "1.4.0", "1.4.2")
    ).not.toThrow();
    expect(() => assertSupportedBunRuntimeVersion("1.3.14")).toThrow(
      /supported range >=1\.4\.0.*pin 1\.4\.0.*observed 1\.3\.14/
    );
    expect(() =>
      assertSupportedBunEvidenceVersion("Native manifest", "1.3.14", "1.4.2")
    ).toThrow(
      /Native manifest Bun 1\.3\.14.*supported range >=1\.4\.0.*pin 1\.4\.0.*observed 1\.4\.2/
    );
  });

  test("compares prerelease Bun builds on their numeric base version", () => {
    expect(() =>
      assertSupportedBunRuntimeVersion("1.4.1-canary.20+abc123")
    ).not.toThrow();
    expect(() =>
      assertSupportedBunEvidenceVersion(
        "Native manifest",
        "1.4.1-canary.20",
        "1.4.2"
      )
    ).not.toThrow();
    expect(() => assertSupportedBunRuntimeVersion("1.3.14-canary.2")).toThrow(
      /Bun runtime 1\.3\.14-canary\.2 is outside/
    );
  });

  test("requires one explicit target selection mode", () => {
    expect(selectNativeTargets({ required: true })).toEqual(
      REQUIRED_NATIVE_TARGETS
    );
    expect(selectNativeTargets({ suffixes: ["darwin-arm64"] })).toEqual([
      getNativeTarget("darwin-arm64"),
    ]);
    expect(() => selectNativeTargets({})).toThrow("Select exactly one");
    expect(() => selectNativeTargets({ all: true, required: true })).toThrow(
      "Select exactly one"
    );
    expect(
      parseNativeArgs(["build", "--target", "darwin-arm64", "--reproducible"])
    ).toMatchObject({
      command: "build",
      reproducible: true,
      suffixes: ["darwin-arm64"],
    });
  });

  // Real compilation varies on shared CI runners; this bounds hangs, not speed.
  test("builds reproducibly, verifies the archive, and runs without Bun in child PATH", async () => {
    const root = await temporaryRoot();
    const target = currentHostTarget();
    const manifest = await buildNativeArtifacts({
      commit: "a".repeat(40),
      outputDir: root,
      reproducible: true,
      targets: [target],
    });

    expect(manifest.artifacts).toHaveLength(1);
    expect(manifest.artifacts[0]?.suffix).toBe(target.suffix);
    expect(manifest.commit).toBe("a".repeat(40));
    expect(
      await verifyNativeArtifacts({
        allowPartial: true,
        allowReserved: true,
        outputDir: root,
      })
    ).toEqual(manifest);

    const manifestPath = join(root, nativeManifestName());
    const originalManifest = await readFile(manifestPath, "utf8");
    await writeFile(
      manifestPath,
      renderNativeManifest({ ...manifest, bunVersion: "1.3.14" })
    );
    await expect(
      verifyNativeArtifacts({ allowPartial: true, outputDir: root })
    ).rejects.toThrow(/Native manifest Bun 1\.3\.14.*supported range/);
    await writeFile(
      manifestPath,
      renderNativeManifest({
        ...manifest,
        bunVersion: manifest.bunVersion === "1.4.0" ? "1.4.2" : "1.4.0",
      })
    );
    await expect(
      verifyNativeArtifacts({ allowPartial: true, outputDir: root })
    ).rejects.toThrow("Native manifest checksum is missing or stale");
    await writeFile(manifestPath, originalManifest);

    const executable = join(root, "bin", target.suffix, target.executable);
    await smokeNativeExecutable(executable, target.suffix);

    const archivePath = join(root, manifest.artifacts[0]!.archive);
    const archive = new Uint8Array(await readFile(archivePath));
    const finalByte = archive.byteLength - 1;
    archive[finalByte] = archive[finalByte]! ^ 0xff;
    await writeFile(archivePath, archive);
    await expect(
      verifyNativeArtifacts({
        allowPartial: true,
        allowReserved: true,
        outputDir: root,
      })
    ).rejects.toThrow("checksum or size mismatch");
  }, 60_000);

  test("rejects a partial manifest at the release-shaped verification boundary", async () => {
    const root = await temporaryRoot();
    const target = currentHostTarget();
    const builtManifest = await buildNativeArtifacts({
      commit: "b".repeat(40),
      outputDir: root,
      targets: [target],
    });
    const unexpectedArchive = join(
      root,
      `skillset-v${builtManifest.version}-unexpected.tar.gz`
    );
    await writeFile(unexpectedArchive, "unexpected");
    await expect(
      verifyNativeArtifacts({ allowPartial: true, outputDir: root })
    ).rejects.toThrow("unexpected release artifacts");
    await rm(unexpectedArchive);

    await expect(verifyNativeArtifacts({ outputDir: root })).rejects.toThrow(
      "required set is incomplete"
    );

    const manifestPath = join(root, nativeManifestName());
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
      artifacts: Array<{ suffix: string; undeclared?: boolean }>;
      undeclared?: boolean;
    };
    manifest.undeclared = true;
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    await expect(
      verifyNativeArtifacts({ allowPartial: true, outputDir: root })
    ).rejects.toThrow("Native manifest fields must be exactly");
    delete manifest.undeclared;

    manifest.artifacts[0]!.undeclared = true;
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    await expect(
      verifyNativeArtifacts({ allowPartial: true, outputDir: root })
    ).rejects.toThrow("fields must be exactly");
    delete manifest.artifacts[0]!.undeclared;

    manifest.artifacts[0]!.suffix = "unknown-target";
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    await expect(
      verifyNativeArtifacts({ allowPartial: true, outputDir: root })
    ).rejects.toThrow("Unsupported native target");
  }, 30_000);
});
