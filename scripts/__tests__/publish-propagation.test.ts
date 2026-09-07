import { describe, expect, test } from "bun:test";

import {
  isImmutableVersionConflict,
  publishAndVerify,
  readReleaseRegistryState,
  readReleaseRegistryStates,
  type RegistryDocument,
} from "../publish-propagation";
import { NPM_PROVENANCE_PREDICATE } from "../release-packages";

const publication = {
  name: "@skillset/cli",
  version: "0.25.0",
  tag: "latest",
  integrity: "sha512-expected",
};
function visible(
  overrides: { integrity?: string; provenance?: string; tag?: string } = {}
): RegistryDocument {
  return {
    "dist-tags": { latest: overrides.tag ?? publication.version },
    versions: {
      [publication.version]: {
        dist: {
          integrity: overrides.integrity ?? publication.integrity,
          attestations: {
            provenance: {
              predicateType: overrides.provenance ?? NPM_PROVENANCE_PREDICATE,
            },
          },
        },
      },
    },
  };
}
function harness(
  documents: (RegistryDocument | null)[],
  result = { exitCode: 0, stderr: "" }
) {
  let reads = 0;
  let publishes = 0;
  const sleeps: number[] = [];
  let elapsed = 0;
  return {
    io: {
      read: async () => documents[Math.min(reads++, documents.length - 1)]!,
      publish: async () => {
        publishes++;
        return result;
      },
      sleep: async (ms: number) => {
        sleeps.push(ms);
        elapsed += ms;
      },
      now: () => elapsed,
      log: () => {},
    },
    sleeps,
    publishes: () => publishes,
  };
}

describe("npm propagation and immutable retry", () => {
  test("successful publication waits past the former 30-second limit without republishing", async () => {
    const probe = harness([...Array(10).fill(null), visible()]);
    expect(await publishAndVerify(publication, probe.io)).toBe(true);
    expect(probe.publishes()).toBe(1);
    expect(probe.sleeps.reduce((sum, ms) => sum + ms, 0)).toBeGreaterThan(
      180_000
    );
    expect(Math.max(...probe.sleeps)).toBe(30_000);
  });

  test("a freshly visible occupied version is verified without a publish call", async () => {
    const probe = harness([visible()]);
    expect(await publishAndVerify(publication, probe.io)).toBe(false);
    expect(probe.publishes()).toBe(0);
  });

  test("an exact-version conflict waits for proof and continues without another publish", async () => {
    const probe = harness([null, null, visible()], {
      exitCode: 1,
      stderr:
        "npm error You cannot publish over the previously published versions: 0.25.0.",
    });
    expect(await publishAndVerify(publication, probe.io)).toBe(false);
    expect(probe.publishes()).toBe(1);
  });

  test("unrelated npm failures and other occupied versions fail immediately", async () => {
    for (const stderr of [
      "npm error E403 Forbidden",
      "npm error You cannot publish over the previously published versions: 0.25.01.",
      "npm error You cannot publish over the previously published versions: 0.25.0-beta.1.",
    ]) {
      const probe = harness([null], { exitCode: 1, stderr });
      expect(isImmutableVersionConflict(stderr, publication.version)).toBe(
        false
      );
      await expect(publishAndVerify(publication, probe.io)).rejects.toThrow(
        "failed with exit code 1"
      );
      expect(probe.sleeps).toEqual([]);
    }
  });

  test("an occupied version with different bytes fails closed", async () => {
    const probe = harness([null, visible({ integrity: "sha512-other" })], {
      exitCode: 1,
      stderr:
        "npm error You cannot publish over the previously published versions: 0.25.0",
    });
    await expect(publishAndVerify(publication, probe.io)).rejects.toThrow(
      "integrity does not match"
    );
    expect(probe.sleeps).toEqual([]);
  });

  test("missing visibility, wrong provenance, and tag drift each exhaust the bounded wait", async () => {
    for (const document of [
      null,
      visible({ provenance: "wrong" }),
      visible({ tag: "0.24.0" }),
    ]) {
      const probe = harness([null, document]);
      await expect(publishAndVerify(publication, probe.io)).rejects.toThrow(
        "within 300s; the version may already be published"
      );
      expect(probe.sleeps.reduce((sum, ms) => sum + ms, 0)).toBe(300_000);
      expect(probe.publishes()).toBe(1);
    }
  });

  test("registry latency consumes the propagation deadline", async () => {
    const probe = harness([null]);
    let now = 0;
    let reads = 0;
    const io = {
      ...probe.io,
      now: () => now,
      read: async (_name: string, signal?: AbortSignal) => {
        if (reads++ > 0) {
          expect(signal).toBeDefined();
          now += 100_000;
        }
        return null;
      },
      sleep: async (ms: number) => {
        now += ms;
      },
    };
    await expect(publishAndVerify(publication, io)).rejects.toThrow(
      "within 300s"
    );
    expect(reads).toBe(4);
    expect(probe.publishes()).toBe(1);
  });
  test("preflight waits for occupied-version metadata before strict release planning", async () => {
    const incomplete = {
      versions: {
        [publication.version]: { dist: { integrity: publication.integrity } },
      },
    };
    const probe = harness([incomplete, incomplete, visible()]);
    const state = await readReleaseRegistryState(publication, probe.io);
    expect(state).toEqual({
      name: publication.name,
      published: true,
      integrity: publication.integrity,
      provenancePredicateType: NPM_PROVENANCE_PREDICATE,
      taggedVersion: publication.version,
    });
    expect(probe.publishes()).toBe(0);
    expect(probe.sleeps.length).toBeGreaterThan(0);
  });

  test("preflight returns absent versions immediately and fails closed for persistent missing proof", async () => {
    const absent = harness([null]);
    expect(
      (await readReleaseRegistryState(publication, absent.io)).published
    ).toBe(false);
    expect(absent.sleeps).toEqual([]);
    const incomplete = harness([{ versions: { [publication.version]: {} } }]);
    await expect(
      readReleaseRegistryState(publication, incomplete.io)
    ).rejects.toThrow("within 300s");
    expect(incomplete.publishes()).toBe(0);
  });

  test("coordinated preflight rereads a stale absent after a sibling occupied wait", async () => {
    const earlier = {
      name: "@skillset/native-darwin-arm64",
      version: publication.version,
      tag: publication.tag,
    };
    const later = {
      name: publication.name,
      version: publication.version,
      tag: publication.tag,
    };
    const incomplete = {
      versions: {
        [publication.version]: { dist: { integrity: publication.integrity } },
      },
    };
    let earlierReads = 0;
    let laterReads = 0;
    let elapsed = 0;
    const io = {
      read: async (name: string) => {
        if (name === earlier.name) {
          earlierReads += 1;
          return earlierReads === 1 ? null : visible();
        }
        laterReads += 1;
        return laterReads === 1 ? incomplete : visible();
      },
      sleep: async (ms: number) => {
        elapsed += ms;
      },
      now: () => elapsed,
      log: () => {},
    };
    const states = await readReleaseRegistryStates([earlier, later], io);
    expect(states.map((state) => [state.name, state.published])).toEqual([
      [earlier.name, true],
      [later.name, true],
    ]);
    expect(earlierReads).toBe(2);
    expect(elapsed).toBeGreaterThan(0);
  });

  test("coordinated preflight rereads a genuine absent once and does not wait", async () => {
    const published = {
      name: "@skillset/native-darwin-arm64",
      version: publication.version,
      tag: publication.tag,
    };
    const missing = {
      name: publication.name,
      version: publication.version,
      tag: publication.tag,
    };
    let missingReads = 0;
    const sleeps: number[] = [];
    const io = {
      read: async (name: string) => {
        if (name === missing.name) {
          missingReads += 1;
          return null;
        }
        return visible();
      },
      sleep: async (ms: number) => {
        sleeps.push(ms);
      },
      now: () => 0,
      log: () => {},
    };
    const states = await readReleaseRegistryStates([published, missing], io);
    expect(states.map((state) => state.published)).toEqual([true, false]);
    expect(missingReads).toBe(2);
    expect(sleeps).toEqual([]);
  });

  test("a fresh occupied version with different bytes is rejected on its first document", async () => {
    const probe = harness([visible({ integrity: "sha512-other" }), visible()]);
    await expect(publishAndVerify(publication, probe.io)).rejects.toThrow(
      "integrity does not match"
    );
    expect(probe.publishes()).toBe(0);
  });
});
