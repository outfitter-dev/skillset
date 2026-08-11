import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parseNativeArgs } from "../native";
import { createNativeArchive, extractNativeArchive } from "../native-archive";
import {
  buildNativeArtifacts,
  cliContractSha256,
  nativeManifestName,
  parseNativeSizeBaseline,
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

const temporaryRoots: string[] = [];

afterAll(async () => {
  await Promise.all(
    temporaryRoots.map((root) => rm(root, { force: true, recursive: true }))
  );
});

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "skillset-native-test-"));
  temporaryRoots.push(root);
  return root;
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
  }, 30_000);

  test("rejects a partial manifest at the release-shaped verification boundary", async () => {
    const root = await temporaryRoot();
    const target = currentHostTarget();
    await buildNativeArtifacts({
      commit: "b".repeat(40),
      outputDir: root,
      targets: [target],
    });
    const unexpectedArchive = join(root, "skillset-v0.22.1-unexpected.tar.gz");
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
