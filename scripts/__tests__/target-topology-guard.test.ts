import { describe, expect, test } from "bun:test";

import {
  isTargetTopologySourcePath,
  scanTargetTopologySource,
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
      { rule: "R3", text: 'target === "claude" -> target === "codex" -> else' },
      { rule: "R3", text: 'target === "claude" -> target === "codex" -> else' },
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
        text: 'target === "claude" -> target === "cursor" -> else',
      },
      {
        column: 3,
        file: "apps/example.ts",
        line: 9,
        owner: "historicalGuardedTernary",
        rule: "R3",
        text: 'target === "cursor" -> target === "claude" -> else',
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
  });
});
