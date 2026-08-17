import { describe, expect, test } from "bun:test";

import {
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
        pin: "@anthropic-ai/claude-code@2.1.233",
        version: "2.1.233",
      },
      {
        id: "codex-authoring",
        pin: "be6e8eac029b183056b7e4402879f15d2c85f61b",
        version: "Codex 0.147.0 source",
      },
      {
        id: "cursor-authoring",
        pin: "2a8044425c7bddf429c3bdedf3ab61e791d34d65",
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
  });
});
