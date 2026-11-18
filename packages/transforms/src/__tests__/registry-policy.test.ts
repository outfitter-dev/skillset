import { expect, test } from "bun:test";

import { registerTransformEntry, transformEntries } from "../index";
import type { TransformEntry } from "../types";

const explicit: TransformEntry = {
  intent: "test.policy-explicit",
  description: "Test-only protocol with explicit source and destination meaning.",
  evidence: [{ source: "test-only source-intent/target-intent protocol", verified: "2026-10-29" }],
  lowering: "to-codex",
  forms: {
    claude: { pattern: /source-intent:demo/gu },
    codex: { pattern: /target-intent:demo/gu, render: () => "target-intent:demo" },
  },
};

test.each([
  { ...explicit, forms: {}, error: "source recognizer" },
  { ...explicit, forms: { claude: explicit.forms.claude! }, error: "target renderer" },
  { ...explicit, lowering: "bidirectional" as const, error: "target renderer" },
  { ...explicit, lowering: "none" as const, reason: "Ambiguous", error: "report-only" },
])("registry rejects incomplete or contradictory transform contracts: $error", ({ error, ...entry }) => {
  try {
    expect(() => registerTransformEntry(entry)).toThrow(error);
    expect(transformEntries.has(entry.intent)).toBe(false);
  } finally {
    transformEntries.delete(entry.intent);
  }
});

test("registry accepts a complete explicit mapping without claiming evidence proves semantics", () => {
  registerTransformEntry(explicit);
  try {
    expect(transformEntries.get(explicit.intent)).toBe(explicit);
  } finally {
    transformEntries.delete(explicit.intent);
  }
});
