import { describe, expect, test } from "bun:test";

import {
  assertStandardCompatibilityRegistry,
  defineStandardCompatibilityRegistry,
  getStandardCompatibilityEntry,
  getStandardConsumerProfile,
} from "../index";

describe("SET-513 standard compatibility evidence", () => {
  test("records SEP-2640 as an immutable candidate without activating it", () => {
    const entry = getStandardCompatibilityEntry("mcp-skills-extension");

    expect(entry).toMatchObject({
      contentHash:
        "sha256:4a3bc38e896b151494e7c2af47d3b877e58dbdd26aafe8646873953f7f2bd8b9",
      extensionId: "io.modelcontextprotocol/skills",
      proposal: "SEP-2640",
      protocolRevision: "2026-07-28",
      revision: "d866efdba298b55b8156c7b7aa1bdebc1b625f4c",
      skillFormat: {
        directoryNameMatchesSkillName: true,
        name: "Agent Skills",
      },
      status: "candidate",
    });
    expect(entry.sources[0]?.note).toContain("supersedes the older 753b9f2");
    expect(entry.sources[0]?.url).toContain(
      `/ext-skills/blob/${entry.revision}/`
    );
    expect(entry).not.toHaveProperty("target");
    expect(entry).not.toHaveProperty("renderer");
    expect(Object.isFrozen(entry)).toBe(true);
    expect(
      Object.isFrozen(
        defineStandardCompatibilityRegistry({
          consumers: [
            getStandardConsumerProfile("openai-plugin-submission-skill-import"),
          ],
          standards: [entry],
        })
      )
    ).toBe(true);
  });

  test("keeps OpenAI submission limits separate from the standard outer bounds", () => {
    const standard = getStandardCompatibilityEntry("mcp-skills-extension");
    const openai = getStandardConsumerProfile(
      "openai-plugin-submission-skill-import"
    );

    expect(standard.limits).toEqual({
      maxResourcesPerSkill: 512,
      maxTotalResourceBytesPerSkill: 16_777_216,
    });
    expect(openai).toMatchObject({
      consumer: "OpenAI plugin submission",
      limits: {
        maxArchiveBytesPerScan: 8_388_608,
        maxCatalogPagesPerScan: 10,
        maxResourcesPerSkill: 100,
        maxSkillMarkdownBytes: 262_144,
        maxSkillsPerScan: 5,
        maxSupportingFileBytes: 1_048_576,
        maxTotalResourceBytesPerSkill: 5_242_880,
      },
      mode: "submission-snapshot",
      standardId: standard.id,
    });
    expect(openai.limits.maxResourcesPerSkill).toBeLessThan(
      standard.limits.maxResourcesPerSkill
    );
    expect(openai.limits.maxTotalResourceBytesPerSkill).toBeLessThan(
      standard.limits.maxTotalResourceBytesPerSkill
    );
    expect(openai.limitations.join(" ")).toContain(
      "not live runtime skill discovery"
    );
    expect(openai.limitations.join(" ")).toContain("required size field");
  });

  test("records the transport contract without treating OpenAI as runtime discovery", () => {
    const standard = getStandardCompatibilityEntry("mcp-skills-extension");
    const openai = getStandardConsumerProfile(
      "openai-plugin-submission-skill-import"
    );

    expect(standard.requiredMethods).toEqual([
      "resources/read",
      "skills/get",
      "skills/list",
    ]);
    expect(standard.optionalMethods).toEqual(["resources/directory/read"]);
    expect(openai.limitations.join(" ")).toContain("bounded static subset");
    expect(openai.limitations.join(" ")).toContain(
      "tool discovery can still succeed"
    );
    expect(openai).not.toHaveProperty("runtimeDiscovery");
  });

  test("rejects invalid and duplicate registry identities and missing references", () => {
    const standard = getStandardCompatibilityEntry("mcp-skills-extension");
    const openai = getStandardConsumerProfile(
      "openai-plugin-submission-skill-import"
    );

    expect(() =>
      assertStandardCompatibilityRegistry({
        consumers: [],
        standards: [{ ...standard, id: "MCP Skills" as typeof standard.id }],
      })
    ).toThrow("invalid standard compatibility ID");
    expect(() =>
      assertStandardCompatibilityRegistry({
        consumers: [],
        standards: [standard, standard],
      })
    ).toThrow("duplicate standard compatibility ID");
    expect(() =>
      assertStandardCompatibilityRegistry({
        consumers: [{ ...openai, id: "OpenAI Import" as typeof openai.id }],
        standards: [standard],
      })
    ).toThrow("invalid standard consumer profile ID");
    expect(() =>
      assertStandardCompatibilityRegistry({
        consumers: [openai, openai],
        standards: [standard],
      })
    ).toThrow("duplicate standard consumer profile ID");
    expect(() =>
      assertStandardCompatibilityRegistry({
        consumers: [
          {
            ...openai,
            standardId: "missing-standard" as typeof standard.id,
          },
        ],
        standards: [standard],
      })
    ).toThrow("references missing standard missing-standard");
  });

  test("rejects malformed immutable evidence and observation dates", () => {
    const standard = getStandardCompatibilityEntry("mcp-skills-extension");
    const openai = getStandardConsumerProfile(
      "openai-plugin-submission-skill-import"
    );

    expect(() =>
      assertStandardCompatibilityRegistry({
        consumers: [],
        standards: [{ ...standard, revision: "d866efd" }],
      })
    ).toThrow("requires a full immutable revision");
    expect(() =>
      assertStandardCompatibilityRegistry({
        consumers: [],
        standards: [
          {
            ...standard,
            contentHash: "sha256:bad" as typeof standard.contentHash,
          },
        ],
      })
    ).toThrow("requires an exact SHA-256 content hash");
    expect(() =>
      assertStandardCompatibilityRegistry({
        consumers: [],
        standards: [{ ...standard, observedAt: "2026-99-99" }],
      })
    ).toThrow("invalid observation date");
    expect(() =>
      assertStandardCompatibilityRegistry({
        consumers: [],
        standards: [
          {
            ...standard,
            sources: [{ url: "http://example.com/spec" }],
          },
        ],
      })
    ).toThrow("requires an HTTPS source URL");
    expect(() =>
      assertStandardCompatibilityRegistry({
        consumers: [{ ...openai, observedAt: "not-a-date" }],
        standards: [standard],
      })
    ).toThrow("invalid observation date");
    expect(() =>
      assertStandardCompatibilityRegistry({
        consumers: [
          {
            ...openai,
            source: { url: "https://user:secret@example.com/import" },
          },
        ],
        standards: [standard],
      })
    ).toThrow("requires an HTTPS source URL");
  });

  test("rejects invalid limits and ambiguous method classifications", () => {
    const standard = getStandardCompatibilityEntry("mcp-skills-extension");
    const openai = getStandardConsumerProfile(
      "openai-plugin-submission-skill-import"
    );

    expect(() =>
      assertStandardCompatibilityRegistry({
        consumers: [],
        standards: [
          {
            ...standard,
            limits: { ...standard.limits, maxResourcesPerSkill: 0 },
          },
        ],
      })
    ).toThrow("requires positive integer limits");
    expect(() =>
      assertStandardCompatibilityRegistry({
        consumers: [
          {
            ...openai,
            limits: { ...openai.limits, maxSkillsPerScan: -1 },
          },
        ],
        standards: [standard],
      })
    ).toThrow("requires positive integer limits");
    expect(() =>
      assertStandardCompatibilityRegistry({
        consumers: [],
        standards: [
          {
            ...standard,
            optionalMethods: ["resources/read"],
          },
        ],
      })
    ).toThrow(
      "unique, non-empty required methods disjoint from optional methods"
    );
    expect(() =>
      defineStandardCompatibilityRegistry({
        consumers: [],
        standards: [{ ...standard, optionalMethods: [] }],
      })
    ).not.toThrow();
  });

  test("rejects invalid discriminants, empty required text, and consumer bounds above the standard", () => {
    const standard = getStandardCompatibilityEntry("mcp-skills-extension");
    const openai = getStandardConsumerProfile(
      "openai-plugin-submission-skill-import"
    );

    for (const invalid of [
      { ...standard, status: "proposed" as typeof standard.status },
      { ...standard, extensionId: "" },
      { ...standard, proposal: "   " },
      { ...standard, protocolRevision: "" },
      { ...standard, skillFormat: { ...standard.skillFormat, name: "" } },
    ]) {
      expect(() =>
        assertStandardCompatibilityRegistry({
          consumers: [],
          standards: [invalid],
        })
      ).toThrow();
    }
    expect(() =>
      assertStandardCompatibilityRegistry({
        consumers: [{ ...openai, mode: "runtime" as typeof openai.mode }],
        standards: [standard],
      })
    ).toThrow("requires submission-snapshot mode");
    expect(() =>
      assertStandardCompatibilityRegistry({
        consumers: [{ ...openai, consumer: " " }],
        standards: [standard],
      })
    ).toThrow("consumer is required");
    expect(() =>
      assertStandardCompatibilityRegistry({
        consumers: [
          {
            ...openai,
            limits: {
              ...openai.limits,
              maxResourcesPerSkill: standard.limits.maxResourcesPerSkill + 1,
            },
          },
        ],
        standards: [standard],
      })
    ).toThrow("exceeds standard mcp-skills-extension resource bounds");
    expect(() =>
      assertStandardCompatibilityRegistry({
        consumers: [
          {
            ...openai,
            limits: {
              ...openai.limits,
              maxTotalResourceBytesPerSkill:
                standard.limits.maxTotalResourceBytesPerSkill + 1,
            },
          },
        ],
        standards: [standard],
      })
    ).toThrow("exceeds standard mcp-skills-extension byte bounds");
  });
});
