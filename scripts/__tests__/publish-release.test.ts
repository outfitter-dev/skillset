import { expect, test } from "bun:test";

import { publishReleasePackages } from "../publish";
import {
  NPM_PROVENANCE_PREDICATE,
  RELEASE_PACKAGE_SPECS,
  planCoordinatedRelease,
} from "../release-packages";

const version = "0.25.0";
const tag = "latest";
const integrity = "sha512-expected";
const packages = RELEASE_PACKAGE_SPECS.map((spec) => ({
  ...spec,
  filename: "artifact.tgz",
  path: `/staged/${spec.name}.tgz`,
  integrity,
}));
function releaseHarness(count: number) {
  const published = new Set(
    RELEASE_PACKAGE_SPECS.slice(0, count).map((spec) => spec.name)
  );
  const calls: string[] = [];
  const states = () =>
    RELEASE_PACKAGE_SPECS.map(({ name }) => ({
      name,
      published: published.has(name),
      integrity,
      taggedVersion: version,
      provenancePredicateType: NPM_PROVENANCE_PREDICATE,
    }));
  const initialPlan = planCoordinatedRelease(states(), version, tag);
  const io = {
    states: async () => ({ states: states(), version, tag }),
    read: async (name: string) =>
      published.has(name)
        ? {
            "dist-tags": { [tag]: version },
            versions: {
              [version]: {
                dist: {
                  integrity,
                  attestations: {
                    provenance: { predicateType: NPM_PROVENANCE_PREDICATE },
                  },
                },
              },
            },
          }
        : null,
    publish: async (
      spec: (typeof RELEASE_PACKAGE_SPECS)[number],
      path: string
    ) => {
      expect(path).toBe(`/staged/${spec.name}.tgz`);
      if (spec.role === "launcher")
        expect(published.size).toBe(RELEASE_PACKAGE_SPECS.length - 1);
      calls.push(spec.name);
      published.add(spec.name);
      return { exitCode: 0, stderr: "" };
    },
    sleep: async () => {},
    now: Date.now,
    log: () => {},
  };
  return { published, calls, states, initialPlan, io };
}

test("production release loop resumes only the missing suffix and verifies the full set", async () => {
  const probe = releaseHarness(2);
  expect(
    await publishReleasePackages(
      { version, tag },
      probe.initialPlan,
      packages,
      probe.io
    )
  ).toBe(true);
  expect(probe.calls).toEqual([...probe.initialPlan.missing]);
  expect(planCoordinatedRelease(probe.states(), version, tag).mode).toBe(
    "complete"
  );
});

test("a launcher that becomes visible after planning is verified without republishing", async () => {
  const probe = releaseHarness(RELEASE_PACKAGE_SPECS.length - 1);
  probe.published.add("skillset");
  expect(
    await publishReleasePackages(
      { version, tag },
      probe.initialPlan,
      packages,
      probe.io
    )
  ).toBe(false);
  expect(probe.calls).toEqual([]);
});

test("missing prerequisites prevent launcher publication", async () => {
  const probe = releaseHarness(RELEASE_PACKAGE_SPECS.length - 1);
  probe.published.delete("@skillset/cli");
  await expect(
    publishReleasePackages(
      { version, tag },
      probe.initialPlan,
      packages,
      probe.io
    )
  ).rejects.toThrow("before every prerequisite package is visible");
  expect(probe.calls).toEqual([]);
});

test("a stale precheck conflict is recovered in the production loop before publishing the suffix", async () => {
  const probe = releaseHarness(2);
  const firstMissing = probe.initialPlan.missing[0]!;
  const publish = probe.io.publish;
  probe.io.publish = async (spec, path) => {
    if (spec.name !== firstMissing) return publish(spec, path);
    probe.calls.push(spec.name);
    probe.published.add(spec.name);
    return {
      exitCode: 1,
      stderr: `npm error You cannot publish over the previously published versions: ${version}.`,
    };
  };
  expect(
    await publishReleasePackages(
      { version, tag },
      probe.initialPlan,
      packages,
      probe.io
    )
  ).toBe(true);
  expect(probe.calls).toEqual([...probe.initialPlan.missing]);
});

test("final registry drift fails the production loop", async () => {
  const probe = releaseHarness(RELEASE_PACKAGE_SPECS.length);
  probe.published.delete("skillset");
  await expect(
    publishReleasePackages(
      { version, tag },
      probe.initialPlan,
      packages,
      probe.io
    )
  ).rejects.toThrow("Coordinated registry set did not complete");
  expect(probe.calls).toEqual([]);
});
