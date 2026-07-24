import { describe, expect, test } from "bun:test";

import {
  ACTIVATION_PROOF_RECEIPT_SCHEMA,
  validateActivationProofReceipt,
} from "../activation-proof";

describe("activation proof receipt contract", () => {
  test("validates a versioned, portable proof receipt", () => {
    expect(
      validateActivationProofReceipt({
        claimIds: [
          "activation:codex:mcp-server:github:proven",
          "activation:codex:plugin-dependency:github:proven",
        ],
        identity: {
          adapterId: "codex-cli@1",
          declarationHash: "sha256:declaration",
          projectionHash: "sha256:projection",
          sourceHash: "sha256:source",
          target: "codex",
        },
        outcome: "passed",
        runtimeVersion: "1.2.3",
        schema: ACTIVATION_PROOF_RECEIPT_SCHEMA,
      }).diagnostics
    ).toEqual([]);
  });

  test("accepts unique claim ids independent of order", () => {
    expect(
      validateActivationProofReceipt({
        claimIds: ["z", "a"],
        identity: {
          adapterId: "codex-cli@1",
          declarationHash: "sha256:declaration",
          projectionHash: "sha256:projection",
          sourceHash: "sha256:source",
          target: "codex",
        },
        outcome: "passed",
        schema: ACTIVATION_PROOF_RECEIPT_SCHEMA,
      }).diagnostics
    ).toEqual([]);
  });

  test("rejects duplicate claim ids and unrecognized receipt shape", () => {
    const validation = validateActivationProofReceipt({
      claimIds: ["z", "a", "a"],
      extra: true,
      identity: {
        adapterId: "",
        projectionHash: "",
        sourceHash: "",
        target: "unknown",
      },
      outcome: "unknown",
      schema: "skillset.activation-proof-receipt@0",
    });

    expect(validation.ok).toBe(false);
    expect(validation.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(
      expect.arrayContaining([
        "schema/activation-proof-receipt/key",
        "schema/activation-proof-receipt/version",
        "schema/activation-proof-receipt/claim-ids-duplicate",
        "schema/activation-proof-receipt/identity",
        "schema/activation-proof-receipt/target",
        "schema/activation-proof-receipt/outcome",
      ])
    );
  });
});
