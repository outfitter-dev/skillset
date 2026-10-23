import { describe, expect, it } from "bun:test";

import {
  RETIRED_RULE_LITERAL_ALLOWLIST,
  isScannablePath,
  scanContent,
  scanInternalAdHocTestTerminology,
  scanNestedRetiredDefaults,
  scanRetiredRuleSyntax,
} from "../terminology-guard";

describe("terminology guard", () => {
  it("flags retired render-result vocabulary", () => {
    expect(scanContent("a.ts", "type X = SkillsetLoweringOutcome;").map((v) => v.label)).toContain(
      "SkillsetLowering* -> SkillsetRenderResult*"
    );
    expect(scanContent("a.ts", "const loweringOutcomes = [];").map((v) => v.label)).toContain(
      "loweringOutcomes -> renderResults"
    );
    expect(scanContent("a.json", '"schema": "skillset-lowering-outcome@1"').map((v) => v.label)).toContain(
      "skillset-lowering-outcome@1 -> skillset-render-result@1"
    );
    expect(scanContent("a.ts", "readonly loweringOwner: string;").map((v) => v.label)).toContain(
      "loweringOwner -> renderOwner"
    );
    expect(scanContent("a.md", "the lowering outcome record").length).toBeGreaterThan(0);
    expect(scanContent("a.md", "lossy lowering and the loss ledger").map((v) => v.label)).toContain(
      "loss ledger -> render report"
    );
    expect(scanContent("a.ts", "const LOWERING_OUTCOME_SCHEMA = 1;").map((v) => v.label)).toContain(
      "LOWERING_OUTCOME -> RENDER_RESULT"
    );
    expect(scanContent("a.md", "the lowering policy blocks the build").map((v) => v.label)).toContain(
      "lowering policy -> unsupported destination policy"
    );
    expect(scanContent("a.md", "the value was lowered before writes").map((v) => v.label)).toContain(
      "lowered -> rendered/derived"
    );
  });

  it("does not let an allowlisted substring mask a co-located regression", () => {
    // `match.lowering` is allowlisted, but `loweringOutcomes` on the same line is not.
    const labels = scanContent("a.ts", "const loweringOutcomes = match.lowering;").map((v) => v.label);
    expect(labels).toContain("loweringOutcomes -> renderResults");
    // The bare `lowering` inside `match.lowering` stays exempt (no bare-verb violation).
    expect(labels).not.toContain("lowering -> render/derive");
  });

  it("flags the old config key but not the new one", () => {
    expect(scanContent("a.md", "compile.unsupported defaults to error").map((v) => v.label)).toContain(
      "compile.unsupported -> compile.unsupportedDestination"
    );
    expect(scanContent("a.md", "compile.unsupportedDestination defaults to error")).toEqual([]);
  });

  it("ADR-0044: flags update used for self-upgrade, not workspace update", () => {
    const label = "update for self-upgrade -> skillset upgrade (ADR-0044)";
    for (const line of [
      "Run `skillset update --self` to get the newest release.",
      "skillset self-update fetches the latest binary",
      "Updating the Skillset CLI is one command.",
      "update skillset itself before building",
    ]) {
      expect(scanContent("a.md", line).map((v) => v.label)).toContain(label);
    }
    for (const line of [
      "`skillset update` previews registered provider format migrations.",
      "skillset upgrade brings Skillset and its tooling current.",
      "Update the skill, then rebuild.",
      "Update the Skillset CLI documentation when a flag changes.",
      "Updating the Skillset CLI help text is a docs change.",
    ]) {
      expect(scanContent("a.md", line)).toEqual([]);
    }
  });

  it("flags retired rule spellings (ADR-0039)", () => {
    const labelsFor = (file: string, text: string) => scanContent(file, text).map((v) => v.label);
    expect(labelsFor("a.ts", 'const id = "instruction-frontmatter";')).toContain(
      "instruction-frontmatter -> rule-frontmatter"
    );
    expect(labelsFor("a.ts", "validateInstructionFrontmatter(value)")).toContain(
      "InstructionFrontmatter -> RuleFrontmatter"
    );
    expect(labelsFor("a.ts", "INSTRUCTION_FRONTMATTER_KEYS")).toContain("InstructionFrontmatter -> RuleFrontmatter");
    expect(labelsFor("a.md", "Instruction frontmatter can carry paths.")).toContain(
      "instruction frontmatter -> rule frontmatter"
    );
    expect(labelsFor("a.ts", "selectorForInstruction(rule.id)")).toContain("selectorForInstruction -> selectorForRule");
    expect(labelsFor("a.json", '"sourceUnit": "instruction:fixtures"')).toContain("instruction:<id> -> rule:<id>");
    expect(labelsFor("a.ts", "const selector = `instruction:${id}`;")).toContain("instruction:<id> -> rule:<id>");
    expect(labelsFor("a.ts", 'kind: "instruction",')).toContain('"instruction" kind -> "rule"');
    expect(labelsFor("a.ts", 'if (kind === "instruction") return;')).toContain('"instruction" kind -> "rule"');
    expect(labelsFor("a.ts", 'type Kind = "agent" | "instruction";')).toContain('"instruction" kind -> "rule"');
    expect(labelsFor("a.ts", '    "instruction",')).toContain('"instruction" kind -> "rule"');
    expect(labelsFor("a.md", "Run `skillset new instruction Review`.")).toContain(
      "new/lookup instruction -> new/lookup rule"
    );
    expect(labelsFor("a.md", "skillset lookup instruction")).toContain("new/lookup instruction -> new/lookup rule");
    expect(labelsFor("a.ts", 'return "source-instruction";')).toContain("source-instruction -> source-rule");
    expect(labelsFor("a.md", "Set codex.defaults.instructions to false.")).toContain(
      "defaults.instructions -> defaults.rules"
    );
    expect(labelsFor("a.ts", '{ kind: "instructions", path: "AGENTS.md" }')).toContain(
      "instructions import kind -> rules"
    );
    expect(labelsFor("a.ts", '"instructions:AGENTS.md"')).toContain("instructions import kind -> rules");
    expect(labelsFor("a.md", "[Instructions](../reference/features/instructions.md)")).toContain(
      "instructions.md reference page -> rules.md"
    );
    expect(labelsFor("a.ts", "graph.instructionsDir")).toContain(
      "instructionsDir/loadInstructions -> rulesDir/loadRules"
    );
  });

  it("SET-681: flags the retired rule kind and selectors structurally in TypeScript", () => {
    const flagged = (text: string) => scanRetiredRuleSyntax("a.ts", text).map((v) => v.label);
    const kind = 'retired "instruction(s)" kind literal -> "rule(s)"';
    const selector = "concatenated instruction:<id> selector -> rule:<id>";
    for (const text of [
      'if (kind === "instructions") {}',
      'if ("instruction" !== kind) {}',
      'type Kind = "skill" | "instructions";',
      'switch (kind) { case "instructions": break; }',
      'const entries = [["instructions", true]];',
      'function k() { return "instruction"; }',
      'const k = () => "instruction";',
      'const k = rule ? "instruction" : "rule";',
    ])
      expect(flagged(text)).toContain(kind);
    expect(flagged('const id = "instruction:" + name;')).toContain(selector);
    expect(flagged('const id = "instructions:".concat(path);')).toContain(selector);
    expect(flagged("const config = { codex: { defaults: { instructions: { enabled: false } } } };")).toContain(
      "nested codex.defaults.instructions -> codex.defaults.rules"
    );
  });

  it("SET-681: keeps non-retired instruction words and allowlisted owners in TypeScript", () => {
    for (const text of [
      'const label = "Agent Instructions";',
      'const config = { compile: { agents: { instructions: true } } };',
      'const config = { codex: { defaults: { rules: { enabled: false } } } };',
      'if (kind === "rule") {}',
      'const prose = "Codex reads instruction files";',
    ])
      expect(scanRetiredRuleSyntax("a.ts", text)).toEqual([]);
    for (const file of RETIRED_RULE_LITERAL_ALLOWLIST.keys())
      expect(scanRetiredRuleSyntax(file, 'const moves = [["instructions", "rules"]];')).toEqual([]);
    expect(scanRetiredRuleSyntax("a.md", 'kind === "instructions"')).toEqual([]);
  });

  it("SET-681: flags a nested codex.defaults instructions key in YAML", () => {
    const yaml = "codex:\n  defaults:\n    instructions:\n      enabled: false\n";
    expect(scanNestedRetiredDefaults("skillset.yaml", yaml).map((v) => v.line)).toEqual([3]);
    expect(scanNestedRetiredDefaults("skillset.yaml", "codex:\n  defaults:\n    rules:\n      enabled: false\n")).toEqual(
      []
    );
    expect(
      scanNestedRetiredDefaults("skillset.yaml", "compile:\n  agents:\n    instructions: true\ncodex:\n  defaults: {}\n")
    ).toEqual([]);
    expect(
      scanNestedRetiredDefaults("skillset.yaml", "codex:\n  defaults:\n    rules: {}\n  instructions: x\n")
    ).toEqual([]);
  });

  it("SET-681: anchors new/lookup instruction to Skillset commands", () => {
    expect(scanContent("a.md", "Codex discovers a new instruction file in each directory.")).toEqual([]);
    expect(scanContent("a.md", "Run `bun ./apps/skillset/src/cli.ts new instruction Review`.").map((v) => v.label)).toContain(
      "new/lookup instruction -> new/lookup rule"
    );
  });

  it("keeps instruction vocabulary that Skillset does not own", () => {
    for (const text of [
      "Agent Instructions is an adopted standard profile.",
      'standardProfile: "agent-instructions"',
      "compile:\n  agents:\n    instructions: true",
      "compile.agents.instructions",
      "compile.instruction_front_page: repo-root",
      "INSTRUCTION_FRONT_PAGE_DESTINATIONS",
      "schema/single-file-root-config/instruction-front-page",
      "developer_instructions = \"...\"",
      'intent: "doc.project-instructions"',
      "Codex reads AGENTS.md instruction files from the repository root.",
      "The `.skillset/_codex/rules/**/*.rules` island is Codex command policy.",
      '["instructions", "rules"],',
      "instruction: keep this YAML key",
      'the pre-ADR-0039 "instruction" spellings of rule source',
    ]) {
      expect(scanContent("a.md", text)).toEqual([]);
    }
  });

  it("exempts only rule-cutover history and the retired-vocabulary module", () => {
    expect(isScannablePath("packages/schema/src/retired-vocabulary.ts")).toBe(false);
    expect(isScannablePath("docs/migration-map.json")).toBe(false);
    expect(isScannablePath("packages/schema/src/contracts.ts")).toBe(true);
  });

  it("flags the bare render verb but not ordinary lower-* English", () => {
    expect(scanContent("a.md", "Skillset lowering to Claude").length).toBeGreaterThan(0);
    expect(scanContent("a.md", "lower-level opt-outs and lower-case names")).toEqual([]);
    expect(scanContent("a.md", "a lower config level than the root")).toEqual([]);
  });

  it("permits deferred and historical allowlisted lines", () => {
    // Transform-dialect concept (deferred follow-up).
    expect(scanContent("a.ts", 'if (match.lowering === "none") return;')).toEqual([]);
    expect(scanContent("a.ts", "No faithful Codex lowering: skipped")).toEqual([]);
    // Deterministic-projection concept (code not renamed).
    expect(scanContent("a.md", "the deterministic projection conformance proof")).toEqual([]);
    // Historical ADR reference.
    expect(scanContent("a.md", "[Lowering Outcomes](../adrs/...-lowering-outcomes-and-loss-ledger.md)")).toEqual([]);
  });

  it("does not scan generated, historical, or deferred-owner paths", () => {
    expect(isScannablePath("docs/adrs/0001-root-compile-policy.md")).toBe(false);
    expect(isScannablePath(".claude/skills/x/SKILL.md")).toBe(false);
    expect(isScannablePath(".agents/plans/p/PLAN.md")).toBe(false);
    expect(
      isScannablePath(".agents/plans/archive/2026-07-18-drift-audit/03-governance-and-docs-lag.md")
    ).toBe(false);
    expect(isScannablePath(".changeset/x.md")).toBe(false);
    expect(isScannablePath("apps/skillset/CHANGELOG.md")).toBe(false);
    expect(isScannablePath("packages/transforms/src/engine.ts")).toBe(false);
    expect(isScannablePath("packages/core/src/render.ts")).toBe(false);
    expect(isScannablePath("packages/core/src/deterministic-projection.ts")).toBe(false);
    // Active surfaces are scanned.
    expect(isScannablePath("docs/development/features/render-results.md")).toBe(true);
    expect(isScannablePath("packages/core/src/render-result.ts")).toBe(true);
    expect(isScannablePath("README.md")).toBe(true);
  });

  it("ignores non-scannable extensions", () => {
    expect(isScannablePath("scripts/run.sh")).toBe(false);
    expect(isScannablePath("LICENSE")).toBe(false);
  });

  it("flags retired ad hoc-test identifiers structurally", () => {
    const violations = scanInternalAdHocTestTerminology(
      "apps/skillset/src/test-cli.ts",
      [
        "type TryState = string;",
        "const tryRun = (): void => {};",
        "const TRY_STATE = 'queued';",
        "const startTryRun = (): void => {};",
        "const runTryCommand = (): void => {};",
        "const embeddedTryState = 'queued';",
      ].join("\n")
    );
    expect(violations.map((violation) => violation.label)).toEqual([
      "retired ad hoc-test identifier",
      "retired ad hoc-test identifier",
      "retired ad hoc-test identifier",
      "retired ad hoc-test identifier",
      "retired ad hoc-test identifier",
      "retired ad hoc-test identifier",
    ]);
  });

  it("keeps the exact unrelated resolver helper and ordinary try syntax", () => {
    expect(
      scanInternalAdHocTestTerminology(
        "apps/skillset/src/change-workflow.ts",
        [
          "function tryResolvePending(): void {}",
          "try { tryResolvePending(); } catch {}",
          "const prose = 'try the command again';",
          "const retry = true;",
          "const entry = true;",
          "const registry = true;",
        ].join("\n")
      )
    ).toEqual([]);
    expect(
      scanInternalAdHocTestTerminology(
        "apps/skillset/src/other.ts",
        "function tryResolvePending(): void {}"
      ).map((violation) => violation.label)
    ).toEqual(["retired ad hoc-test identifier"]);
  });

  it("flags only exact retired module specifiers", () => {
    const violations = scanInternalAdHocTestTerminology(
      "apps/skillset/src/test-cli.ts",
      [
        'import { run } from "./try";',
        'export { status } from "./try-cli";',
        'const worker = import("../try");',
        'const nested = import("../../try-cli");',
        'const bare = import("try");',
        'import { retry } from "./retry";',
        'import { entry } from "entry";',
        'import { registry } from "@scope/registry";',
      ].join("\n")
    );
    expect(violations.map((violation) => violation.label)).toEqual([
      "retired ad hoc-test module specifier",
      "retired ad hoc-test module specifier",
      "retired ad hoc-test module specifier",
      "retired ad hoc-test module specifier",
      "retired ad hoc-test module specifier",
    ]);
  });

  it("flags the three exact retired scoped paths", () => {
    for (const path of [
      "apps/skillset/src/try.ts",
      "apps/skillset/src/try-cli.ts",
      "apps/skillset/src/__tests__/try.test.ts",
    ]) {
      expect(scanInternalAdHocTestTerminology(path, "")).toEqual([
        {
          file: path,
          label: "retired ad hoc-test path",
          line: 1,
          text: path,
        },
      ]);
    }
    expect(
      scanInternalAdHocTestTerminology(
        "apps/skillset/src/__tests__/ad-hoc-test.test.ts",
        ""
      )
    ).toEqual([]);
  });
});
