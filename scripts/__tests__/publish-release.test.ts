import { expect, test } from "bun:test";

import { publishReleasePackages } from "../publish";
import {
  PROPAGATION_WINDOW_MS,
  readReleaseRegistryStates,
} from "../publish-propagation";
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

test("a persistent canonical gap times out before any npm publication", async () => {
  const probe = releaseHarness(2);
  probe.published.delete(RELEASE_PACKAGE_SPECS[0]!.name);
  let elapsed = 0;
  const io = {
    ...probe.io,
    now: () => elapsed,
    sleep: async (ms: number) => {
      elapsed += ms;
    },
  };
  const attempt = async () => {
    const states = await readReleaseRegistryStates(
      RELEASE_PACKAGE_SPECS.map(({ name }) => ({ name, version, tag })),
      io
    );
    return publishReleasePackages(
      { version, tag },
      planCoordinatedRelease(states, version, tag),
      packages,
      io
    );
  };
  await expect(attempt()).rejects.toThrow(
    `within ${PROPAGATION_WINDOW_MS / 1000}s`
  );
  expect(elapsed).toBe(PROPAGATION_WINDOW_MS);
  expect(probe.calls).toEqual([]);
});

function delayedVisibilityHarness(visibleAfter: ReadonlyMap<string, number>) {
  const probe = releaseHarness(0);
  const publishedAt = new Map<string, number>();
  let now = 0;
  const visible = (name: string) =>
    probe.published.has(name) &&
    now - publishedAt.get(name)! >= (visibleAfter.get(name) ?? 0);
  const states = () =>
    probe.states().map((state) => ({
      ...state,
      published: visible(state.name),
    }));
  const io = {
    ...probe.io,
    states: async () => ({ states: states(), version, tag }),
    read: async (name: string) =>
      visible(name) ? probe.io.read(name) : Promise.resolve(null),
    publish: async (
      spec: (typeof RELEASE_PACKAGE_SPECS)[number],
      path: string
    ) => {
      if (spec.role === "launcher") {
        for (const prerequisite of RELEASE_PACKAGE_SPECS.slice(0, -1))
          expect(visible(prerequisite.name)).toBe(true);
      }
      publishedAt.set(spec.name, now);
      return probe.io.publish(spec, path);
    },
    now: () => now,
    sleep: async (ms: number) => {
      const target = now + ms;
      await Promise.resolve();
      now = Math.max(now, target);
    },
  };
  return { ...probe, io, publishedAt, elapsed: () => now };
}

test("a prerequisite slower than the former five-minute window does not hold up the rest of the set", async () => {
  const slow = RELEASE_PACKAGE_SPECS[0]!.name;
  const probe = delayedVisibilityHarness(new Map([[slow, 600_000]]));
  expect(
    await publishReleasePackages(
      { version, tag },
      probe.initialPlan,
      packages,
      probe.io
    )
  ).toBe(true);
  expect(probe.calls).toEqual(RELEASE_PACKAGE_SPECS.map(({ name }) => name));
  // Prerequisites publish back to back instead of queueing behind the slow one.
  for (const spec of RELEASE_PACKAGE_SPECS.slice(0, -1))
    expect(probe.publishedAt.get(spec.name)).toBe(0);
  expect(probe.publishedAt.get("skillset")!).toBeGreaterThanOrEqual(600_000);
  expect(probe.elapsed()).toBeLessThan(PROPAGATION_WINDOW_MS);
});

test("every prerequisite that never appears is reported and the launcher is withheld", async () => {
  const [first, second] = RELEASE_PACKAGE_SPECS;
  const probe = delayedVisibilityHarness(
    new Map([
      [first!.name, Number.POSITIVE_INFINITY],
      [second!.name, Number.POSITIVE_INFINITY],
    ])
  );
  const attempt = publishReleasePackages(
    { version, tag },
    probe.initialPlan,
    packages,
    probe.io
  );
  await expect(attempt).rejects.toThrow("2 packages did not verify");
  await attempt.catch((error: Error) => {
    expect(error.message).toContain(first!.name);
    expect(error.message).toContain(second!.name);
  });
  expect(probe.calls).toEqual(
    RELEASE_PACKAGE_SPECS.slice(0, -1).map(({ name }) => name)
  );
  // Both windows run concurrently rather than back to back.
  expect(probe.elapsed()).toBe(PROPAGATION_WINDOW_MS);
});

test("an occupied prerequisite with different bytes stops the set before later publishes", async () => {
  const probe = releaseHarness(0);
  const first = RELEASE_PACKAGE_SPECS[0]!.name;
  probe.published.add(first);
  const read = probe.io.read;
  probe.io.read = async (name: string) => {
    const document = await read(name);
    if (name !== first || !document) return document;
    return {
      ...document,
      versions: {
        [version]: {
          dist: {
            ...document.versions[version]!.dist,
            integrity: "sha512-other",
          },
        },
      },
    };
  };
  await expect(
    publishReleasePackages(
      { version, tag },
      probe.initialPlan,
      packages,
      probe.io
    )
  ).rejects.toThrow("integrity does not match");
  expect(probe.calls).toEqual([]);
});
