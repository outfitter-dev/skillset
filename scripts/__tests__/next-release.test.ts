import { describe, expect, test } from "bun:test";

import {
  applyNextVersionToManifests,
  decideNextPublish,
  isNextVersion,
  nextPrereleaseVersion,
} from "../next-release";
import { distTagForVersion } from "../publish";
import { RELEASE_PACKAGE_SPECS } from "../release-packages";

function releaseManifests(version: string) {
  const manifests: Record<string, Record<string, unknown>> = {};
  const nativeNames = RELEASE_PACKAGE_SPECS.filter(
    (spec) => spec.role === "native"
  ).map((spec) => spec.name);
  for (const spec of RELEASE_PACKAGE_SPECS) {
    manifests[spec.directory] = {
      name: spec.name,
      version,
      ...(spec.role === "launcher"
        ? {
            optionalDependencies: Object.fromEntries(
              nativeNames.map((name) => [name, version])
            ),
          }
        : {}),
    };
  }
  return manifests;
}

describe("next prerelease channel", () => {
  test("numbers prereleases from zero per pending stable version", () => {
    expect(nextPrereleaseVersion("0.29.0", [])).toBe("0.29.0-next.0");
    expect(
      nextPrereleaseVersion("0.29.0", [
        "0.28.0",
        "0.28.0-next.7",
        "0.29.0-next.0",
        "0.29.0-next.2",
        "0.29.0-beta.9",
      ])
    ).toBe("0.29.0-next.3");
  });

  test("skips past an abandoned partial prerelease on any package", () => {
    // A native package can hold next.4 while the launcher stops at next.3.
    expect(
      nextPrereleaseVersion("0.29.0", ["0.29.0-next.3", "0.29.0-next.4"])
    ).toBe("0.29.0-next.5");
  });

  test("refuses a prerelease base and only accepts next versions", () => {
    expect(() => nextPrereleaseVersion("0.29.0-next.1", [])).toThrow(
      "stable base version"
    );
    expect(isNextVersion("0.29.0-next.0")).toBe(true);
    expect(isNextVersion("0.29.0-next.01")).toBe(false);
    expect(isNextVersion("0.29.0")).toBe(false);
    expect(isNextVersion("0.29.0-beta.1")).toBe(false);
  });

  test("every next version maps to the next dist-tag, never latest", () => {
    expect(distTagForVersion("0.29.0-next.0")).toBe("next");
    expect(distTagForVersion("1.0.0-next.12")).toBe("next");
  });

  test("applies one exact version to all seven manifests and launcher pins", () => {
    const updated = applyNextVersionToManifests(
      releaseManifests("0.28.0"),
      "0.29.0-next.2"
    );
    for (const spec of RELEASE_PACKAGE_SPECS) {
      expect(updated[spec.directory]?.version).toBe("0.29.0-next.2");
    }
    const launcher = updated["apps/skillset"]?.optionalDependencies as Record<
      string,
      string
    >;
    expect(Object.values(launcher)).toEqual(
      Array(Object.keys(launcher).length).fill("0.29.0-next.2")
    );
    expect(() =>
      applyNextVersionToManifests(releaseManifests("0.28.0"), "0.29.0")
    ).toThrow("Refusing to apply 0.29.0");
  });

  test("publishes only when package-facing paths changed since the last next tag", () => {
    const base = {
      force: false,
      pendingVersion: "0.29.0",
      previousTag: "v0.29.0-next.1",
    };
    expect(
      decideNextPublish({ ...base, pendingVersion: undefined, changedFiles: [] })
        .publish
    ).toBe(false);
    expect(
      decideNextPublish({
        ...base,
        changedFiles: [
          { path: "docs/development/package-releases.md", status: "M" },
          { path: ".changeset/new-thing.md", status: "A" },
        ],
      }).publish
    ).toBe(false);
    expect(
      decideNextPublish({
        ...base,
        changedFiles: [{ path: "packages/core/src/index.ts", status: "M" }],
      }).publish
    ).toBe(true);
    expect(
      decideNextPublish({
        ...base,
        changedFiles: [
          { path: "packages/core/src/moved.ts", status: "D" },
          { path: "docs/moved.ts", status: "A" },
        ],
      }).publish
    ).toBe(true);
    expect(
      decideNextPublish({
        ...base,
        previousTag: undefined,
        changedFiles: undefined,
      }).publish
    ).toBe(true);
    expect(
      decideNextPublish({ ...base, force: true, changedFiles: [] }).publish
    ).toBe(true);
  });
});
