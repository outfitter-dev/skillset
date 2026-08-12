import { describe, expect, test } from "bun:test";

import {
  RELEASE_MANIFEST_PATHS,
  assertReleaseManifestVersions,
} from "../release-ref";

describe("release version commit", () => {
  test("requires the exact seven manifests at one product version", () => {
    const manifests = Object.fromEntries(
      RELEASE_MANIFEST_PATHS.map((path) => [path, { version: "0.23.0" }])
    );
    expect(() =>
      assertReleaseManifestVersions(manifests, "0.23.0")
    ).not.toThrow();

    manifests[RELEASE_MANIFEST_PATHS[0]!] = { version: "0.22.1" };
    expect(() => assertReleaseManifestVersions(manifests, "0.23.0")).toThrow(
      "is not version 0.23.0 at the release commit"
    );
  });

  test("rejects incomplete or extra manifest sets", () => {
    const manifests = Object.fromEntries(
      RELEASE_MANIFEST_PATHS.slice(1).map((path) => [
        path,
        { version: "0.23.0" },
      ])
    );
    expect(() => assertReleaseManifestVersions(manifests, "0.23.0")).toThrow(
      "must contain exactly"
    );
  });
});
