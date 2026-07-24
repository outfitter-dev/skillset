import { describe, expect, test } from "bun:test";

import {
  ACTIVATION_CAPABILITIES,
  ACTIVATION_EVIDENCE_ORIGINS,
  ACTIVATION_OBSERVATION_EFFECTS,
  ACTIVATION_READINESS_SCHEMA,
  ACTIVATION_READINESS_SUMMARIES,
  ACTIVATION_REQUIREMENT_STAGES,
  ACTIVATION_REQUIREMENT_STATES,
  validateActivationReadinessReport,
} from "../activation-readiness";

describe("activation readiness report contract", () => {
  test("owns the complete versioned readiness vocabulary", () => {
    expect(ACTIVATION_READINESS_SCHEMA).toBe("skillset.activation-readiness@1");
    expect(ACTIVATION_CAPABILITIES).toEqual([
      "app",
      "mcp-server",
      "plugin-dependency",
    ]);
    expect(ACTIVATION_REQUIREMENT_STAGES).toEqual([
      "declared",
      "rendered",
      "discoverable",
      "enabled",
      "authenticated",
      "connected",
      "proven",
    ]);
    expect(ACTIVATION_REQUIREMENT_STATES).toEqual([
      "satisfied",
      "missing",
      "blocked",
      "unverified",
      "stale",
      "not_applicable",
    ]);
    expect(ACTIVATION_READINESS_SUMMARIES).toEqual([
      "ready",
      "ready_unverified",
      "attention",
      "blocked",
    ]);
    expect(ACTIVATION_EVIDENCE_ORIGINS).toEqual([
      "declared",
      "derived",
      "observed",
      "proven",
    ]);
    expect(ACTIVATION_OBSERVATION_EFFECTS).toEqual([
      "active",
      "none",
      "passive",
    ]);
  });

  test("rejects malformed nested readiness requirements", () => {
    const validation = validateActivationReadinessReport({
      counts: {},
      enabledTargets: ["codex", "codex"],
      requirements: [{}],
      schema: ACTIVATION_READINESS_SCHEMA,
      summary: "ready",
    });

    expect(validation.ok).toBe(false);
    expect(validation.diagnostics.length).toBeGreaterThan(10);
  });
});
