import { describe, expect, test } from "bun:test";

import {
  formatTargetTopologyFailures,
  isTargetTopologySourcePath,
  scanTargetTopologySource,
  scanTargetTopologySources,
} from "../target-topology-guard";

describe("target topology guard", () => {
  test("R1 rejects raw target-domain collections without matching mixed vocabularies", () => {
    const violations = scanTargetTopologySource("apps/example.ts", `
const targets = ["claude", "codex"];
for (const target of ["claude", "cursor"]) console.log(target);
const providers = new Set(["codex", "cursor"]);
const mixedKeys = ["claude", "codex", "metadata"];
`);

    expect(violations.map(({ rule }) => rule)).toEqual(["R1", "R1", "R1"]);
  });

  test("R2 rejects same-subject target equality subsets once", () => {
    const violations = scanTargetTopologySource("packages/example.ts", `
function supports(target: string) {
  return target === "claude" || target === "codex" || target === "cursor";
}
`);

    expect(violations).toEqual([{
      column: 10,
      file: "packages/example.ts",
      line: 3,
      owner: "supports",
      rule: "R2",
      text: 'target === "claude" || target === "codex" || target === "cursor"',
    }]);
  });

  test("R2 preserves parenthesized matches and reports an outer OR chain once", () => {
    const violations = scanTargetTopologySource("packages/example.ts", `
function oneParenthesis(target: string) {
  return (target === "claude" || target === "codex");
}
function twoParentheses(target: string) {
  return ((target === "claude" || target === "codex"));
}
function underAnd(target: string, enabled: boolean) {
  return ((target === "claude" || target === "codex")) && enabled;
}
function outerChain(target: string) {
  return ((target === "claude" || target === "codex")) || target === "cursor";
}
`);

    expect(violations.map(({ owner, rule }) => ({ owner, rule }))).toEqual([
      { owner: "oneParenthesis", rule: "R2" },
      { owner: "twoParentheses", rule: "R2" },
      { owner: "underAnd", rule: "R2" },
      { owner: "outerChain", rule: "R2" },
    ]);
  });

  test("R2 treats safe expression wrappers as transparent for outer-chain suppression", () => {
    const violations = scanTargetTopologySource("packages/example.ts", `
function asExpression(target: string) {
  return ((target === "claude" || target === "codex") as boolean) || target === "cursor";
}
function satisfiesExpression(target: string) {
  return ((target === "claude" || target === "codex") satisfies boolean) || target === "cursor";
}
function typeAssertion(target: string) {
  return (<boolean>(target === "claude" || target === "codex")) || target === "cursor";
}
function nonNullExpression(target: string) {
  return ((target === "claude" || target === "codex")!) || target === "cursor";
}
`);

    expect(violations.map(({ owner, rule }) => ({ owner, rule }))).toEqual([
      { owner: "asExpression", rule: "R2" },
      { owner: "satisfiesExpression", rule: "R2" },
      { owner: "typeAssertion", rule: "R2" },
      { owner: "nonNullExpression", rule: "R2" },
    ]);
  });

  test("R3 rejects multi-target ternary and if dispatch chains with fallback results", () => {
    const violations = scanTargetTopologySource("apps/example.ts", `
const label = target === "claude" ? "Claude" : target === "codex" ? "Codex" : "Cursor";
function path(target: string) {
  if (target === "claude") return ".claude";
  else if (target === "codex") return ".codex";
  else return ".cursor";
}
`);

    expect(violations.map(({ rule, text }) => ({ rule, text }))).toEqual([
      { rule: "R3", text: 'target === "claude" -> target === "codex" -> else [cursor]' },
      { rule: "R3", text: 'target === "claude" -> target === "codex" -> else [cursor]' },
    ]);
  });

  test("R3 rejects sequential target guards followed by an implicit return fallback", () => {
    const violations = scanTargetTopologySource("apps/example.ts", `
function historicalReturnFallback(target: string) {
  if (target === "claude") return "Claude";
  if (target === "cursor") return "Cursor";
  return "Codex";
}

function historicalGuardedTernary(target: string) {
  if (target === "cursor") throw new Error("unsupported");
  return target === "claude" ? "Claude" : "Codex";
}
`);

    expect(violations).toEqual([
      {
        column: 3,
        file: "apps/example.ts",
        line: 3,
        owner: "historicalReturnFallback",
        rule: "R3",
        text: 'target === "claude" -> target === "cursor" -> else [codex]',
      },
      {
        column: 3,
        file: "apps/example.ts",
        line: 9,
        owner: "historicalGuardedTernary",
        rule: "R3",
        text: 'target === "cursor" -> target === "claude" -> else [codex]',
      },
    ]);
  });

  test("R3 ignores sequential guards whose return behavior is shared with the fallback", () => {
    const violations = scanTargetTopologySource("apps/example.ts", `
function allShared(target: string) {
  if (target === "claude") return "shared";
  if (target === "cursor") return "shared";
  return "shared";
}

function onlyOneSpecificBranch(target: string) {
  if (target === "claude") return "Claude";
  if (target === "cursor") return "shared";
  return "shared";
}
`);

    expect(violations).toEqual([]);
  });

  test("R3 recognizes safe structural fallback equivalence across literals and wrappers", () => {
    const violations = scanTargetTopologySource("apps/example.ts", `
function quoteAndTemplateVariants(target: string) {
  if (target === "claude") return 'shared';
  if (target === "cursor") return \`shared\`;
  return "shared";
}

function wrappedIdentifiers(target: string) {
  if (target === "claude") return (shared as string)!;
  if (target === "cursor") return <string>shared;
  return shared;
}

function wrappedMemberChains(target: string) {
  if (target === "claude") return (config.labels.shared satisfies string);
  if (target === "cursor") return config.labels.shared!;
  return config.labels.shared;
}
`);

    expect(violations).toEqual([]);
  });

  test("R3 keeps semantically rich or unequal fallback expressions diagnosed", () => {
    const violations = scanTargetTopologySource("apps/example.ts", `
function calls(target: string) {
  if (target === "claude") return shared();
  if (target === "cursor") return shared();
  return shared();
}
function binaryExpressions(target: string) {
  if (target === "claude") return prefix + suffix;
  if (target === "cursor") return prefix + suffix;
  return prefix + suffix;
}
function objects(target: string) {
  if (target === "claude") return { kind: "shared" };
  if (target === "cursor") return { kind: "shared" };
  return { kind: "shared" };
}
function interpolatedTemplates(target: string) {
  if (target === "claude") return \`\${shared}\`;
  if (target === "cursor") return \`\${shared}\`;
  return \`\${shared}\`;
}
function computedAccess(target: string) {
  if (target === "claude") return config["shared"];
  if (target === "cursor") return config["shared"];
  return config["shared"];
}
function optionalAccess(target: string) {
  if (target === "claude") return config?.shared;
  if (target === "cursor") return config?.shared;
  return config?.shared;
}
function differentValues(target: string) {
  if (target === "claude") return "Claude";
  if (target === "cursor") return "Cursor";
  return "Codex";
}
`);

    expect(violations.map(({ owner }) => owner)).toEqual([
      "calls",
      "binaryExpressions",
      "objects",
      "interpolatedTemplates",
      "computedAccess",
      "optionalAccess",
      "differentValues",
    ]);
  });

  test("accepts canonical helpers, exhaustive switches, mixed subjects, and single-provider gates", () => {
    const violations = scanTargetTopologySource("packages/example.ts", `
const targets = targetNames();
const descriptions = targetRecord((target) => target);
const enabled = target === "claude" || isExperimental;
const unrelated = target === "claude" || provider === "codex";
const label = target === "claude" ? "Claude" : "Other";
function oneGuard(target: TargetName) {
  if (target === "cursor") throw new Error("unsupported");
  return "shared";
}
function mixedGuardSubjects(target: TargetName, provider: TargetName) {
  if (target === "cursor") return "Cursor";
  if (provider === "claude") return "Claude";
  return "shared";
}
function mixedDomain(provider: string) {
  if (provider === "agents") return "Agents";
  if (provider === "claude") return "Claude";
  if (provider === "codex") return "Codex";
  return "Skillset";
}
function render(target: TargetName) {
  switch (target) {
    case "claude": return "Claude";
    case "codex": return "Codex";
    case "cursor": return "Cursor";
  }
}
`);

    expect(violations).toEqual([]);
  });

  test("uses the supplied registry as evidence for future targets", () => {
    const targets = ["claude", "codex", "cursor", "future"] as const;
    const violations = scanTargetTopologySource("packages/example.ts", `
const current = ["claude", "codex", "cursor"];
const label = target === "claude" ? "Claude" : target === "codex" ? "Codex" : target === "cursor" ? "Cursor" : "Future";
`, targets);

    expect(violations.map(({ rule }) => rule)).toEqual(["R1", "R3"]);
  });

  test("invalidates an allowlisted R3 fallback when the registry grows", () => {
    const source = 'function render(target: string) { return target === "claude" ? "Claude" : target === "codex" ? "Codex" : "Other"; }';
    const sources = [{ content: source, file: "apps/example.ts" }];
    const currentTargets = ["claude", "codex", "cursor"] as const;
    const current = scanTargetTopologySources(sources, currentTargets, []);
    const observed = current.violations[0];
    expect(current).toMatchObject({
      duplicateAllowlist: [],
      unmatchedAllowlist: [],
      violations: [{ rule: "R3", text: 'target === "claude" -> target === "codex" -> else [cursor]' }],
    });
    expect(observed).toBeDefined();
    if (observed === undefined) throw new Error("fixture must produce an R3 violation");
    const exemption = { ...observed, rationale: "Fixture permits this exact current fallback." };

    expect(scanTargetTopologySources(sources, currentTargets, [exemption])).toEqual({
      duplicateAllowlist: [],
      unmatchedAllowlist: [],
      violations: [],
    });

    const futureTargets = ["claude", "codex", "cursor", "future"] as const;
    expect(scanTargetTopologySources(sources, futureTargets, [exemption])).toEqual({
      duplicateAllowlist: [],
      unmatchedAllowlist: [exemption],
      violations: [{
        ...observed,
        text: 'target === "claude" -> target === "codex" -> else [cursor, future]',
      }],
    });
  });

  test("filters generated, fixture, test, and non-TypeScript paths", () => {
    expect(isTargetTopologySourcePath("apps/skillset/src/cli.ts")).toBe(true);
    expect(isTargetTopologySourcePath("packages/core/src/render.ts")).toBe(true);
    expect(isTargetTopologySourcePath("scripts/example.ts")).toBe(true);
    expect(isTargetTopologySourcePath("apps/skillset/src/__tests__/contract.test.ts")).toBe(false);
    expect(isTargetTopologySourcePath("scripts/fixtures/example.ts")).toBe(false);
    expect(isTargetTopologySourcePath("plugins/example.ts")).toBe(false);
    expect(isTargetTopologySourcePath("docs/example.md")).toBe(false);
  });

  test("allowlisting a declaration does not hide a co-located copy", () => {
    const source = `${"\n".repeat(9)}export const TARGET_NAMES = ["claude", "codex", "cursor"] as const;\nconst SHADOW_TARGETS = ["claude", "codex", "cursor"] as const;`;
    const violations = scanTargetTopologySource("packages/schema/src/contracts.ts", source);

    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ line: 11, owner: "SHADOW_TARGETS", rule: "R1" });
  });

  test("allowlisting one position does not hide an identical same-line match", () => {
    const text = 'target === "claude" || target === "codex"';
    const source = `function matches(target: string) { return [${text}, ${text}]; }`;
    const allowlist = [{
      column: 44,
      file: "apps/example.ts",
      line: 1,
      owner: "matches",
      rationale: "Fixture permits only the first identical AST match.",
      rule: "R2" as const,
      text,
    }];
    const violations = scanTargetTopologySource(
      "apps/example.ts",
      source,
      ["claude", "codex", "cursor"],
      allowlist
    );

    expect(violations).toEqual([{
      column: 87,
      file: "apps/example.ts",
      line: 1,
      owner: "matches",
      rule: "R2",
      text,
    }]);

    expect(scanTargetTopologySources(
      [{ content: source, file: "apps/example.ts" }],
      ["claude", "codex", "cursor"],
      allowlist
    )).toEqual({ duplicateAllowlist: [], unmatchedAllowlist: [], violations });
  });

  test("complete scans fail a stale allowlist entry", () => {
    const stale = {
      column: 17,
      file: "apps/example.ts",
      line: 1,
      owner: "targets",
      rationale: "Fixture exemption that no longer has an observed match.",
      rule: "R1" as const,
      text: '["claude", "codex"]',
    };
    const result = scanTargetTopologySources(
      [{ content: "const targets = targetNames();", file: "apps/example.ts" }],
      ["claude", "codex", "cursor"],
      [stale]
    );

    expect(result).toEqual({ duplicateAllowlist: [], unmatchedAllowlist: [stale], violations: [] });
    expect(formatTargetTopologyFailures(result)).toEqual([
      'apps/example.ts:1:17: [ALLOWLIST R1] targets: ["claude", "codex"] (unmatched exemption: Fixture exemption that no longer has an observed match.)',
    ]);
  });

  test("complete scans pass when every allowlist entry is observed", () => {
    const observed = {
      column: 17,
      file: "apps/example.ts",
      line: 1,
      owner: "targets",
      rationale: "Fixture permits the exact declaration.",
      rule: "R1" as const,
      text: '["claude", "codex"]',
    };

    expect(scanTargetTopologySources(
      [{ content: 'const targets = ["claude", "codex"];', file: "apps/example.ts" }],
      ["claude", "codex", "cursor"],
      [observed]
    )).toEqual({ duplicateAllowlist: [], unmatchedAllowlist: [], violations: [] });
  });

  test("complete scans fail duplicate allowlist identities even when observed", () => {
    const identity = {
      column: 17,
      file: "apps/example.ts",
      line: 1,
      owner: "targets",
      rule: "R1" as const,
      text: '["claude", "codex"]',
    };
    const result = scanTargetTopologySources(
      [{ content: 'const targets = ["claude", "codex"];', file: "apps/example.ts" }],
      ["claude", "codex", "cursor"],
      [
        { ...identity, rationale: "Second duplicate fixture." },
        { ...identity, rationale: "First duplicate fixture." },
      ]
    );

    expect(result).toEqual({
      duplicateAllowlist: [{
        ...identity,
        count: 2,
        rationales: ["First duplicate fixture.", "Second duplicate fixture."],
      }],
      unmatchedAllowlist: [],
      violations: [],
    });
    expect(formatTargetTopologyFailures(result)).toEqual([
      'apps/example.ts:1:17: [DUPLICATE ALLOWLIST R1] targets: ["claude", "codex"] (2 exemptions; rationales: ["First duplicate fixture.","Second duplicate fixture."])',
    ]);
  });

  test("complete scan failures have deterministic diagnostic order", () => {
    const staleZ = {
      column: 1,
      file: "scripts/z.ts",
      line: 9,
      owner: "z",
      rationale: "Later stale fixture.",
      rule: "R2" as const,
      text: "z",
    };
    const staleA = {
      column: 1,
      file: "apps/a.ts",
      line: 9,
      owner: "a",
      rationale: "Earlier stale fixture.",
      rule: "R2" as const,
      text: "a",
    };
    const duplicateIdentity = {
      column: 17,
      file: "scripts/observed.ts",
      line: 1,
      owner: "targets",
      rule: "R1" as const,
      text: '["claude", "codex"]',
    };
    const result = scanTargetTopologySources(
      [
        { content: 'const targets = ["claude", "cursor"];', file: "packages/z.ts" },
        { content: 'const targets = ["claude", "codex"];', file: "apps/b.ts" },
        { content: 'const targets = ["claude", "codex"];', file: "scripts/observed.ts" },
      ],
      ["claude", "codex", "cursor"],
      [
        staleZ,
        { ...duplicateIdentity, rationale: "Second duplicate fixture." },
        staleA,
        { ...duplicateIdentity, rationale: "First duplicate fixture." },
      ]
    );

    expect(formatTargetTopologyFailures(result)).toEqual([
      'apps/b.ts:1:17: [R1] targets: ["claude", "codex"]',
      'packages/z.ts:1:17: [R1] targets: ["claude", "cursor"]',
      "apps/a.ts:9:1: [ALLOWLIST R2] a: a (unmatched exemption: Earlier stale fixture.)",
      "scripts/z.ts:9:1: [ALLOWLIST R2] z: z (unmatched exemption: Later stale fixture.)",
      'scripts/observed.ts:1:17: [DUPLICATE ALLOWLIST R1] targets: ["claude", "codex"] (2 exemptions; rationales: ["First duplicate fixture.","Second duplicate fixture."])',
    ]);
  });
});
