/* eslint-disable func-style, sort-keys -- The fixture helper leads the cases, and the canonicalization case intentionally reverses key order. */
import { describe, expect, test } from "bun:test";
import { cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { listStandardProfiles } from "@skillset/registry";

import {
  createStandardsConformanceReceipt,
  hashStandardsConformanceReceipt,
  parseStandardsConformanceReceipt,
  serializeStandardsConformanceReceipt,
  STANDARDS_CONFORMANCE_RECEIPT_JSON_SCHEMA,
  STANDARDS_CONFORMANCE_RECEIPT_SCHEMA_VERSION,
} from "./receipt";
import type { StandardsConformanceReceipt } from "./receipt";
import { verifyAllAdoptedStandardsConformance } from "./run";

const HASH = `sha256:${"a".repeat(64)}` as const;
const OTHER_HASH = `sha256:${"b".repeat(64)}` as const;

function sampleReceipt(): StandardsConformanceReceipt {
  return {
    artifacts: [
      { bytes: 42, hash: HASH, mode: "100644", path: "agents/plugin.json" },
    ],
    canaries: [
      {
        argv: ["validator", "invalid"],
        id: "invalid-manifest",
        observed: "rejected",
        path: "canaries/invalid/plugin.json",
      },
    ],
    consumers: [
      {
        id: "codex",
        integrity: "sha512-example",
        pin: "npm:@openai/codex@0.154.0",
        version: "0.154.0",
      },
    ],
    lifecycle: "candidate",
    limitations: ["Provider activation is outside this conformance lane."],
    observations: ["The pinned consumer discovered the generated plugin."],
    profile: "agent-plugins-1.0",
    profileSnapshot: {
      contentHash: HASH,
      snapshots: [
        {
          contentHash: OTHER_HASH,
          kind: "schema",
          revision: "2026-09-12",
          source: "https://example.test/plugin.schema.json",
        },
      ],
      version: "1.0",
    },
    recordedAt: "2026-09-13T12:34:56.000Z",
    renderer: { clean: true, commit: "c".repeat(40) },
    safety: {
      after: [{ hash: HASH, root: "checkout" }],
      before: [{ hash: HASH, root: "checkout" }],
      unchanged: true,
    },
    schemaVersion: STANDARDS_CONFORMANCE_RECEIPT_SCHEMA_VERSION,
    sourceTree: { fileCount: 3, sourceHash: HASH, treeHash: OTHER_HASH },
    validators: [
      {
        argv: ["validator", "agents/plugin.json"],
        id: "agent-plugin-schema",
        integrity: "sha512-validator",
        outcome: "passed",
        pin: "ajv@8.20.0",
        version: "8.20.0",
      },
    ],
  };
}

describe("SET-411 standards conformance receipt", () => {
  test("reproves every adopted receipt from registry evidence and fixture bytes without a Git checkout", async () => {
    const repositoryRoot = path.resolve(import.meta.dir, "../../..");
    const isolatedRoot = await mkdtemp(
      path.join(tmpdir(), "skillset-adopted-standards-check-")
    );
    try {
      await mkdir(path.join(isolatedRoot, "fixtures", "standards"), {
        recursive: true,
      });
      await Promise.all([
        cp(
          path.join(repositoryRoot, "fixtures", "standards-adoption"),
          path.join(isolatedRoot, "fixtures", "standards-adoption"),
          { recursive: true }
        ),
        cp(
          path.join(repositoryRoot, "fixtures", "standards", "evidence"),
          path.join(isolatedRoot, "fixtures", "standards", "evidence"),
          { recursive: true }
        ),
      ]);

      const results = await verifyAllAdoptedStandardsConformance(isolatedRoot);
      const adoptedProfiles = listStandardProfiles()
        .filter((profile) => profile.lifecycle === "adopted")
        .map((profile) => {
          if (profile.adoption === undefined) {
            throw new Error(`missing adoption evidence for ${profile.id}`);
          }
          return profile;
        });

      expect(results.map((result) => result.profile)).toEqual(
        adoptedProfiles.map((profile) => profile.id)
      );
      for (const [index, result] of results.entries()) {
        const profile = adoptedProfiles[index];
        if (profile?.adoption === undefined) {
          throw new Error(`missing result profile at index ${index}`);
        }
        expect(result.artifactCount).toBeGreaterThan(0);
        expect(result.receiptHash).toBe(profile.adoption.receipt.contentHash);
        expect(result.rendererCommit).toBe(profile.adoption.rendererCommit);
      }
    } finally {
      await rm(isolatedRoot, { force: true, recursive: true });
    }
  });

  test("accepts one complete per-profile candidate receipt and deeply freezes a clone", () => {
    const input = sampleReceipt();
    const receipt = createStandardsConformanceReceipt(input);

    expect(receipt).toEqual(input);
    expect(receipt).not.toBe(input);
    expect(Object.isFrozen(receipt)).toBe(true);
    expect(Object.isFrozen(receipt.artifacts)).toBe(true);
    expect(Object.isFrozen(receipt.artifacts[0])).toBe(true);
    expect(Object.isFrozen(receipt.validators[0]?.argv)).toBe(true);
  });

  test("publishes a closed JSON Schema matching the persisted contract", () => {
    expect(STANDARDS_CONFORMANCE_RECEIPT_JSON_SCHEMA).toMatchObject({
      $schema: "https://json-schema.org/draft/2020-12/schema",
      additionalProperties: false,
      properties: {
        lifecycle: { const: "candidate" },
        profile: {
          enum: ["agent-instructions", "agent-skills", "agent-plugins-1.0"],
        },
      },
      type: "object",
    });
    expect(STANDARDS_CONFORMANCE_RECEIPT_JSON_SCHEMA.required).toContain(
      "safety"
    );
  });

  test("canonically serializes and hashes exact immutable receipt bytes", () => {
    const input = sampleReceipt();
    const reordered = {
      validators: input.validators,
      sourceTree: input.sourceTree,
      schemaVersion: input.schemaVersion,
      safety: input.safety,
      renderer: input.renderer,
      recordedAt: input.recordedAt,
      profileSnapshot: input.profileSnapshot,
      profile: input.profile,
      observations: input.observations,
      limitations: input.limitations,
      lifecycle: input.lifecycle,
      consumers: input.consumers,
      canaries: input.canaries,
      artifacts: input.artifacts,
    };

    expect(serializeStandardsConformanceReceipt(reordered)).toBe(
      serializeStandardsConformanceReceipt(input)
    );
    expect(hashStandardsConformanceReceipt(reordered)).toBe(
      hashStandardsConformanceReceipt(input)
    );
    expect(hashStandardsConformanceReceipt(input)).toMatch(
      /^sha256:[a-f0-9]{64}$/u
    );

    const mutated = {
      ...input,
      artifacts: [{ ...input.artifacts[0], bytes: 43 }],
    };
    expect(hashStandardsConformanceReceipt(mutated)).not.toBe(
      hashStandardsConformanceReceipt(input)
    );
  });

  test("rejects incomplete evidence, extra fields, and non-candidate lifecycle claims", () => {
    const withoutCanaries = { ...sampleReceipt(), canaries: [] };
    expect(() => parseStandardsConformanceReceipt(withoutCanaries)).toThrow(
      "receipt.canaries must be a non-empty array"
    );

    const withExtra = {
      ...sampleReceipt(),
      aggregateProfiles: ["agent-skills"],
    };
    expect(() => parseStandardsConformanceReceipt(withExtra)).toThrow(
      "receipt must contain exactly"
    );

    const adopted = { ...sampleReceipt(), lifecycle: "adopted" };
    expect(() => parseStandardsConformanceReceipt(adopted)).toThrow(
      'receipt.lifecycle must be "candidate"'
    );
  });

  test("rejects dirty renderers and changed protected roots", () => {
    const dirty = {
      ...sampleReceipt(),
      renderer: { clean: false, commit: "c".repeat(40) },
    };
    expect(() => parseStandardsConformanceReceipt(dirty)).toThrow(
      "receipt.renderer.clean must be true"
    );

    const changed = sampleReceipt();
    const withChangedSafety = {
      ...changed,
      safety: {
        ...changed.safety,
        after: [{ hash: OTHER_HASH, root: "checkout" }],
      },
    };
    expect(() => parseStandardsConformanceReceipt(withChangedSafety)).toThrow(
      "before and after snapshots must match exactly"
    );
  });

  test("rejects unsafe artifact paths and malformed immutable identifiers", () => {
    const input = sampleReceipt();
    expect(() =>
      parseStandardsConformanceReceipt({
        ...input,
        artifacts: [{ ...input.artifacts[0], path: "../live/plugin.json" }],
      })
    ).toThrow("must be a portable relative path");
    expect(() =>
      parseStandardsConformanceReceipt({
        ...input,
        renderer: { clean: true, commit: "main" },
      })
    ).toThrow("receipt.renderer.commit must match");
    expect(() =>
      parseStandardsConformanceReceipt({ ...input, recordedAt: "2026-09-13" })
    ).toThrow("canonical ISO 8601 UTC date-time");
  });
});
