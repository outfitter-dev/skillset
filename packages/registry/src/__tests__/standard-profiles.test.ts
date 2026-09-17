import { describe, expect, test } from "bun:test";

import {
  assertStandardProfiles,
  getStandardProfile,
  getStandardProfileSupportEnvelope,
  hashStandardProfile,
  hashStandardProfileSnapshot,
  listStandardProfileSchemaSnapshots,
  listStandardProfiles,
  STANDARD_PROFILE_REGISTRY_SCHEMA,
  STANDARD_PROFILE_ADOPTION_EVIDENCE_SCHEMA,
} from "../index";

describe("SET-397 standard profile registry", () => {
  test("ships the three adopted profiles through the registry root contract", () => {
    expect(
      listStandardProfiles().map(({ id, lifecycle, version }) => ({
        id,
        lifecycle,
        version,
      }))
    ).toEqual([
      {
        id: "agent-instructions",
        lifecycle: "adopted",
        version: "unversioned",
      },
      {
        id: "agent-plugins-1.0",
        lifecycle: "adopted",
        version: "1.0.0",
      },
      {
        id: "agent-skills",
        lifecycle: "adopted",
        version: "unversioned",
      },
    ]);

    expect(
      getStandardProfileSupportEnvelope("agent-plugins-1.0", "plugin-manifests")
    ).toMatchObject({ expectation: "required" });
    expect(
      getStandardProfileSupportEnvelope("agent-plugins-1.0", "plugin-skills")
    ).toMatchObject({ expectation: "required" });
    expect(
      getStandardProfileSupportEnvelope("agent-skills", "plugin-skills")
    ).toBeUndefined();
    expect(
      getStandardProfileSupportEnvelope("agent-instructions", "plugin-mcp")
    ).toBeUndefined();
    for (const profile of listStandardProfiles()) {
      expect(profile.adoption).toMatchObject({
        profileContentHash: profile.provenance.contentHash,
        receipt: {
          path: `fixtures/standards/evidence/${profile.id}.json`,
          schema: "skillset.standards-conformance-receipt@1",
        },
        schema: STANDARD_PROFILE_ADOPTION_EVIDENCE_SCHEMA,
      });
      expect(profile.adoption?.rendererCommit).toBe(
        {
          "agent-instructions": "dade1c128d2ec52452297d829bd2045b35517f92",
          "agent-plugins-1.0": "0c073e001c639e505379b96bd779af20fc9a574b",
          "agent-skills": "15a9eee591d7b1abd4660ae96ecae1d78776c385",
        }[profile.id]
      );
    }
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

  test("requires immutable candidate evidence before adoption without changing the contract hash", () => {
    const shipped = getStandardProfile("agent-skills");
    const { adoption: _adoption, ...candidateProfile } = shipped;
    const candidate = { ...candidateProfile, lifecycle: "candidate" as const };
    const adopted = {
      ...candidate,
      adoption: {
        profileContentHash: candidate.provenance
          .contentHash as `sha256:${string}`,
        receipt: {
          contentHash: `sha256:${"a".repeat(64)}` as const,
          path: "fixtures/standards/evidence/agent-skills.json",
          schema: "skillset.standards-conformance-receipt@1" as const,
        },
        rendererCommit: "b".repeat(40),
        schema: STANDARD_PROFILE_ADOPTION_EVIDENCE_SCHEMA,
        verifiedAt: "2026-09-13T12:34:56.000Z",
      },
      lifecycle: "adopted" as const,
    };

    expect(hashStandardProfile(adopted)).toBe(candidate.provenance.contentHash);
    expect(() => assertStandardProfiles([adopted])).not.toThrow();
    expect(() =>
      assertStandardProfiles([{ ...candidate, lifecycle: "adopted" }])
    ).toThrow("requires candidate conformance evidence");
    expect(() =>
      assertStandardProfiles([{ ...candidate, adoption: adopted.adoption }])
    ).toThrow("non-adopted standard profile");
  });
});
