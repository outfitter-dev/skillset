import { expect, test } from "bun:test";

import {
  builtinTransformEntries,
  listTransformEntries,
  recognizeTransforms,
  registerTransformEntry,
} from "../index";

test("every built-in entry is registered, evidence-backed, and flagged correctly", () => {
  expect(listTransformEntries()).toEqual(builtinTransformEntries);
  expect(builtinTransformEntries.map((entry) => entry.intent)).toEqual([
    "path.project-config-dir",
    "path.user-config-dir",
    "path.skills-dir",
    "doc.project-instructions",
    "invoke.subagent",
    "dynamic.arguments",
    "dynamic.positional",
    "dynamic.env-substitution",
    "dynamic.pre-resolution",
    "reference.file-mention",
  ]);

  for (const entry of builtinTransformEntries) {
    expect(entry.evidence.length).toBeGreaterThan(0);
    for (const evidence of entry.evidence) {
      expect(evidence.verified).toBe("2026-06-11");
      expect(evidence.source.length).toBeGreaterThan(0);
    }
    if (entry.lowering === "none") {
      expect(entry.reason).toBeDefined();
    }
    for (const form of Object.values(entry.forms)) {
      expect(form.pattern.flags).toContain("g");
      expect(form.pattern.flags).toContain("u");
    }
  }
});

test("transformable entries carry renderers on their target forms", () => {
  for (const entry of builtinTransformEntries) {
    if (entry.lowering === "bidirectional") {
      expect(entry.forms.claude?.render).toBeDefined();
      expect(entry.forms.codex?.render).toBeDefined();
    }
    if (entry.lowering === "to-codex") {
      expect(entry.forms.codex?.render).toBeDefined();
    }
    if (entry.lowering === "none") {
      for (const form of Object.values(entry.forms)) {
        expect(form.render).toBeUndefined();
      }
    }
  }
});

test("registry rejects duplicates, missing evidence, and unreasoned none-lowerings", () => {
  const base = builtinTransformEntries[0];
  if (base === undefined) throw new Error("expected built-in entries");
  expect(() => registerTransformEntry(base)).toThrow("already registered");
  expect(() =>
    registerTransformEntry({
      description: "x",
      evidence: [],
      forms: {},
      intent: "test.no-evidence",
      lowering: "bidirectional",
    })
  ).toThrow("no evidence");
  expect(() =>
    registerTransformEntry({
      description: "x",
      evidence: [{ source: "s", verified: "2026-06-11" }],
      forms: {},
      intent: "test.no-reason",
      lowering: "none",
    })
  ).toThrow("needs a reason");
  expect(() =>
    registerTransformEntry({
      description: "x",
      evidence: [{ source: "s", verified: "2026-06-11" }],
      forms: { claude: { pattern: /x/u } },
      intent: "test.bad-flags",
      lowering: "bidirectional",
    })
  ).toThrow("g and u flags");
});

test("dynamic recognizers stay aligned with skillset lint's CLAUDE_DYNAMIC_PATTERNS", () => {
  // Mirrors apps/skillset/src/lint.ts; lint owns the codex-enabled gate,
  // the registry only adds recognition. Keep both recognizing the same
  // language — lint's patterns are the battle-tested reference.
  const samples: ReadonlyArray<readonly [string, string]> = [
    ["dynamic.arguments", "Run with $ARGUMENTS now"],
    ["dynamic.arguments", "Run with $ARGUMENTS[0] now"],
    ["dynamic.arguments", "Run with $ARGUMENTS.flag now"],
    ["dynamic.positional", "echo $1"],
    ["dynamic.positional", "echo $0 and $12"],
    ["dynamic.env-substitution", "see ${CLAUDE_PLUGIN_ROOT}/bin"],
    ["dynamic.pre-resolution", "context:\n  !`git status`\n"],
  ];
  for (const [intent, sample] of samples) {
    const intents = recognizeTransforms(sample, "claude").map((match) => match.intent);
    expect(intents).toContain(intent);
  }

  // Non-matches lint also ignores.
  expect(recognizeTransforms("price is US$100 total", "claude")).toEqual([]);
  expect(recognizeTransforms("${CODEX_HOME} is not a Claude var", "claude")).toEqual([]);
  expect(recognizeTransforms("mid-line !`cmd` is not a placeholder", "claude")).toEqual([]);
});
