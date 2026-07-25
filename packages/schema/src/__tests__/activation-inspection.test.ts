import { describe, expect, it } from "bun:test";

import {
  ACTIVATION_INSPECTION_SCHEMA,
  activationInspectionContract,
  validateActivationInspectionReport,
} from "../index";

const validReport = {
  inspections: [
    {
      capability: "mcp-server",
      effect: "passive",
      inspectorId: "codex.mcp.list",
      outcome: "ran",
      subjects: ["github"],
      summary: "provider observation completed",
      target: "codex",
    },
  ],
  readiness: {
    counts: {
      blocked: 0,
      missing: 0,
      notApplicable: 0,
      satisfied: 0,
      stale: 0,
      unverified: 1,
    },
    enabledTargets: ["codex"],
    requirements: [],
    schema: "skillset.activation-readiness@1",
    summary: "ready_unverified",
  },
  schema: ACTIVATION_INSPECTION_SCHEMA,
} as const;

describe("activation inspection schema", () => {
  it("owns the versioned public report contract", () => {
    expect(ACTIVATION_INSPECTION_SCHEMA).toBe(
      "skillset.activation-inspection@1"
    );
    expect(activationInspectionContract.schema).toMatchObject({
      additionalProperties: false,
      properties: {
        inspections: {
          items: {
            properties: {
              stderrBytes: {
                maximum: Number.MAX_SAFE_INTEGER,
                minimum: 0,
                type: "integer",
              },
              stdoutBytes: {
                maximum: Number.MAX_SAFE_INTEGER,
                minimum: 0,
                type: "integer",
              },
            },
          },
        },
        readiness: {
          properties: {
            counts: {
              properties: {
                satisfied: {
                  maximum: Number.MAX_SAFE_INTEGER,
                  minimum: 0,
                  type: "integer",
                },
              },
            },
          },
        },
      },
      required: ["inspections", "readiness", "schema"],
    });
    expect(validateActivationInspectionReport(validReport)).toEqual({
      diagnostics: [],
      ok: true,
    });
  });

  it("rejects invalid versions, receipts, and readiness envelopes", () => {
    const validation = validateActivationInspectionReport({
      ...validReport,
      inspections: [{ outcome: "invented" }],
      readiness: {},
      schema: "skillset.activation-inspection@0",
    });

    expect(validation.ok).toBe(false);
    expect(validation.diagnostics.map(({ code }) => code)).toEqual(
      expect.arrayContaining([
        "schema/activation-inspection/version",
        "schema/activation-inspection/outcome",
        "schema/activation-readiness/version",
        "schema/activation-readiness/requirements",
      ])
    );
  });

  it("keeps runtime validation aligned with hostile nested schema cases", () => {
    const validation = validateActivationInspectionReport({
      ...validReport,
      inspections: [
        {
          ...validReport.inspections[0],
          subjects: ["github", "github"],
        },
      ],
      readiness: {
        ...validReport.readiness,
        requirements: [
          {
            capability: "mcp-server",
            id: "",
            nextActions: [{ id: "fix" }],
            observationEffect: "invented",
            origin: "observed",
            reason: "",
            required: "yes",
            sourcePaths: ["source", "source"],
            sourceUnits: [],
            stage: "discoverable",
            state: "unverified",
            subject: "",
            target: "codex",
          },
        ],
      },
    });

    expect(validation.ok).toBe(false);
    expect(validation.diagnostics.map(({ code }) => code)).toEqual(
      expect.arrayContaining([
        "schema/activation-inspection/subjects-unique",
        "schema/activation-readiness/id",
        "schema/activation-readiness/observationEffect",
        "schema/activation-readiness/required",
        "schema/activation-readiness/sourcePaths-unique",
      ])
    );
  });

  it("validates optional receipt fields whenever they are present", () => {
    for (const binaryVersion of ["", 1]) {
      const validation = validateActivationInspectionReport({
        ...validReport,
        inspections: [
          {
            ...validReport.inspections[0],
            binaryVersion,
          },
        ],
      });

      expect(validation.ok).toBe(false);
      expect(validation.diagnostics.map(({ code }) => code)).toContain(
        "schema/activation-inspection/binary-version"
      );
    }
  });
});
