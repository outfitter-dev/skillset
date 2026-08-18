import { afterAll, describe, expect, test } from "bun:test";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import productManifest from "../../apps/skillset/package.json";
import {
  distributionCommandBase,
  distributionRuntimePath,
  smokeDistribution,
} from "../distribution-conformance";
import { renderDistributionSizeReport } from "../distribution-size-report";
import { hydrateNativeRelease } from "../hydrate-native-release";
import { createNativeArchive } from "../native-archive";
import {
  cliContractSha256,
  nativeChecksumsName,
  nativeManifestName,
  renderNativeChecksums,
  renderNativeManifest,
  sha256,
  type NativeArtifactManifest,
} from "../native-artifacts";
import { REQUIRED_NATIVE_TARGETS, nativeArchiveName } from "../native-targets";
import { provePublishedLauncherNegatives } from "../published-launcher-negatives";

const repoRoot = join(import.meta.dir, "..", "..");
const roots: string[] = [];

afterAll(async () => {
  await Promise.all(
    roots.map((root) => rm(root, { force: true, recursive: true }))
  );
});

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "skillset-distribution-test-"));
  roots.push(root);
  return root;
}

describe("SET-424 distribution conformance", () => {
  test("constructs Bun script, Windows shim, and package-runner commands", () => {
    expect(
      distributionCommandBase(
        { executable: "/tmp/skillset.exe", runtime: "bun" },
        "win32",
        "/tmp/bun.exe"
      )
    ).toEqual(["/tmp/skillset.exe"]);
    expect(
      distributionCommandBase(
        { executable: "/tmp/skillset", runtime: "bun" },
        "darwin",
        "/tmp/bun"
      )
    ).toEqual(["/tmp/bun", "/tmp/skillset"]);
    expect(
      distributionCommandBase(
        { bunxPackage: "@skillset/cli@1.2.3", runtime: "bun" },
        "win32",
        "/tmp/bun.exe"
      )
    ).toEqual([
      "/tmp/bun.exe",
      "x",
      "--bun",
      "--silent",
      "--package",
      "@skillset/cli@1.2.3",
      "skillset",
    ]);
  });

  test("exposes Bun after sentinel tools only for the Bun runtime", () => {
    expect(
      distributionRuntimePath("bun", "C:\\smoke\\tools", "C:\\bun", ";")
    ).toBe("C:\\smoke\\tools;C:\\bun");
    expect(
      distributionRuntimePath("native", "C:\\smoke\\tools", "C:\\bun", ";")
    ).toBe("C:\\smoke\\tools");
    expect(
      distributionRuntimePath(
        "node-launcher",
        "C:\\smoke\\tools",
        "C:\\bun",
        ";"
      )
    ).toBe("C:\\smoke\\tools");
  });

  test("suppresses package installation noise without hiding command failures", async () => {
    const root = await temporaryRoot();
    const packageRoot = join(root, "package");
    const cli = join(packageRoot, "cli.ts");
    await mkdir(packageRoot);
    await writeFile(
      join(packageRoot, "package.json"),
      JSON.stringify({ bin: { skillset: "cli.ts" }, name: "conformance-package" })
    );
    await writeFile(
      cli,
      `#!/usr/bin/env bun
const arg = process.argv[2];
if (arg === "--version") console.log("1.2.3");
else if (arg === "--help") console.log("Skillset\\n\\nUsage\\n  skillset <command>");
else if (arg === "lookup") console.log(JSON.stringify({command:"lookup",exitCode:0,ok:true}));
else { console.error("skillset: expected command\\nusage: skillset"); process.exit(1); }
`
    );
    await chmod(cli, 0o755);

    await smokeDistribution({
      bunxPackage: packageRoot,
      expectedVersion: "1.2.3",
      runtime: "bun",
    });
  });

  test("proves the shared command contract with Bun and native runtime boundaries", async () => {
    const root = await temporaryRoot();
    const bunCli = join(root, "cli.ts");
    await writeFile(
      bunCli,
      `const arg = process.argv[2];
if (arg === "--version") console.log("1.2.3");
else if (arg === "--help") console.log("Skillset\\n\\nUsage\\n  skillset <command>");
else if (arg === "lookup") console.log(JSON.stringify({command:"lookup",exitCode:0,ok:true}));
else { console.error("skillset: expected command\\nusage: skillset"); process.exit(1); }
`
    );
    await smokeDistribution({
      executable: bunCli,
      expectedVersion: "1.2.3",
      runtime: "bun",
    });

    if (process.platform !== "win32") {
      const native = join(root, "skillset");
      await writeFile(
        native,
        `#!/bin/sh
case "$1" in
  --version) printf '1.2.3\\n' ;;
  --help) printf 'Skillset\\n\\nUsage\\n  skillset <command>\\n' ;;
  lookup) printf '{"command":"lookup","exitCode":0,"ok":true}\\n' ;;
  *) printf 'skillset: expected command\\nusage: skillset\\n' >&2; exit 1 ;;
esac
`
      );
      await chmod(native, 0o755);
      await smokeDistribution({
        executable: native,
        expectedVersion: "1.2.3",
        runtime: "native",
      });
    }
  });

  test("derives exhaustive target-host vectors from every public route", async () => {
    await smokeDistribution({
      executable: join(repoRoot, "apps", "skillset", "src", "cli.ts"),
      exhaustive: true,
      expectedVersion: productManifest.version,
      runtime: "bun",
    });
  }, 30_000);

  test("proves diagnostics against a disposable installed launcher tree", async () => {
    if (process.platform === "win32") return;
    const root = await temporaryRoot();
    const globalRoot = join(root, "global");
    const packageDirectory = join(
      globalRoot,
      "skillset",
      "node_modules",
      "@skillset",
      "native-darwin-arm64"
    );
    const nativeExecutable = join(packageDirectory, "bin", "skillset");
    await mkdir(join(packageDirectory, "bin"), { recursive: true });
    await writeFile(
      join(packageDirectory, "package.json"),
      `${JSON.stringify({ name: "@skillset/native-darwin-arm64", version: "1.2.3" })}\n`
    );
    await writeFile(nativeExecutable, "native\n");
    await chmod(nativeExecutable, 0o755);
    const launcher = join(root, "skillset");
    await writeFile(
      launcher,
      `#!/usr/bin/env bun
import { readFileSync, statSync } from "node:fs";
const directory = ${JSON.stringify(packageDirectory)};
let manifest;
try { manifest = JSON.parse(readFileSync(directory + "/package.json", "utf8")); }
catch { console.error("skillset: The native package @skillset/native-darwin-arm64 is missing. Reinstall with optional dependencies enabled."); process.exit(1); }
if (manifest.version !== "1.2.3") { console.error("skillset: Package version mismatch: expected 1.2.3. Reinstall skillset."); process.exit(1); }
try { if (statSync(directory + "/bin/skillset").size <= 0) throw new Error(); }
catch { console.error("skillset: The native executable in @skillset/native-darwin-arm64 is missing or corrupt. Reinstall skillset."); process.exit(1); }
console.log("1.2.3");
`
    );
    await chmod(launcher, 0o755);

    await provePublishedLauncherNegatives({
      executable: launcher,
      globalRoot,
      suffix: "darwin-arm64",
    });
    expect(await readFile(nativeExecutable, "utf8")).toBe("native\n");
    expect((await stat(nativeExecutable)).isFile()).toBeTrue();
    expect(
      JSON.parse(await readFile(join(packageDirectory, "package.json"), "utf8"))
    ).toEqual({ name: "@skillset/native-darwin-arm64", version: "1.2.3" });
  });

  test("reports exact native raw/archive sizes and the slim package tarball", async () => {
    const root = await temporaryRoot();
    const assets = join(root, "assets");
    await mkdir(assets);
    const manifest: NativeArtifactManifest = {
      artifacts: [
        {
          archive: "skillset-v1.2.3-darwin-arm64.tar.gz",
          archiveSize: 50,
          npmPackage: "@skillset/native-darwin-arm64",
          rawSize: 100,
          required: true,
          sha256: "a".repeat(64),
          suffix: "darwin-arm64",
          target: "bun-darwin-arm64",
        },
      ],
      bunVersion: Bun.version,
      cliContractSha256: "b".repeat(64),
      commit: "c".repeat(40),
      schemaVersion: 1,
      version: "1.2.3",
    };
    await writeFile(
      join(assets, nativeManifestName("1.2.3")),
      `${JSON.stringify(manifest)}\n`
    );
    const tarball = join(root, "skillset-cli.tgz");
    await writeFile(tarball, new Uint8Array(25));

    const report = await renderDistributionSizeReport({
      assetsDir: assets,
      cliTarball: tarball,
      version: "1.2.3",
    });
    expect(report).toContain("| darwin-arm64 | 0.00 MB | 0.00 MB |");
    expect(report).toContain("| @skillset/cli npm tarball | — | 0.00 MB |");
    expect(report).toContain("b".repeat(64));
    expect(await readFile(tarball)).toHaveLength(25);
  });

  test("hydrates verified release archives into exact native package inputs", async () => {
    const root = await temporaryRoot();
    const releaseDir = join(root, "release");
    const outputDir = join(root, "native");
    await mkdir(releaseDir);
    const artifacts = [];
    const checksums: Array<{ name: string; sha256: string }> = [];
    for (const target of REQUIRED_NATIVE_TARGETS) {
      const raw = new TextEncoder().encode(`skillset ${target.suffix}\n`);
      const archive = createNativeArchive(
        target.archiveKind,
        target.executable,
        raw
      );
      const archiveName = nativeArchiveName(productManifest.version, target);
      await writeFile(join(releaseDir, archiveName), archive);
      checksums.push({ name: archiveName, sha256: sha256(archive) });
      artifacts.push({
        archive: archiveName,
        archiveSize: archive.byteLength,
        npmPackage: target.npmPackage,
        rawSize: raw.byteLength,
        required: true,
        sha256: sha256(archive),
        suffix: target.suffix,
        target: target.bunTarget,
      });
    }
    const manifest: NativeArtifactManifest = {
      artifacts,
      bunVersion: Bun.version,
      cliContractSha256: cliContractSha256(),
      commit: "d".repeat(40),
      schemaVersion: 1,
      version: productManifest.version,
    };
    const manifestName = nativeManifestName(productManifest.version);
    const manifestBytes = renderNativeManifest(manifest);
    await writeFile(join(releaseDir, manifestName), manifestBytes);
    checksums.push({ name: manifestName, sha256: sha256(manifestBytes) });
    await writeFile(
      join(releaseDir, nativeChecksumsName(productManifest.version)),
      renderNativeChecksums(checksums)
    );

    await hydrateNativeRelease({
      expectedCommit: manifest.commit,
      outputDir,
      releaseDir,
      version: productManifest.version,
    });
    for (const target of REQUIRED_NATIVE_TARGETS) {
      expect(
        await readFile(
          join(outputDir, "bin", target.suffix, target.executable),
          "utf8"
        )
      ).toBe(`skillset ${target.suffix}\n`);
    }
  });
});
