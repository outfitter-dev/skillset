import { describe, expect, test } from "bun:test";

import {
  assertStandardProfiles,
  getStandardProfile,
  getStandardProfileSupportEnvelope,
  hashStandardProfileSnapshot,
  listStandardProfileSchemaSnapshots,
  listStandardProfiles,
  STANDARD_PROFILE_REGISTRY_SCHEMA,
} from "../index";

describe("SET-397 standard profile registry", () => {
  test("ships the three candidate profiles through the registry root contract", () => {
    expect(
      listStandardProfiles().map(({ id, lifecycle, version }) => ({
        id,
        lifecycle,
        version,
      }))
    ).toEqual([
      {
        id: "agent-instructions",
        lifecycle: "candidate",
        version: "unversioned",
      },
      {
        id: "agent-plugins-1.0",
        lifecycle: "candidate",
        version: "1.0.0",
      },
      {
        id: "agent-skills",
        lifecycle: "candidate",
        version: "unversioned",
      },
    ]);

    expect(
      getStandardProfileSupportEnvelope("agent-plugins-1.0", "plugin-manifests")
    ).toMatchObject({ expectation: "required" });
    expect(
      getStandardProfileSupportEnvelope("agent-instructions", "plugin-mcp")
    ).toBeUndefined();
  });

  test("keeps the complete Agent Plugins schemas available and hash-pinned offline", () => {
    const schemas = listStandardProfileSchemaSnapshots("agent-plugins-1.0");
    expect(
      schemas.map(({ contentHash, url }) => ({ contentHash, url }))
    ).toEqual([
      {
        contentHash:
          "sha256:6539175bfcdf43085855183e86da40ea94b166547a72b47ae9a0a390516d3acb",
        url: "https://raw.githubusercontent.com/agentplugins/agent-plugins-spec/1fc1b6270e3cc492ec2d24ad7a34277c6d53b9c1/schemas/1.0.0/mcp.schema.json",
      },
      {
        contentHash:
          "sha256:0a4aad95ce337878ad38802ebf0daa3fde76abe3f65400c86bcbb1ec0b3ab883",
        url: "https://raw.githubusercontent.com/agentplugins/agent-plugins-spec/1fc1b6270e3cc492ec2d24ad7a34277c6d53b9c1/schemas/1.0.0/plugin.schema.json",
      },
    ]);

    for (const snapshot of schemas) {
      expect(snapshot.body.length).toBeGreaterThan(1_000);
      expect(hashStandardProfileSnapshot(snapshot)).toBe(snapshot.contentHash);
      expect(JSON.parse(snapshot.body).$id).toBe(
        snapshot.url.replace(
          "https://raw.githubusercontent.com/agentplugins/agent-plugins-spec/1fc1b6270e3cc492ec2d24ad7a34277c6d53b9c1",
          "https://agent-plugins.org"
        )
      );
    }
  });

  test("freezes snapshots and rejects duplicate identities or altered snapshot bodies", () => {
    const profiles = listStandardProfiles();
    expect(Object.isFrozen(profiles)).toBe(true);
    expect(Object.isFrozen(profiles[0]?.provenance.snapshots)).toBe(true);
    expect(() => assertStandardProfiles([profiles[0]!, profiles[0]!])).toThrow(
      "duplicate standard profile"
    );

    const profile = getStandardProfile("agent-plugins-1.0");
    const first = profile.provenance.snapshots[0]!;
    expect(() =>
      assertStandardProfiles([
        {
          ...profile,
          provenance: {
            ...profile.provenance,
            snapshots: [{ ...first, body: first.body + "drift" }],
          },
        },
      ])
    ).toThrow("snapshot hash drifted");
  });

  test("keeps profile provenance self-describing", () => {
    for (const profile of listStandardProfiles()) {
      expect(profile.schema).toBe(STANDARD_PROFILE_REGISTRY_SCHEMA);
      expect(profile.provenance.contentHash).toMatch(/^sha256:[a-f0-9]{64}$/u);
      for (const snapshot of profile.provenance.snapshots) {
        expect(snapshot.observedAt).toBe("2026-09-12T15:34:39.000Z");
        expect(snapshot.url).toMatch(
          /raw\.githubusercontent\.com\/[^/]+\/[^/]+\/[a-f0-9]{40}\//u
        );
        expect(snapshot.currentUrl).toMatch(
          /raw\.githubusercontent\.com\/[^/]+\/[^/]+\/main\//u
        );
      }
    }
  });
});
