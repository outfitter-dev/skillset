import { describe, expect, test } from "bun:test";

import {
  assessProviderValidationFreshness,
  assertProviderValidationFreshness,
  defineProviderValidationLanes,
  getProviderValidationLane,
  listProviderValidationLanes,
} from "../provider-validation";

describe("SET-463 hosted provider validation registry", () => {
  test("owns the exact provider and standards-floor pins", () => {
    expect(
      listProviderValidationLanes().map(({ id, pin, version }) => ({
        id,
        pin,
        version,
      }))
    ).toEqual([
      {
        id: "agent-skills-reference",
        pin: "69ef37e9424c0a7ea9dd2293b559e43ec8176379",
        version: "0.1.0",
      },
      {
        id: "claude-product",
        pin: "@anthropic-ai/claude-code@2.1.269",
        version: "2.1.269",
      },
      {
        id: "codex-authoring",
        pin: "6b9826e3aa83b1a5947db50f4332cb9c65f1b340",
        version: "Codex 0.154.0 source",
      },
      {
        id: "cursor-authoring",
        pin: "f5bdd6826fd0a0d9cbc4347134c3a74a200b9d9d",
        version: "cursor/plugins source",
      },
    ]);

    for (const lane of listProviderValidationLanes()) {
      expect(lane.acquisitions.length).toBeGreaterThan(0);
      expect(lane.negativeCanary.length).toBeGreaterThan(0);
      expect(lane.fallback.surfaces.length).toBeGreaterThan(0);
      expect(Object.isFrozen(lane)).toBe(true);
    }
  });

  test("SET-500: gives exact-pin evidence a bounded age clock", () => {
    const source = getProviderValidationLane("claude-product");
    const lane = {
      ...source,
      lastSuccessfulValidation: {
        ...source.lastSuccessfulValidation,
        at: "2026-08-16T21:37:40.000Z",
      },
      pin: source.lastSuccessfulValidation.pin,
    };

    expect(
      assessProviderValidationFreshness(lane, "2026-09-15T21:37:40.000Z")
    ).toMatchObject({ ageDays: 30, status: "validation-current" });
    expect(
      assessProviderValidationFreshness(lane, "2026-09-16T21:37:40.001Z")
    ).toMatchObject({ ageDays: 31, status: "stale-verification" });
    expect(() =>
      assertProviderValidationFreshness("2026-09-17T00:18:50.001Z")
    ).toThrow("provider validation evidence is stale");
  });

  test("SET-500: a rejected candidate cannot advance successful validation", () => {
    const lane = getProviderValidationLane("claude-product");

    expect(lane.pin).not.toBe(lane.lastSuccessfulValidation.pin);
    expect(
      assessProviderValidationFreshness(lane, "2026-09-12T00:00:00.000Z")
    ).toMatchObject({
      lastSuccessfulValidationAt: "2026-08-17T00:18:50.000Z",
      status: "validation-pending",
    });
  });

  test("SET-500: keeps upstream change and failed refresh distinct from age", () => {
    const lane = getProviderValidationLane("claude-product");
    const checkedAt = "2026-09-12T00:00:00.000Z";

    expect(
      assessProviderValidationFreshness(lane, checkedAt, {
        upstreamPin: "@anthropic-ai/claude-code@2.1.270",
      }).status
    ).toBe("upstream-changed");
    expect(
      assessProviderValidationFreshness(lane, checkedAt, {
        error: "registry unavailable",
      }).status
    ).toBe("refresh-failed");
  });

  test("keeps source validators and the Agent Skills floor bounded", () => {
    expect(
      getProviderValidationLane("codex-authoring").limitations.join(" ")
    ).toContain("not a whole-provider");
    expect(
      getProviderValidationLane("cursor-authoring").limitations.join(" ")
    ).toContain("category and tags placement");
    expect(
      getProviderValidationLane("agent-skills-reference").limitations.join(" ")
    ).toContain("standards-floor");
    expect(
      getProviderValidationLane("codex-authoring").fallback.surfaces
    ).toContain("hooks");
    expect(
      getProviderValidationLane("cursor-authoring").fallback.surfaces
    ).toContain("runtime consumption");
  });

  test("integrity-owns the complete executable dependency closure", () => {
    expect(
      getProviderValidationLane("codex-authoring").acquisitions.map(
        ({ blob }) => blob
      )
    ).toEqual([
      "b5be462c3b4fe3ea6083cca948ccf52e05301546",
      "41a1a2f1b503c165f5d4b93f7f0e99eb0b3add6e",
    ]);
    expect(
      getProviderValidationLane("codex-authoring").dependencies.map(
        ({ name, version }) => `${name}@${version}`
      )
    ).toEqual(["PyYAML@6.0.3"]);
    expect(
      getProviderValidationLane("cursor-authoring").dependencies.map(
        ({ name, version }) => `${name}@${version}`
      )
    ).toEqual([
      "ajv@8.20.0",
      "ajv-formats@3.0.1",
      "fast-deep-equal@3.1.3",
      "fast-uri@3.1.5",
      "json-schema-traverse@1.0.0",
      "require-from-string@2.0.2",
    ]);
    for (const id of ["codex-authoring", "cursor-authoring"] as const) {
      for (const dependency of getProviderValidationLane(id).dependencies) {
        expect(dependency.url).toStartWith("https://");
        expect(dependency.integrity).toMatch(/^(?:sha256:|sha512-)/u);
      }
    }
  });

  test("rejects floating pins, dependencies, missing canaries, and missing fallbacks", () => {
    const base = listProviderValidationLanes();
    const claude = getProviderValidationLane("claude-product");

    expect(() =>
      defineProviderValidationLanes(
        base.map((lane) =>
          lane.id === claude.id
            ? { ...lane, pin: "@anthropic-ai/claude-code@latest" }
            : lane
        )
      )
    ).toThrow("requires an exact pin");
    expect(() =>
      defineProviderValidationLanes(
        base.map((lane) =>
          lane.id === claude.id
            ? {
                ...lane,
                dependencies: [
                  {
                    integrity: `sha256:${"0".repeat(64)}`,
                    name: "example",
                    version: "^1.0.0",
                  },
                ],
              }
            : lane
        )
      )
    ).toThrow("requires an exact version");
    expect(() =>
      defineProviderValidationLanes(
        base.map((lane) =>
          lane.id === claude.id ? { ...lane, negativeCanary: "" } : lane
        )
      )
    ).toThrow("requires a negative canary");
    expect(() =>
      defineProviderValidationLanes(
        base.map((lane) =>
          lane.id === claude.id
            ? { ...lane, fallback: { ...lane.fallback, surfaces: [] } }
            : lane
        )
      )
    ).toThrow("requires coverage, limitations, and fallback");
    expect(() =>
      defineProviderValidationLanes(
        base.map((lane) =>
          lane.id === claude.id
            ? {
                ...lane,
                lastSuccessfulValidation: {
                  ...lane.lastSuccessfulValidation,
                  at: "2026-08-16",
                },
              }
            : lane
        )
      )
    ).toThrow("lastSuccessfulValidation.at must be an ISO timestamp");
  });
});
