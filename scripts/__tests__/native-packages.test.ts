import { afterAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  REQUIRED_NATIVE_DISTRIBUTIONS,
  nativePackageDirectory,
} from "../../apps/skillset/src/native-distribution";
import { buildNativeArtifacts } from "../native-artifacts";
import {
  npmLocalTarballSpec,
  resolveNpmExecutable,
} from "../native-global-smoke";
import {
  buildNativePackages,
  nativePackageManifestDiagnostics,
} from "../native-packages";
import { getNativeTarget } from "../native-targets";

const roots: string[] = [];

afterAll(async () => {
  await Promise.all(
    roots.map((root) => rm(root, { force: true, recursive: true }))
  );
});

function currentTarget() {
  if (process.platform === "darwin") {
    return getNativeTarget(
      process.arch === "arm64" ? "darwin-arm64" : "darwin-x64"
    );
  }
  return getNativeTarget(
    process.arch === "arm64" ? "linux-arm64-glibc" : "linux-x64-glibc"
  );
}

describe("SET-420 native npm packages", () => {
  test("resolves npm once to a stable target-host executable", () => {
    expect(
      resolveNpmExecutable((name) =>
        name === "npm" ? "C:\\Program Files\\nodejs\\npm.cmd" : null
      )
    ).toBe("C:\\Program Files\\nodejs\\npm.cmd");
    expect(() => resolveNpmExecutable(() => null)).toThrow(
      "Target-host npm smoke requires npm"
    );
  });

  test("preserves Windows short paths in local npm tarball specs", () => {
    expect(
      npmLocalTarballSpec(
        "C:\\Users\\RUNNER~1\\AppData\\Local\\Temp\\native.tgz",
        "win32"
      )
    ).toBe("file:C:/Users/RUNNER~1/AppData/Local/Temp/native.tgz");
  });

  test("keeps all five committed manifests aligned with the target registry", async () => {
    expect(await nativePackageManifestDiagnostics()).toEqual([]);
  });

  test("rejects lifecycle scripts and dependency surfaces in native packages", async () => {
    const root = await mkdtemp(join(tmpdir(), "skillset-native-manifests-"));
    roots.push(root);
    const optionalDependencies = Object.fromEntries(
      REQUIRED_NATIVE_DISTRIBUTIONS.map((distribution) => [
        distribution.npmPackage,
        "0.22.1",
      ])
    );
    await mkdir(join(root, "apps", "skillset"), { recursive: true });
    await writeFile(
      join(root, "apps", "skillset", "package.json"),
      `${JSON.stringify({ optionalDependencies })}\n`
    );
    for (const distribution of REQUIRED_NATIVE_DISTRIBUTIONS) {
      const packageDir = nativePackageDirectory(distribution);
      await mkdir(join(root, packageDir), { recursive: true });
      await writeFile(
        join(root, packageDir, "package.json"),
        await readFile(join(packageDir, "package.json"))
      );
    }
    expect(await nativePackageManifestDiagnostics(root)).toEqual([]);

    const first = nativePackageDirectory(REQUIRED_NATIVE_DISTRIBUTIONS[0]!);
    const firstManifestPath = join(root, first, "package.json");
    const firstManifest = JSON.parse(
      await readFile(firstManifestPath, "utf8")
    ) as Record<string, unknown>;
    firstManifest.scripts = { postinstall: "node download.js" };
    await writeFile(firstManifestPath, `${JSON.stringify(firstManifest)}\n`);
    expect(await nativePackageManifestDiagnostics(root)).toContain(
      `${first}/package.json does not match the darwin-arm64 native package contract`
    );
  });

  test("packs exactly one executable plus package metadata", async () => {
    if (process.platform === "win32") return;
    const root = await mkdtemp(join(tmpdir(), "skillset-native-package-test-"));
    roots.push(root);
    const nativeOutputDir = join(root, "native");
    const packDir = join(root, "packs");
    const target = currentTarget();
    await buildNativeArtifacts({
      commit: "c".repeat(40),
      outputDir: nativeOutputDir,
      targets: [target],
    });
    const tarballs = await buildNativePackages({
      nativeOutputDir,
      packDir,
      targets: [target],
    });
    expect(tarballs).toHaveLength(1);

    const listed = Bun.spawnSync(["tar", "-tzf", tarballs[0]!]);
    expect(listed.exitCode).toBe(0);
    expect(
      new TextDecoder().decode(listed.stdout).trim().split("\n").sort()
    ).toEqual(
      [
        "package/LICENSE",
        "package/README.md",
        `package/bin/${target.executable}`,
        "package/package.json",
      ].sort()
    );
    const generatedReadme = await readFile(
      join(nativePackageDirectory(target), "README.md"),
      "utf8"
    );
    expect(generatedReadme).toContain(target.npmPackage);
  }, 60_000);

  test("does not package reserved musl targets", async () => {
    await expect(
      buildNativePackages({
        nativeOutputDir: ".skillset/cache/native",
        targets: [getNativeTarget("linux-x64-musl")],
      })
    ).rejects.toThrow("Reserved musl targets cannot be packaged");
  });
});
