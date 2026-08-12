import { describe, expect, test } from "bun:test";

import {
  NPM_PROVENANCE_PREDICATE,
  RELEASE_PACKAGE_SPECS,
  npmPublishCommand,
  planCoordinatedRelease,
  type ReleaseRegistryState,
} from "../release-packages";
import {
  expectedReleaseTarballFiles,
  tarballIntegrity,
} from "../release-tarballs";

const packageNames = RELEASE_PACKAGE_SPECS.map((entry) => entry.name);
const launcherName = "skillset";

function registryStates(
  publishedNames: readonly string[],
  taggedVersion = "0.23.0",
  integrityByName: Readonly<Record<string, string>> = {}
): ReleaseRegistryState[] {
  const published = new Set(publishedNames);
  return packageNames.map((name) => ({
    name,
    integrity: published.has(name)
      ? (integrityByName[name] ?? `sha512-${name}`)
      : undefined,
    published: published.has(name),
    provenancePredicateType: published.has(name)
      ? NPM_PROVENANCE_PREDICATE
      : undefined,
    taggedVersion: published.has(name) ? taggedVersion : undefined,
  }));
}

describe("coordinated release package set", () => {
  test("publishes five native packages, the Bun CLI, and the launcher in that order", () => {
    expect(packageNames).toEqual([
      "@skillset/native-darwin-arm64",
      "@skillset/native-darwin-x64",
      "@skillset/native-linux-arm64-glibc",
      "@skillset/native-linux-x64-glibc",
      "@skillset/native-win32-x64",
      "@skillset/cli",
      "skillset",
    ]);
  });

  test("plans a clean first publish and a complete registry set", () => {
    expect(
      planCoordinatedRelease(registryStates([]), "0.23.0", "latest")
    ).toEqual({
      mode: "publish",
      missing: packageNames,
      published: [],
    });
    expect(
      planCoordinatedRelease(registryStates(packageNames), "0.23.0", "latest")
    ).toEqual({
      mode: "complete",
      missing: [],
      published: packageNames,
    });
  });

  test("resumes a partial release only while the launcher is still absent", () => {
    const alreadyPublished = packageNames.slice(0, 3);
    expect(
      planCoordinatedRelease(
        registryStates(alreadyPublished),
        "0.23.0",
        "latest"
      )
    ).toEqual({
      mode: "recover",
      missing: packageNames.slice(3),
      published: alreadyPublished,
    });

    expect(() =>
      planCoordinatedRelease(registryStates([launcherName]), "0.23.0", "latest")
    ).toThrow(
      "skillset@0.23.0 is already published while prerequisite release packages are missing"
    );
  });

  test("blocks non-prefix registry states and dist-tag drift", () => {
    expect(() =>
      planCoordinatedRelease(
        registryStates([packageNames[1]!]),
        "0.23.0",
        "latest"
      )
    ).toThrow("published package set is not a canonical prefix");

    expect(() =>
      planCoordinatedRelease(
        registryStates([packageNames[0]!], "0.22.1"),
        "0.23.0",
        "latest"
      )
    ).toThrow(
      "@skillset/native-darwin-arm64@0.23.0 exists, but latest points to 0.22.1"
    );
  });

  test("blocks missing provenance and immutable tarball drift", () => {
    const missingProvenance = registryStates([packageNames[0]!]);
    missingProvenance[0] = {
      ...missingProvenance[0]!,
      provenancePredicateType: undefined,
    };
    expect(() =>
      planCoordinatedRelease(missingProvenance, "0.23.0", "latest")
    ).toThrow("does not expose required npm provenance");

    expect(() =>
      planCoordinatedRelease(
        registryStates([packageNames[0]!]),
        "0.23.0",
        "latest",
        { [packageNames[0]!]: "sha512-expected" }
      )
    ).toThrow("registry integrity does not match the staged tarball");
  });

  test("uses explicit public access, dist-tag, and npm provenance for every package", () => {
    for (const spec of RELEASE_PACKAGE_SPECS) {
      expect(npmPublishCommand(spec, "latest")).toEqual([
        "npm",
        "publish",
        "--access",
        "public",
        "--tag",
        "latest",
        "--provenance",
      ]);
    }
  });

  test("records npm-compatible sha512 tarball integrity", () => {
    expect(tarballIntegrity(new TextEncoder().encode("skillset\n"))).toMatch(
      /^sha512-[A-Za-z0-9+/]+=*$/
    );
  });

  test("pins the exact four-file payload for every staged package", () => {
    for (const spec of RELEASE_PACKAGE_SPECS) {
      expect(expectedReleaseTarballFiles(spec)).toHaveLength(4);
      expect(expectedReleaseTarballFiles(spec)).toContain("package.json");
    }
    expect(expectedReleaseTarballFiles(RELEASE_PACKAGE_SPECS.at(-1)!)).toEqual([
      "LICENSE",
      "README.md",
      "dist/cli.js",
      "package.json",
    ]);
  });
});
